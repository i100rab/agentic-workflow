# NeoStack

A static marketing site for NeoStack, a fictional Sydney-founded IT consulting and transformation firm. No build step, no framework — plain HTML/CSS/JS so it loads fast on any device.

## Preview locally

```
cd neostack
python3 -m http.server 8080
```

Then open `http://localhost:8080/index.html`.

## Structure

- `index.html`, `services.html`, `case-studies.html`, `about.html`, `insights.html`, `contact.html` — pages, each duplicating the shared header/footer markup (no build tool, no templating)
- `css/style.css` — design tokens (color, type, spacing) and all component styles: a "systems blueprint" direction (off-white paper, ink navy, engineering-blue accent, Space Grotesk/IBM Plex Sans/IBM Plex Mono type system, a schematic "trace" motif as the signature element)
- `js/main.js` — mobile nav toggle, sticky header, scroll-reveal (with reduced-motion, no-JS, and timeout fallbacks so content is never hidden from anything that renders the page without a real scroll gesture), static form submit handling
- `css/hero.css` / `js/hero-canvas.js` — home-page-only dark hero (canvas particle network, Instrument Serif display accent), loaded only by `index.html` so every other page stays at its original weight. Ported from a Claude Artifact export: the original was a React component with a bundled runtime; the canvas logic here is plain vanilla JS (setup/draw/loop, no framework), and it renders a single static frame instead of animating under `prefers-reduced-motion`. All of its CSS is scoped under `.ns-*` classes and `body.has-dark-hero` so nothing collides with the site-wide `.eyebrow`/`.stat`/`.brand`/`.nav` rules used elsewhere on the same page and across the rest of the site.

## What's placeholder vs. real

- Company name, services copy, leadership bio, and office addresses are invented for this brief (name given: NeoStack).
- Case studies (`case-studies.html`) and the "Trusted By" logo strip (`about.html`) are explicitly labeled as illustrative composites, not named real clients — swap in verified, permissioned case studies before launch.
- The consultation/contact forms are front-end only (`data-static-form` in `js/main.js` intercepts submit and shows a success message). Wire them to a real CRM or booking backend before launch.
