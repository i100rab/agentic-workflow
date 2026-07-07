(function () {
  const canvas = document.getElementById("globeCanvas");
  if (!canvas) return;

  const ctx = canvas.getContext("2d");
  const accent = getComputedStyle(document.documentElement).getPropertyValue("--gold").trim() || "#e5b45f";

  function hexRgb(hex) {
    const h = (hex || "#e5b45f").replace("#", "").trim();
    const v = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
    const i = parseInt(v, 16);
    return [(i >> 16) & 255, (i >> 8) & 255, i & 255];
  }
  const [ar, ag, ab] = hexRgb(accent);

  let w = 0, h = 0, dpr = Math.min(window.devicePixelRatio || 1, 2);
  let nodes = [], pulses = [], threshold = 0;
  let raf = null;
  let running = true;
  const pointer = { x: 0.5, y: 0.5, tx: 0.5, ty: 0.5 };

  function size() {
    w = canvas.clientWidth;
    h = canvas.clientHeight;
    if (w < 2 || h < 2) return;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    threshold = Math.min(w, h) * 0.2;
  }

  function buildField() {
    const cx = w * 0.5, cy = h * 0.5, R = Math.min(w, h) * 0.62;
    const count = Math.max(50, Math.min(180, Math.round((w * h) / 5200)));
    nodes = Array.from({ length: count }, () => {
      const a = Math.random() * Math.PI * 2;
      const rr = Math.sqrt(Math.random()) * R;
      return {
        x: cx + Math.cos(a) * rr,
        y: cy + Math.sin(a) * rr,
        vx: (Math.random() - 0.5) * 0.12,
        vy: (Math.random() - 0.5) * 0.12,
        r: 0.7 + Math.random() * 1.4,
        p: Math.random() * Math.PI * 2,
      };
    });
    pulses = Array.from({ length: Math.max(5, Math.round(count * 0.12)) }, newPulse).filter(Boolean);
  }

  function newPulse() {
    if (nodes.length < 2) return null;
    const a = (Math.random() * nodes.length) | 0;
    let b = -1, best = Infinity;
    for (let k = 0; k < 8; k++) {
      const c = (Math.random() * nodes.length) | 0;
      if (c === a) continue;
      const dx = nodes[a].x - nodes[c].x, dy = nodes[a].y - nodes[c].y;
      const d = dx * dx + dy * dy;
      if (d < best) { best = d; b = c; }
    }
    return { a, b: b < 0 ? (a + 1) % nodes.length : b, t: Math.random(), s: 0.003 + Math.random() * 0.006 };
  }

  function onMove(e) {
    const rect = canvas.getBoundingClientRect();
    pointer.tx = (e.clientX - rect.left) / rect.width;
    pointer.ty = (e.clientY - rect.top) / rect.height;
  }

  function loop() {
    if (!running) return;
    if (!w || w < 2) { size(); buildField(); raf = requestAnimationFrame(loop); return; }

    pointer.x += (pointer.tx - pointer.x) * 0.05;
    pointer.y += (pointer.ty - pointer.y) * 0.05;
    const ox = (pointer.x - 0.5) * 20, oy = (pointer.y - 0.5) * 14;

    ctx.clearRect(0, 0, w, h);

    const glow = ctx.createRadialGradient(w / 2, h / 2, 10, w / 2, h / 2, Math.min(w, h) * 0.62);
    glow.addColorStop(0, `rgba(${ar},${ag},${ab},0.10)`);
    glow.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, w, h);

    for (const n of nodes) {
      n.x += n.vx; n.y += n.vy; n.p += 0.01;
      if (n.x < -40) n.x = w + 40; if (n.x > w + 40) n.x = -40;
      if (n.y < -40) n.y = h + 40; if (n.y > h + 40) n.y = -40;
    }

    ctx.lineWidth = 1;
    for (let i = 0; i < nodes.length; i++) {
      const a = nodes[i];
      for (let j = i + 1; j < nodes.length; j++) {
        const b = nodes[j];
        const dx = a.x - b.x, dy = a.y - b.y, d = Math.hypot(dx, dy);
        if (d < threshold) {
          const alpha = (1 - d / threshold) * 0.32;
          ctx.strokeStyle = `rgba(${ar},${ag},${ab},${alpha})`;
          ctx.beginPath();
          ctx.moveTo(a.x + ox, a.y + oy);
          ctx.lineTo(b.x + ox, b.y + oy);
          ctx.stroke();
        }
      }
    }

    for (let i = 0; i < pulses.length; i++) {
      let pl = pulses[i];
      if (!pl) { pl = pulses[i] = newPulse(); if (!pl) continue; }
      pl.t += pl.s;
      if (pl.t >= 1) { pulses[i] = newPulse(); continue; }
      const a = nodes[pl.a], b = nodes[pl.b];
      if (!a || !b) { pulses[i] = newPulse(); continue; }
      const x = a.x + (b.x - a.x) * pl.t + ox, y = a.y + (b.y - a.y) * pl.t + oy;
      ctx.beginPath(); ctx.arc(x, y, 2.2, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(${ar},${ag},${ab},0.9)`; ctx.fill();
      ctx.beginPath(); ctx.arc(x, y, 6, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(${ar},${ag},${ab},0.16)`; ctx.fill();
    }

    for (const n of nodes) {
      const tw = 0.6 + Math.sin(n.p) * 0.4;
      ctx.beginPath(); ctx.arc(n.x + ox, n.y + oy, n.r, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(242,240,234,${0.3 + tw * 0.35})`;
      ctx.fill();
    }

    raf = requestAnimationFrame(loop);
  }

  size();
  buildField();
  loop();

  window.addEventListener("resize", () => { size(); buildField(); });
  canvas.addEventListener("pointermove", onMove);

  // Respect reduced-motion: freeze on a single drawn frame instead of animating.
  if (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    running = false;
    if (raf) cancelAnimationFrame(raf);
  }
})();
