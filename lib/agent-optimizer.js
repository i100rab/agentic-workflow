import Anthropic from "@anthropic-ai/sdk";

// Sonnet list pricing, used only to turn token counts into dollar figures
// for reporting. Doesn't affect behavior.
const SONNET_IN = 3 / 1_000_000;
const SONNET_OUT = 15 / 1_000_000;

function estimateTokens(str) {
  return Math.ceil((str || "").length / 4);
}

function costOfTokens(inTok, outTok) {
  return inTok * SONNET_IN + outTok * SONNET_OUT;
}

// ---------------------------------------------------------------------------
// Semantic-ish cache: token-overlap (Jaccard) similarity, no embeddings call
// needed, so the lookup itself costs nothing. Good enough to catch
// near-duplicate questions, which is where most agentic-system waste is.
// ---------------------------------------------------------------------------

function normalize(text) {
  return (text || "")
    .toLowerCase()
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Removing these keeps the similarity score focused on content words rather
// than sentence structure. Without this, "what are the benefits" and "what
// are the risks" of the same topic score misleadingly close to each other,
// since 4 of 5 words are shared connective tissue.
const STOPWORDS = new Set([
  "what", "are", "the", "is", "of", "for", "to", "a", "an", "in", "on", "and",
  "or", "this", "that", "was", "were", "be", "been", "being", "it", "its",
  "as", "at", "by", "from", "with", "about", "into", "your", "you", "we",
  "our", "can", "could", "should", "would", "will", "do", "does", "did",
  "i", "my",
]);

function tokenSet(text) {
  return new Set(normalize(text).split(" ").filter((w) => w.length > 2 && !STOPWORDS.has(w)));
}

function jaccard(a, b) {
  if (a.size === 0 || b.size === 0) return 0;
  let intersection = 0;
  for (const t of a) if (b.has(t)) intersection++;
  const union = a.size + b.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

function textOf(content) {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join("\n");
  }
  return "";
}

function extractQueryText(messages) {
  const lastUser = [...messages].reverse().find((m) => m.role === "user");
  return lastUser ? textOf(lastUser.content) : "";
}

// A cheap, stable key for the system prompt, used to scope the cache per
// agent "role". Two different agents (e.g. a Researcher and a Writer) never
// cross-match each other's queries, even if the wording happens to overlap,
// because they run under different system prompts.
function bucketKeyFor(systemPrompt) {
  const s = systemPrompt || "";
  return s.slice(0, 60);
}

// ---------------------------------------------------------------------------
// Structural compression: works on the shape of a messages array, not on
// what the agent is actually trying to do, so it applies to any agent.
// ---------------------------------------------------------------------------

const FILLER_PHRASES = [
  [/please note that/gi, ""],
  [/it is important to note that/gi, ""],
  [/it's important to note that/gi, ""],
  [/in order to/gi, "to"],
  [/due to the fact that/gi, "because"],
  [/at this point in time/gi, "now"],
  [/for the purpose of/gi, "to"],
  [/a large number of/gi, "many"],
  [/in the event that/gi, "if"],
  [/prior to/gi, "before"],
  [/subsequent to/gi, "after"],
  [/please be advised that/gi, ""],
];

function compressText(text) {
  let out = text;
  for (const [pattern, replacement] of FILLER_PHRASES) out = out.replace(pattern, replacement);
  return out.replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
}

/**
 * Compresses a messages array three ways:
 *  1. Filler-phrase stripping on every text message.
 *  2. Deduplication - if an earlier message's text (200+ chars) reappears
 *     verbatim inside a later one, the repeat is replaced with a short
 *     reference. Catches the common "agent handoff resends everything" waste.
 *  3. Sliding window - beyond `maxHistory` messages, older turns collapse
 *     into a one-line marker instead of being resent in full.
 * None of this depends on knowing what the agent does. It only looks at
 * message structure and text, which is what makes it reusable.
 */
function compressMessages(messages, maxHistory) {
  let msgs = messages.map((m) => ({
    ...m,
    content: typeof m.content === "string" ? compressText(m.content) : m.content,
  }));

  for (let i = 0; i < msgs.length; i++) {
    const earlier = textOf(msgs[i].content);
    if (earlier.length < 200) continue;
    for (let j = i + 1; j < msgs.length; j++) {
      if (typeof msgs[j].content !== "string") continue;
      if (msgs[j].content.includes(earlier)) {
        msgs[j] = { ...msgs[j], content: msgs[j].content.replace(earlier, "[see earlier message]") };
      }
    }
  }

  if (msgs.length > maxHistory) {
    const dropped = msgs.length - maxHistory;
    const kept = msgs.slice(msgs.length - maxHistory);
    return [{ role: "user", content: `[${dropped} earlier message(s) summarized/omitted for brevity]` }, ...kept];
  }
  return msgs;
}

// ---------------------------------------------------------------------------
// The wrapper. Same call shape as the real Anthropic SDK
// (client.messages.create(params)), so it's a drop-in swap for any agent
// already built on that SDK - no agent code changes needed, just the line
// that constructs the client.
//
// Known limitation, stated plainly: this cache matches on word overlap, not
// meaning. It reliably catches reworded or reordered restatements of the
// same question (the common real-world case - two different callers asking
// the same thing slightly differently). It will NOT reliably catch a full
// synonym-swapped paraphrase, and testing during development found a real
// false-positive risk on "opposite intent, same vocabulary" pairs (e.g.
// "benefits of X" vs "risks of X") at lower thresholds. The default
// threshold below (0.7) was calibrated specifically to reject that case.
// If your traffic needs true semantic matching, swap the similarity
// function for an embeddings call - this file is intentionally small so
// that's a contained change.
// ---------------------------------------------------------------------------

export function createOptimizedClient(apiKey, opts = {}) {
  const real = new Anthropic({ apiKey });
  const similarityThreshold = opts.similarityThreshold ?? 0.7;
  const maxHistory = opts.maxHistoryMessages ?? 6;

  const buckets = new Map(); // bucketKey -> [{tokens, content, usage}]
  const stats = {
    calls: 0,
    cacheHits: 0,
    tokensSavedByCache: 0,
    costSavedByCache: 0,
    tokensSavedByCompression: 0,
    costSavedByCompression: 0,
  };

  async function create(params) {
    stats.calls++;
    const bucket = bucketKeyFor(params.system);
    const entries = buckets.get(bucket) || [];

    const queryText = extractQueryText(params.messages);
    const qTokens = tokenSet(queryText);

    let best = null;
    let bestScore = 0;
    for (const entry of entries) {
      const score = jaccard(qTokens, entry.tokens);
      if (score > bestScore) {
        bestScore = score;
        best = entry;
      }
    }

    if (best && bestScore >= similarityThreshold) {
      stats.cacheHits++;
      const estIn = estimateTokens(JSON.stringify(params.messages)) + estimateTokens(params.system || "");
      const savedOut = best.usage?.output_tokens || 0;
      stats.tokensSavedByCache += estIn + savedOut;
      stats.costSavedByCache += costOfTokens(estIn, savedOut);
      return {
        content: best.content,
        usage: { input_tokens: 0, output_tokens: 0 },
        __optimized: { cacheHit: true, matchScore: Number(bestScore.toFixed(2)) },
      };
    }

    const originalSize = estimateTokens(JSON.stringify(params.messages));
    const compressed = compressMessages(params.messages, maxHistory);
    const compressedSize = estimateTokens(JSON.stringify(compressed));
    const tokensSaved = Math.max(0, originalSize - compressedSize);
    stats.tokensSavedByCompression += tokensSaved;
    stats.costSavedByCompression += tokensSaved * SONNET_IN;

    const response = await real.messages.create({ ...params, messages: compressed });

    entries.push({ tokens: qTokens, content: response.content, usage: response.usage, queryText });
    buckets.set(bucket, entries);

    return response;
  }

  return {
    messages: { create },
    getStats: () => ({ ...stats }),
    getCacheSize: () => [...buckets.values()].reduce((n, arr) => n + arr.length, 0),
  };
}
