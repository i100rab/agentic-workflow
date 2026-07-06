(function () {
  "use strict";

  var root = document.querySelector(".ns-hero");
  var canvas = root && root.querySelector(".ns-net");
  if (!root || !canvas) return;

  var reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var accent = getComputedStyle(root).getPropertyValue("--accent").trim() || "#5fb8f0";
  var pointer = { x: 0.5, y: 0.5, tx: 0.5, ty: 0.5 };
  var ctx, w, h, nodes, pulses, thresh, raf;

  function hexRgb(hex) {
    var m = hex.replace("#", "");
    var v = m.length === 3 ? m.split("").map(function (c) { return c + c; }).join("") : m;
    var i = parseInt(v, 16);
    return [(i >> 16) & 255, (i >> 8) & 255, i & 255];
  }

  function newPulse() {
    if (!nodes || nodes.length < 2) return null;
    var a = (Math.random() * nodes.length) | 0;
    var b = -1, best = 1e9;
    for (var k = 0; k < 8; k++) {
      var c = (Math.random() * nodes.length) | 0;
      if (c === a) continue;
      var d = Math.hypot(nodes[a].x - nodes[c].x, nodes[a].y - nodes[c].y);
      if (d < best) { best = d; b = c; }
    }
    return { a: a, b: b < 0 ? (a + 1) % nodes.length : b, t: Math.random(), s: 0.004 + Math.random() * 0.006 };
  }

  function setup() {
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    w = canvas.clientWidth;
    h = canvas.clientHeight;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    thresh = Math.min(w, h) * 0.20;
    var count = Math.round((w * h) / 16000);
    var n = Math.max(24, Math.min(140, count));
    var cx = w * 0.66, cy = h * 0.48, R = Math.min(w, h) * 0.46;
    nodes = Array.from({ length: n }, function () {
      var a = Math.random() * Math.PI * 2, rr = Math.sqrt(Math.random()) * R;
      return {
        x: cx + Math.cos(a) * rr * (0.9 + Math.random() * 0.9),
        y: cy + Math.sin(a) * rr,
        vx: (Math.random() - 0.5) * 0.12,
        vy: (Math.random() - 0.5) * 0.12,
        r: 0.8 + Math.random() * 1.7,
        p: Math.random() * Math.PI * 2
      };
    });
    pulses = Array.from({ length: Math.max(4, Math.round(n * 0.12)) }, newPulse);
  }

  function drawFrame(advance) {
    if (!ctx || !nodes) return;
    var rgb = hexRgb(accent), ar = rgb[0], ag = rgb[1], ab = rgb[2];
    var ox = (pointer.x - 0.5) * 22, oy = (pointer.y - 0.5) * 16;

    ctx.clearRect(0, 0, w, h);
    var g = ctx.createRadialGradient(w * 0.66, h * 0.46, 0, w * 0.66, h * 0.46, Math.min(w, h) * 0.6);
    g.addColorStop(0, "rgba(" + ar + "," + ag + "," + ab + ",0.12)");
    g.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);

    if (advance) {
      nodes.forEach(function (nd) {
        nd.x += nd.vx; nd.y += nd.vy; nd.p += 0.01;
        if (nd.x < -40) nd.x = w + 40; if (nd.x > w + 40) nd.x = -40;
        if (nd.y < -40) nd.y = h + 40; if (nd.y > h + 40) nd.y = -40;
      });
    }

    ctx.lineWidth = 1;
    for (var i = 0; i < nodes.length; i++) {
      var a = nodes[i];
      for (var j = i + 1; j < nodes.length; j++) {
        var b = nodes[j];
        var dx = a.x - b.x, dy = a.y - b.y, d = Math.hypot(dx, dy);
        if (d < thresh) {
          var al = (1 - d / thresh) * 0.34;
          ctx.strokeStyle = "rgba(" + ar + "," + ag + "," + ab + "," + al + ")";
          ctx.beginPath(); ctx.moveTo(a.x + ox, a.y + oy); ctx.lineTo(b.x + ox, b.y + oy); ctx.stroke();
        }
      }
    }

    if (advance) {
      pulses.forEach(function (pl, idx) {
        if (!pl) { pl = pulses[idx] = newPulse(); if (!pl) return; }
        pl.t += pl.s;
        if (pl.t >= 1) { pulses[idx] = newPulse(); return; }
        var a = nodes[pl.a], b = nodes[pl.b];
        if (!a || !b) { pulses[idx] = newPulse(); return; }
        var x = a.x + (b.x - a.x) * pl.t + ox, y = a.y + (b.y - a.y) * pl.t + oy;
        ctx.beginPath(); ctx.arc(x, y, 2.2, 0, Math.PI * 2); ctx.fillStyle = "rgba(" + ar + "," + ag + "," + ab + ",0.95)"; ctx.fill();
        ctx.beginPath(); ctx.arc(x, y, 6, 0, Math.PI * 2); ctx.fillStyle = "rgba(" + ar + "," + ag + "," + ab + ",0.18)"; ctx.fill();
      });
    }

    nodes.forEach(function (nd) {
      var tw = 0.6 + Math.sin(nd.p) * 0.4;
      ctx.beginPath(); ctx.arc(nd.x + ox, nd.y + oy, nd.r, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(244,242,236," + (0.35 + tw * 0.4) + ")"; ctx.fill();
    });
  }

  function loop() {
    drawFrame(true);
    raf = requestAnimationFrame(loop);
  }

  setup();

  if (reducedMotion) {
    // Static single frame: no drift, no travelling pulses, no pointer parallax.
    drawFrame(false);
    window.addEventListener("resize", function () { setup(); drawFrame(false); });
  } else {
    window.addEventListener("resize", setup);
    root.addEventListener("pointermove", function (e) {
      var r = root.getBoundingClientRect();
      pointer.tx = (e.clientX - r.left) / r.width;
      pointer.ty = (e.clientY - r.top) / r.height;
    });
    loop();
  }
})();
