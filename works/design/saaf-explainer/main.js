/* ==========================================================================
   SaaF paper explainer — interactions
   No dependencies. Canvas 2D throughout.
   ========================================================================== */

(() => {
  'use strict';

  const TAU = Math.PI * 2;
  const REDUCED = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const lerp = (a, b, t) => a + (b - a) * t;
  const damp = (dt, k) => 1 - Math.exp(-dt * k);

  /* ---------------------------------------------------------------- utils */

  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  const hex = (h) => {
    const n = parseInt(h.slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  };
  const mix = (c1, c2, t) => [lerp(c1[0], c2[0], t), lerp(c1[1], c2[1], t), lerp(c1[2], c2[2], t)];
  const rgba = (c, a) => `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a.toFixed(3)})`;

  async function copyText(text, btn) {
    const done = () => { const old = btn.textContent; btn.textContent = 'Copied'; setTimeout(() => { btn.textContent = old; }, 1600); };
    try {
      await navigator.clipboard.writeText(text);
      done();
    } catch (e) {
      const ta = document.createElement('textarea');
      ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy'); done(); } catch (e2) { /* clipboard blocked */ }
      ta.remove();
    }
  }

  /* --------------------------------------------------------- point shapes */

  function addBox(out, sx, sy, sz, cx, cy, cz, r, density = 42) {
    const ax = sx / 2, ay = sy / 2, az = sz / 2;
    const areas = [ax * az, ax * az, ax * ay, ax * ay, ay * az, ay * az];
    const total = areas.reduce((a, b) => a + b, 0);
    const n = Math.max(10, Math.round(total * density));
    for (let i = 0; i < n; i++) {
      let t = r() * total, f = 0;
      while (t > areas[f] && f < 5) { t -= areas[f]; f++; }
      const u = r() * 2 - 1, v = r() * 2 - 1;
      let x, y, z;
      if (f === 0) { x = u * ax; z = v * az; y = ay; }
      else if (f === 1) { x = u * ax; z = v * az; y = -ay; }
      else if (f === 2) { x = u * ax; y = v * ay; z = az; }
      else if (f === 3) { x = u * ax; y = v * ay; z = -az; }
      else if (f === 4) { x = ax; y = v * ay; z = u * az; }
      else { x = -ax; y = v * ay; z = u * az; }
      out.push(cx + x, cy + y, cz + z);
    }
  }

  function addSphere(out, rad, cx, cy, cz, r, n) {
    for (let i = 0; i < n; i++) {
      const u = r() * 2 - 1, th = r() * TAU, s = Math.sqrt(1 - u * u);
      out.push(cx + rad * s * Math.cos(th), cy + rad * u, cz + rad * s * Math.sin(th));
    }
  }

  function addLathe(out, profile, cx, cy, cz, r, density = 300, caps = true) {
    const n = profile.length;
    for (let i = 0; i < n - 1; i++) {
      const [r0, y0] = profile[i], [r1, y1] = profile[i + 1];
      const len = Math.hypot(r1 - r0, y1 - y0);
      const area = TAU * ((r0 + r1) / 2) * len;
      const count = Math.max(4, Math.round(area * density));
      for (let k = 0; k < count; k++) {
        const t = r(), rr = lerp(r0, r1, t), yy = lerp(y0, y1, t), th = r() * TAU;
        out.push(cx + rr * Math.cos(th), cy + yy, cz + rr * Math.sin(th));
      }
    }
    if (caps) {
      const capR = (rad, yy) => {
        const count = Math.max(6, Math.round(Math.PI * rad * rad * density));
        for (let k = 0; k < count; k++) {
          const th = r() * TAU, u = Math.sqrt(r());
          out.push(cx + rad * u * Math.cos(th), cy + yy, cz + rad * u * Math.sin(th));
        }
      };
      if (profile[0][0] > 0.02) capR(profile[0][0], profile[0][1]);
      if (profile[n - 1][0] > 0.02) capR(profile[n - 1][0], profile[n - 1][1]);
    }
  }

  /* ------------------------------------------------------------- scenes */

  const PAL = {
    steel: '#9aa0a6', bench: '#b0865a',
    can: '#d93025', juice: '#e8710a', round: '#4b86ad', shaped: '#5c8a5e',
    tart: '#bf7a35', grapes: '#3f9d4a',
    fCan: '#d1685f', fJuice: '#d9a45c', fRound: '#6a9fb5', fShaped: '#6aa89a'
  };

  function buildBenchScene(r) {
    const bench = [], tart = [], grapes = [];
    addBox(bench, 3.3, 0.16, 1.1, 0, -0.12, 0, r, 1500);
    addBox(bench, 3.3, 0.3, 0.09, 0, 0.19, -0.5, r, 1400);
    addBox(bench, 0.14, 0.6, 0.5, -1.5, -0.48, 0.28, r, 380);
    addBox(bench, 0.14, 0.6, 0.5, 1.5, -0.48, 0.28, r, 380);
    addBox(bench, 0.14, 0.6, 0.5, -1.5, -0.48, -0.28, r, 380);
    addBox(bench, 0.14, 0.6, 0.5, 1.5, -0.48, -0.28, r, 380);

    const baseY = -0.04;
    addLathe(tart, [
      [0.0, 0.0], [0.5, 0.0], [0.52, 0.05], [0.5, 0.14], [0.44, 0.17]
    ], -0.78, baseY, 0.08, r, 620, true);
    for (let i = 0; i < 140; i++) {
      const th = r() * TAU, rad = Math.sqrt(r()) * 0.4;
      tart.push(-0.78 + rad * Math.cos(th), baseY + 0.16, 0.08 + rad * Math.sin(th));
    }

    const gc = [[0, 0, 0], [0.22, 0.03, 0.02], [-0.22, 0.05, -0.02], [0, -0.03, 0.22], [0, 0.06, -0.22],
      [0.16, 0.2, 0.12], [-0.16, 0.19, 0.1], [0.14, 0.18, -0.14], [-0.15, 0.21, -0.12], [0, 0.3, 0.02]];
    for (const [gx, gy, gz] of gc) addSphere(grapes, 0.15, 0.86 + gx, baseY + 0.24 + gy, -0.02 + gz, r, 130);

    return [
      { id: 'bench', color: hex(PAL.bench), feature: hex(PAL.bench), points: bench, baseAlpha: 0.85, sizeScale: 0.72 },
      { id: 'tart', color: hex(PAL.tart), feature: hex(PAL.tart), points: tart, baseAlpha: 0.9, shadowY: -0.03 },
      { id: 'grapes', color: hex(PAL.grapes), feature: hex(PAL.grapes), points: grapes, baseAlpha: 0.9, shadowY: -0.03 }
    ];
  }

  function buildBottleScene(r) {
    const table = [], can = [], juice = [], round = [], shaped = [];
    addBox(table, 3.9, 0.14, 1.7, 0, -0.62, 0, r, 320);
    addBox(table, 0.12, 0.6, 0.12, -1.8, -0.95, 0.75, r, 320);
    addBox(table, 0.12, 0.6, 0.12, 1.8, -0.95, 0.75, r, 320);
    addBox(table, 0.12, 0.6, 0.12, -1.8, -0.95, -0.75, r, 320);
    addBox(table, 0.12, 0.6, 0.12, 1.8, -0.95, -0.75, r, 320);

    const baseY = -0.55;
    addLathe(can, [
      [0.0, 0.0], [0.26, 0.0], [0.26, 0.62], [0.21, 0.68], [0.23, 0.72]
    ], -1.32, baseY, 0.06, r, 460, true);
    addLathe(juice, [
      [0.0, 0.0], [0.3, 0.0], [0.3, 0.62], [0.26, 0.78], [0.12, 0.98], [0.1, 1.14], [0.15, 1.19], [0.15, 1.26]
    ], -0.44, baseY, -0.02, r, 420, true);
    addLathe(round, [
      [0.0, 0.0], [0.27, 0.0], [0.27, 0.78], [0.2, 0.9], [0.13, 1.02], [0.13, 1.16]
    ], 0.44, baseY, 0.05, r, 420, true);
    addLathe(shaped, [
      [0.0, 0.0], [0.3, 0.0], [0.32, 0.1], [0.32, 0.6], [0.24, 0.74], [0.11, 0.92], [0.11, 1.08]
    ], 1.32, baseY, -0.05, r, 420, true);

    return [
      { id: 'table', color: hex(PAL.steel), feature: hex(PAL.steel), points: table, baseAlpha: 0.8, sizeScale: 0.72 },
      { id: 'coke', color: hex(PAL.can), feature: hex(PAL.fCan), points: can, baseAlpha: 0.9, shadowY: -0.54 },
      { id: 'juice', color: hex(PAL.juice), feature: hex(PAL.fJuice), points: juice, baseAlpha: 0.9, shadowY: -0.54 },
      { id: 'round', color: hex(PAL.round), feature: hex(PAL.fRound), points: round, baseAlpha: 0.9, shadowY: -0.54 },
      { id: 'shaped', color: hex(PAL.shaped), feature: hex(PAL.fShaped), points: shaped, baseAlpha: 0.9, shadowY: -0.54 }
    ];
  }

  /* ------------------------------------------------------------ Field (3D) */

  class Field {
    constructor(canvas, objects, opts = {}) {
      this.cv = canvas;
      this.ctx = canvas.getContext('2d');
      this.objects = objects.map((o) => Object.assign({
        hl: 0, hlT: 0, hlColor: [255, 255, 255], dim: 1, dimT: 1, pulse: false, feature: o.color
      }, o));
      this.opts = Object.assign({
        rot: -0.55, rotSpeed: 0.1, elev: 0.34, zoom: 1, cx: 0.5, cy: 0.56,
        fov: 2.6, baseR: 1.15, dprMax: 2, drag: true
      }, opts);
      this.rot = this.opts.rot;
      this.targetRot = this.rot;
      this.time = 0; this.last = 0; this.raf = 0;
      this.w = 0; this.h = 0; this.dpr = 1; this.u = 100;
      this.dragging = false; this.lastX = 0;
      this._ro = new ResizeObserver(() => this.resize());
      this._ro.observe(this.cv);
      this.resize();
      if (this.opts.drag) this.bindDrag();
      this._io = new IntersectionObserver((ents) => {
        this.visible = ents.some((e) => e.isIntersecting);
        if (this.visible) this.start();
      }, { rootMargin: '80px' });
      this._io.observe(this.cv);
      this.visible = true;
      this.start();
      canvas.__field = this;
    }

    resize() {
      const rect = this.cv.getBoundingClientRect();
      const dpr = Math.min(this.opts.dprMax, window.devicePixelRatio || 1);
      const w = Math.max(1, Math.round(rect.width));
      const h = Math.max(1, Math.round(rect.height));
      if (w === this.w && h === this.h && dpr === this.dpr) return;
      this.w = w; this.h = h; this.dpr = dpr;
      this.cv.width = Math.round(w * dpr);
      this.cv.height = Math.round(h * dpr);
      this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      this.u = Math.min(w / 4.7, h / 2.8) * this.opts.zoom;
      this.draw();
    }

    layout() {
      const rect = this.cv.getBoundingClientRect();
      this.u = Math.min(Math.max(1, rect.width) / 4.7, Math.max(1, rect.height) / 2.8) * this.opts.zoom;
      this.draw();
    }

    bindDrag() {
      const cv = this.cv;
      cv.addEventListener('pointerdown', (e) => {
        this.dragging = true; this.lastX = e.clientX;
        cv.setPointerCapture(e.pointerId);
      });
      cv.addEventListener('pointermove', (e) => {
        if (!this.dragging) return;
        const dx = e.clientX - this.lastX;
        this.lastX = e.clientX;
        this.targetRot += dx * 0.006;
        if (REDUCED) this.draw();
      });
      const up = () => { this.dragging = false; };
      cv.addEventListener('pointerup', up);
      cv.addEventListener('pointercancel', up);
    }

    set(id, state) {
      const o = this.objects.find((x) => x.id === id);
      if (!o) return;
      if ('hl' in state) o.hlT = state.hl;
      if ('hlColor' in state) o.hlColor = state.hlColor;
      if ('dim' in state) o.dimT = state.dim;
      if ('pulse' in state) o.pulse = state.pulse;
    }

    clearStates() {
      for (const o of this.objects) { o.hlT = 0; o.dimT = 1; o.pulse = false; }
    }

    start() {
      if (REDUCED) { this.draw(); return; }
      if (this.raf) return;
      this.last = performance.now();
      const tick = (now) => {
        const dt = Math.min(0.05, (now - this.last) / 1000);
        this.last = now;
        this.time += dt;
        if (!this.dragging) this.targetRot += this.opts.rotSpeed * dt;
        this.rot += (this.targetRot - this.rot) * damp(dt, 5);
        for (const o of this.objects) {
          o.hl += (o.hlT - o.hl) * damp(dt, 7);
          o.dim += (o.dimT - o.dim) * damp(dt, 6);
        }
        this.draw();
        this.raf = requestAnimationFrame(tick);
      };
      this.raf = requestAnimationFrame(tick);
    }

    stop() { if (this.raf) { cancelAnimationFrame(this.raf); this.raf = 0; } }

    draw() {
      const { ctx, w, h } = this;
      if (!w || !h) return;
      ctx.clearRect(0, 0, w, h);
      ctx.globalCompositeOperation = 'source-over';
      const cx = w * this.opts.cx, cy = h * this.opts.cy;
      const cosR = Math.cos(this.rot), sinR = Math.sin(this.rot);
      const cosE = Math.cos(this.opts.elev), sinE = Math.sin(this.opts.elev);
      const u = this.u, fov = this.opts.fov;

      // ground shadows: project each object's footprint onto its surface
      ctx.fillStyle = 'rgba(32,33,36,0.075)';
      for (const o of this.objects) {
        if (o.shadowY === undefined) continue;
        const pts = o.points;
        const dimF = clamp(o.dim, 0, 1);
        for (let i = 0; i < pts.length; i += 9) {
          const x = pts[i], z = pts[i + 2];
          const rx = x * cosR - z * sinR;
          const rz = x * sinR + z * cosR;
          const ry = o.shadowY * cosE - rz * sinE;
          const depth = o.shadowY * sinE + rz * cosE;
          const s = fov / (fov + depth + 2.1);
          const px = cx + rx * s * u, py = cy - ry * s * u;
          if (dimF < 0.9) continue;
          ctx.fillRect(px - 1.1, py - 1.1, 2.2, 2.2);
        }
      }

      for (const o of this.objects) {
        const hl = o.pulse ? clamp(0.34 + 0.34 * Math.sin(this.time * 3.6), 0, 1) : o.hl;
        const col = mix(o.color, o.hlColor, hl);
        const alpha = clamp(o.baseAlpha * clamp(o.dim, 0, 1) * (0.8 + 0.2 * hl), 0, 1);
        const sizeScale = o.sizeScale || 1;
        const pts = o.points;
        const bins = [[], [], [], [], []];
        for (let i = 0; i < pts.length; i += 3) {
          const x = pts[i], y = pts[i + 1], z = pts[i + 2];
          const rx = x * cosR - z * sinR;
          const rz = x * sinR + z * cosR;
          const ry = y * cosE - rz * sinE;
          const depth = y * sinE + rz * cosE;
          const s = fov / (fov + depth + 2.1);
          const px = cx + rx * s * u;
          const py = cy - ry * s * u;
          const sz = clamp(this.opts.baseR * s * 2.4 * sizeScale, 0.6, 3.6);
          const b = clamp(Math.floor((s - 0.38) / 0.42 * 5), 0, 4);
          bins[b].push(px, py, sz);
        }
        for (let b = 0; b < 5; b++) {
          const arr = bins[b];
          if (!arr.length) continue;
          ctx.fillStyle = rgba(col, clamp(alpha * (0.5 + 0.125 * b), 0, 1));
          for (let i = 0; i < arr.length; i += 3) {
            const s2 = arr[i + 2];
            ctx.fillRect(arr[i] - s2 / 2, arr[i + 1] - s2 / 2, s2, s2);
          }
        }
      }
    }
  }

  /* ------------------------------------------------------ SpaceCanvas (2D) */

  const SPC = {
    grid: '#e8eaed', axis: '#bdc1c6',
    label: '#5f6368', dim: '#6b7075',
    mu: '#b06000', accent: '#1a73e8', ok: '#188038', amb: '#b06000'
  };

  class SpaceCanvas {
    constructor(canvas, cfg) {
      this.cv = canvas;
      this.ctx = canvas.getContext('2d');
      this.cfg = cfg;
      this.toggles = { pos: true, neg: true, reconst: true };
      this.mu = 0.5;
      this.queryId = cfg.defaultQuery || null;
      this.w = 0; this.h = 0; this.dpr = 1;
      this.time = 0; this.started = false; this.raf = 0; this.last = 0;
      const r = mulberry32(cfg.seed || 7);
      this.dots = [];
      for (const it of cfg.items) {
        for (let i = 0; i < it.n; i++) {
          this.dots.push({
            item: it,
            jn: (r() * 2 - 1), ja: (r() * 2 - 1),
            bn: (r() * 2 - 1), ba: (r() * 2 - 1),
            x: 0, y: 0, x0: null
          });
        }
      }
      for (const lb of cfg.labels || []) {
        this.dots.push({ item: lb, single: true, x: 0, y: 0, x0: null });
      }
      this._ro = new ResizeObserver(() => this.resize());
      this._ro.observe(canvas);
      this.resize();
      this._io = new IntersectionObserver((ents) => {
        const vis = ents.some((e) => e.isIntersecting);
        if (vis) { this.show(); } else { this.stop(); }
      }, { rootMargin: '40px' });
      this._io.observe(canvas);
    }

    resize() {
      const rect = this.cv.getBoundingClientRect();
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const w = Math.max(1, Math.round(rect.width)), h = Math.max(1, Math.round(rect.height));
      if (w === this.w && h === this.h) return;
      this.w = w; this.h = h; this.dpr = dpr;
      this.cv.width = Math.round(w * dpr); this.cv.height = Math.round(h * dpr);
      this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      this.R = Math.min(w, h) * 0.44;
      this.k = this.R / 1.7;
      this.cx = w / 2; this.cy = h / 2 + 6;
      if (this.dots[0] && this.dots[0].x0 === null) this.layout0();
      this.frame(0);
    }

    show() {
      if (!this.started) { this.started = true; if (REDUCED) this.layout0(); }
      if (REDUCED) { this.frame(0); return; }
      if (this.raf) return;
      this.last = performance.now();
      const tick = (now) => {
        const dt = Math.min(0.05, (now - this.last) / 1000);
        this.last = now; this.time += dt;
        this.frame(dt);
        this.raf = requestAnimationFrame(tick);
      };
      this.raf = requestAnimationFrame(tick);
    }

    stop() { if (this.raf) { cancelAnimationFrame(this.raf); this.raf = 0; } }

    layout0() {
      const k = this.k;
      for (const d of this.dots) {
        const it = d.item;
        const bn = d.bn || 0, ba = d.ba || 0;
        const norm = it.norm * (0.75 + Math.abs(bn) * 0.6);
        const ang = (it.angle || 0) * 0.3 + 0.5 + ba * 0.5;
        d.x0 = this.cx + Math.cos(ang) * Math.max(0.08, norm) * k;
        d.y0 = this.cy - Math.sin(ang) * Math.max(0.08, norm) * k;
        d.x = d.x0; d.y = d.y0;
      }
    }

    targets() {
      const out = new Map();
      const t = this.toggles;
      let commonAng = null;
      if (!t.neg) {
        commonAng = -0.7;
      }
      for (const it of this.cfg.items) {
        let norm = it.norm, ang = it.angle, spread = it.spread;
        if (!t.pos) spread = spread * 3.6;
        if (!t.reconst) { norm = Math.min(norm * 1.35, 1.62); spread *= 1.45; }
        if (!t.neg) { norm = 0.42; ang = commonAng; spread *= 1.15; }
        out.set(it, { norm, ang, spread });
      }
      for (const lb of this.cfg.labels || []) {
        let norm = lb.norm;
        if (!t.reconst) norm = 1.15;
        if (!t.neg) norm = Math.min(norm, 0.3);
        out.set(lb, { norm, ang: lb.angle, spread: 0 });
      }
      return out;
    }

    posOf(item, d, tt) {
      const k = this.k;
      const jn = (d.jn || 0) * tt.spread, ja = (d.ja || 0) * 0.22;
      const norm = Math.max(0.05, tt.norm + jn * 0.35);
      const ang = tt.ang + ja * Math.min(1, tt.spread * 3);
      return [this.cx + Math.cos(ang) * norm * k, this.cy - Math.sin(ang) * norm * k];
    }

    centroidOf(id) {
      let sx = 0, sy = 0, n = 0;
      for (const d of this.dots) {
        if (d.item.id !== id) continue;
        sx += d.x; sy += d.y; n++;
      }
      return n ? [sx / n, sy / n] : null;
    }

    redraw() { this.draw(this.targets()); }

    frame(dt) {
      const ctx = this.ctx;
      if (!this.w) return;
      const tt = this.targets();
      for (const d of this.dots) {
        const t = d.single ? { norm: tt.get(d.item).norm, ang: tt.get(d.item).ang, spread: 0 } : tt.get(d.item);
        const [tx, ty] = this.posOf(d.item, d, t);
        const kk = dt ? damp(dt, 3.2) : 1;
        d.x = lerp(d.x, tx, kk);
        d.y = lerp(d.y, ty, kk);
      }
      this.draw(tt);
    }

    draw(tt) {
      const { ctx, w, h, cx, cy, k } = this;
      ctx.clearRect(0, 0, w, h);

      // radial grid
      ctx.strokeStyle = SPC.grid;
      ctx.lineWidth = 1;
      ctx.font = '9px "IBM Plex Mono", monospace';
      ctx.fillStyle = SPC.dim;
      ctx.textAlign = 'center';
      for (const n of [0.5, 1.0, 1.5]) {
        ctx.beginPath();
        ctx.arc(cx, cy, n * k, 0, TAU);
        ctx.stroke();
        ctx.fillText(n.toFixed(1), cx, cy - n * k - 4);
      }

      // origin
      ctx.strokeStyle = SPC.axis;
      ctx.beginPath();
      ctx.moveTo(cx - 5, cy); ctx.lineTo(cx + 5, cy);
      ctx.moveTo(cx, cy - 5); ctx.lineTo(cx, cy + 5);
      ctx.stroke();
      ctx.fillStyle = SPC.dim;
      ctx.textAlign = 'left';
      ctx.fillText('origin', cx + 8, cy + 14);

      // threshold circle
      ctx.strokeStyle = SPC.mu;
      ctx.setLineDash([5, 5]);
      ctx.beginPath();
      ctx.arc(cx, cy, this.mu * k, 0, TAU);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = SPC.amb;
      ctx.textAlign = 'right';
      ctx.fillText('μ = ' + this.mu.toFixed(2), cx - this.mu * k * 0.71 - 8, cy + this.mu * k * 0.71 + 12);

      // cluster halos
      let itemIndex = 0;
      for (const it of this.cfg.items) {
        const t = tt.get(it);
        const px = cx + Math.cos(t.ang) * t.norm * k;
        const py = cy - Math.sin(t.ang) * t.norm * k;
        const rad = 20 + t.spread * k * 0.42;
        ctx.strokeStyle = rgba(it.rgb, 0.2);
        ctx.setLineDash([3, 5]);
        ctx.beginPath();
        ctx.arc(px, py, rad, 0, TAU);
        ctx.stroke();
        ctx.setLineDash([]);
        // label: radial out from origin, or a fixed slot when the cluster is near the middle
        let lx = px - cx, ly = py - cy;
        const dist = Math.hypot(lx, ly);
        if (dist < 0.75 * k) {
          const a = 0.9 + itemIndex * 1.35;
          lx = Math.cos(a); ly = -Math.sin(a);
        } else { lx /= dist; ly /= dist; }
        const off = rad * 0.8 + 14;
        ctx.fillStyle = SPC.label;
        ctx.textAlign = lx > 0.12 ? 'left' : lx < -0.12 ? 'right' : 'center';
        const tw = ctx.measureText(it.label).width;
        let tx = px + lx * off;
        if (ctx.textAlign === 'left') tx = Math.min(tx, w - 8 - tw);
        else if (ctx.textAlign === 'right') tx = Math.max(tx, 8 + tw);
        ctx.fillText(it.label, tx, py + ly * off + 4);
        itemIndex++;
      }

      // dots
      for (const d of this.dots) {
        const col = d.item.rgb;
        const isQuery = this.queryId && d.item.id === this.queryId;
        const r = d.single ? 5.5 : 3.6;
        if (isQuery) {
          const pulse = 1 + 0.25 * Math.sin(this.time * 4);
          ctx.beginPath();
          ctx.arc(d.x, d.y, 16 * pulse, 0, TAU);
          ctx.fillStyle = rgba(col, 0.12);
          ctx.fill();
        }
        ctx.beginPath();
        ctx.arc(d.x, d.y, r + 4, 0, TAU);
        ctx.fillStyle = rgba(col, isQuery ? 0.28 : 0.14);
        ctx.fill();
        ctx.beginPath();
        ctx.arc(d.x, d.y, r, 0, TAU);
        ctx.fillStyle = rgba(col, 0.95);
        ctx.fill();
        if (d.single) {
          ctx.fillStyle = rgba(col, 0.9);
          ctx.font = '11px "IBM Plex Mono", monospace';
          ctx.textAlign = 'left';
          ctx.fillText(d.item.label, d.x + 13, d.y + 4);
          ctx.font = '9px "IBM Plex Mono", monospace';
        }
      }

      // query vector
      if (this.queryId) {
        const c = this.centroidOf(this.queryId);
        if (c) {
          const [qx, qy] = c;
          const norm = Math.hypot(qx - cx, qy - cy) / k;
          const amb = norm < this.mu;
          ctx.strokeStyle = 'rgba(26,115,232,0.65)';
          ctx.lineWidth = 1.4;
          ctx.setLineDash([4, 4]);
          ctx.beginPath();
          ctx.moveTo(cx, cy); ctx.lineTo(qx, qy);
          ctx.stroke();
          ctx.setLineDash([]);
          ctx.fillStyle = SPC.accent;
          ctx.font = '11px "IBM Plex Mono", monospace';
          ctx.textAlign = qx < cx ? 'left' : 'right';
          ctx.fillText('‖q‖ = ' + norm.toFixed(2), qx + (qx < cx ? 13 : -13), qy + 22);
          ctx.fillStyle = amb ? SPC.amb : SPC.ok;
          ctx.textAlign = 'left';
          ctx.fillText(amb ? 'AMBIGUOUS · ask which one' : 'CONFIDENT · retrieve', 16, h - 16);
        }
      }
    }
  }

  /* ------------------------------------------------------------- boot */

  function onReady(fn) {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', fn);
    else fn();
  }

  onReady(() => {
    const hexy = hex;
    const benchRng = mulberry32(20260714);
    const bottleRng = mulberry32(411);
    const benchObjects = buildBenchScene(benchRng);
    const bottleObjects = buildBottleScene(bottleRng);

    for (const o of benchObjects) o.rgb = hexy(
      o.id === 'tart' ? PAL.tart : o.id === 'grapes' ? PAL.grapes : PAL.bench);
    for (const o of bottleObjects) o.rgb = hexy(
      o.id === 'coke' ? PAL.can : o.id === 'juice' ? PAL.juice : o.id === 'round' ? PAL.round : o.id === 'shaped' ? PAL.shaped : PAL.steel);

    /* -------- reveal on scroll + bars -------- */
    const marks = document.querySelectorAll('.reveal, .anim-in, .norm-row');
    if (REDUCED) {
      marks.forEach((el) => el.classList.add('in'));
      document.querySelectorAll('.loop-step').forEach((el) => { el.style.opacity = '1'; });
    } else {
      const io = new IntersectionObserver((ents) => {
        for (const e of ents) {
          if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); }
        }
      }, { threshold: 0.14, rootMargin: '0px 0px -6% 0px' });
      marks.forEach((el) => io.observe(el));
    }

    // set bar widths
    document.querySelectorAll('.bars').forEach((group) => {
      const max = parseFloat(group.dataset.max || '100');
      group.querySelectorAll('.barrow').forEach((row) => {
        row.style.setProperty('--w', clamp(parseFloat(row.dataset.value) / max, 0, 1).toFixed(3));
      });
    });
    document.querySelectorAll('.ablation').forEach((group) => {
      group.querySelectorAll('.abar').forEach((row) => {
        row.style.setProperty('--w', (parseFloat(row.dataset.value) / 100).toFixed(3));
      });
    });

    /* -------- progress + nav -------- */
    const prog = document.getElementById('progressBar');
    const tocDetails = document.querySelector('.toc-details');
    if (tocDetails) {
      const wide = window.matchMedia('(min-width: 1121px)');
      if (!wide.matches) tocDetails.open = false;
      wide.addEventListener('change', (e) => { if (e.matches) tocDetails.open = true; });
    }
    const navLinks = Array.from(document.querySelectorAll('.toc a'));
    const sections = navLinks.map((a) => document.querySelector(a.getAttribute('href'))).filter(Boolean);
    let ticking = false;
    const onScroll = () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(() => {
        const max = document.documentElement.scrollHeight - window.innerHeight;
        prog.style.width = (max > 0 ? clamp(window.scrollY / max, 0, 1) * 100 : 0) + '%';
        ticking = false;
      });
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
    const navIO = new IntersectionObserver((ents) => {
      for (const e of ents) {
        if (!e.isIntersecting) continue;
        navLinks.forEach((a) => {
          const current = a.getAttribute('href') === '#' + e.target.id;
          a.classList.toggle('current', current);
          if (current) a.setAttribute('aria-current', 'true');
          else a.removeAttribute('aria-current');
        });
      }
    }, { rootMargin: '-42% 0px -52% 0px' });
    sections.forEach((s) => navIO.observe(s));

    /* -------- hero field + demo loop -------- */
    const heroField = new Field(document.getElementById('hero-canvas'), benchObjects.map((o) => Object.assign({}, o)), {
      zoom: 1.7, rotSpeed: 0.09, cx: 0.56, cy: 0.46, elev: 0.32
    });

    const AMB = hexy('#b06000');
    const OK = hexy('#188038');

    const tickerVisible = new WeakMap();
    const tickerIO = new IntersectionObserver((ents) => {
      for (const e of ents) tickerVisible.set(e.target, e.isIntersecting);
    }, { rootMargin: '80px' });

    /* -------- chapter 1: interaction loop -------- */
    const loopSteps = Array.from(document.querySelectorAll('#loopDiagram .loop-step'));
    const loopEl = document.getElementById('loopDiagram');
    if (!REDUCED && loopSteps.length) {
      tickerIO.observe(loopEl);
      const passes = 2;
      let li = 0;
      const tickLoop = () => {
        if (!tickerVisible.get(loopEl)) { setTimeout(tickLoop, 1900); return; }
        if (li >= loopSteps.length * passes) {
          loopEl.classList.add('done');
          loopSteps.forEach((s, i) => s.classList.toggle('active', i === loopSteps.length - 1));
          return;
        }
        loopSteps.forEach((s, i) => s.classList.toggle('active', i === li % loopSteps.length));
        li++;
        setTimeout(tickLoop, 1900);
      };
      tickLoop();
    } else {
      loopSteps.forEach((s) => s.classList.add('active'));
    }

    /* -------- chapter 2: field canvas -------- */
    const fieldCanvas = document.getElementById('field-canvas');
    const field = new Field(fieldCanvas, bottleObjects.map((o) => Object.assign({}, o)), {
      zoom: 1.55, rotSpeed: 0.075, cx: 0.5, cy: 0.54
    });
    const fieldNote = document.getElementById('fieldNote');
    const SIM = {
      bottle: { coke: 0.60, juice: 0.56, round: 0.71, shaped: 0.69, table: 0.3 },
      coke: { coke: 0.84, juice: 0.4, round: 0.41, shaped: 0.38, table: 0.28 },
      juice: { coke: 0.4, juice: 0.83, round: 0.42, shaped: 0.39, table: 0.28 }
    };
    let fieldMode = 'rgb', fieldQuery = 'bottle';

    const RGB_COLORS = {
      table: PAL.steel, coke: PAL.can, juice: PAL.juice, round: PAL.round, shaped: PAL.shaped,
      bench: PAL.bench, tart: PAL.tart, grapes: PAL.grapes
    };
    const FEATURE_COLORS = {
      table: PAL.steel, coke: PAL.fCan, juice: PAL.fJuice, round: PAL.fRound, shaped: PAL.fShaped
    };

    function applyField() {
      for (const o of field.objects) o.pulse = false;
      if (fieldMode === 'rgb' || fieldMode === 'sim') {
        for (const o of field.objects) o.color = hexy(RGB_COLORS[o.id] || PAL.steel);
      } else {
        for (const o of field.objects) o.color = hexy(FEATURE_COLORS[o.id] || PAL.steel);
      }
      if (fieldMode === 'rgb') {
        field.clearStates();
        fieldNote.textContent = 'RGB render: what the reconstruction looks like as a point cloud. Every point also carries a language vector, invisible in this view.';
      } else if (fieldMode === 'features') {
        field.clearStates();
        fieldNote.textContent = 'Language features: the per-point vectors drawn as color. The two generic bottles are nearly the same color, so a query cannot separate them reliably. That is failure A.';
      } else {
        const scores = SIM[fieldQuery];
        const vals = Object.values(scores);
        const lo = Math.min(...vals), hi = Math.max(...vals);
        for (const o of field.objects) {
          const t = (scores[o.id] - lo) / Math.max(0.0001, hi - lo);
          const hot = o.id !== 'table';
          if (hot) {
            o.pulse = false;
            o.hlT = 0.15 + 0.85 * t;
            o.hlColor = t > 0.8 ? OK : AMB;
            o.dimT = 1;
          } else {
            o.hlT = 0; o.dimT = 0.5;
          }
        }
        fieldNote.textContent = 'Query similarity: every point scored by cosine similarity to “' + (fieldQuery === 'juice' ? 'orange juice' : fieldQuery) + '”. High-scoring regions light up. With “bottle”, several objects compete and no single region wins cleanly.';
      }
    }

    const fieldModes = document.getElementById('fieldModes');
    fieldModes.addEventListener('click', (e) => {
      const btn = e.target.closest('button');
      if (!btn) return;
      fieldMode = btn.dataset.mode;
      fieldModes.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(b === btn)));
      applyField();
    });
    const fieldQueries = document.getElementById('fieldQueries');
    fieldQueries.addEventListener('click', (e) => {
      const btn = e.target.closest('button');
      if (!btn) return;
      fieldQuery = btn.dataset.q;
      fieldQueries.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(b === btn)));
      if (fieldMode !== 'sim') {
        fieldMode = 'sim';
        fieldModes.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.mode === 'sim')));
      }
      applyField();
    });
    applyField();

    /* -------- chapter 3: compression demo -------- */
    const compressCanvas = document.getElementById('compress-canvas');
    const compressRange = document.getElementById('compressRange');
    const compressOut = document.getElementById('compressOut');
    const cctx = compressCanvas.getContext('2d');
    const cRng = mulberry32(99);
    const clusterPts = [];
    for (let c = 0; c < 2; c++) {
      for (let i = 0; i < 120; i++) {
        const u = cRng(), v = cRng();
        const g1 = Math.sqrt(-2 * Math.log(u + 1e-6)) * Math.cos(TAU * v);
        const g2 = Math.sqrt(-2 * Math.log(u + 1e-6)) * Math.sin(TAU * v);
        clusterPts.push({ c, g1, g2 });
      }
    }
    let compressT = 0;

    function drawCompress() {
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const rect = compressCanvas.getBoundingClientRect();
      const w = Math.max(1, rect.width), h = Math.max(1, rect.height);
      if (compressCanvas.width !== Math.round(w * dpr)) {
        compressCanvas.width = Math.round(w * dpr);
        compressCanvas.height = Math.round(h * dpr);
      }
      cctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      cctx.clearRect(0, 0, w, h);
      const sep = lerp(w * 0.235, 10, compressT);
      const sigma = lerp(w * 0.032, w * 0.068, compressT) * (h / 200);
      const cy = h / 2;
      const dims = Math.round(512 * Math.pow(3 / 512, compressT));
      compressOut.textContent = dims >= 100 ? String(dims) : dims === 3 ? '3' : String(dims);
      compressRange.setAttribute('aria-valuetext', dims + ' dimensions');
      for (const p of clusterPts) {
        const cx = w / 2 + (p.c === 0 ? -sep : sep);
        const x = cx + p.g1 * sigma * 0.55;
        const y = cy + p.g2 * sigma * 0.55;
        cctx.fillStyle = p.c === 0 ? 'rgba(75,134,173,0.85)' : 'rgba(92,138,94,0.85)';
        cctx.fillRect(x, y, 2.4, 2.4);
      }
      cctx.font = '10px "IBM Plex Mono", monospace';
      cctx.fillStyle = '#6b7075';
      cctx.textAlign = 'center';
      cctx.fillText('instance 1', w / 2 - sep, h - 12);
      cctx.fillText('instance 2', w / 2 + sep, h - 12);
      if (compressT > 0.62) {
        cctx.fillStyle = '#b06000';
        cctx.fillText('overlapping', w / 2, 20);
      }
    }
    compressRange.addEventListener('input', () => {
      compressT = compressRange.value / 100;
      drawCompress();
    });
    new ResizeObserver(drawCompress).observe(compressCanvas);
    drawCompress();

    /* -------- chapter 3: unstable retrieval vignette -------- */
    const unstableRows = Array.from(document.querySelectorAll('#unstableList li'));
    const unstableFlag = document.querySelector('#unstableFlag span');
    const unstableEl = document.getElementById('unstableList');
    if (!REDUCED && unstableRows.length) {
      tickerIO.observe(unstableEl);
      let u = 0;
      const tickUnstable = () => {
        if (!tickerVisible.get(unstableEl)) { setTimeout(tickUnstable, 2100); return; }
        const win = u % 2;
        unstableRows.forEach((row, i) => {
          row.classList.toggle('flip', i === win);
          const base = [0.31, 0.30, 0.24][i];
          const jitter = (Math.random() - 0.5) * 0.02;
          row.querySelector('.u-score').textContent = (base + jitter).toFixed(2);
          row.querySelector('.u-meter i').style.setProperty('--w', String(clamp((base + jitter) / 0.4, 0, 1)));
        });
        unstableFlag.textContent = win === 0 ? 'Round bottle' : 'Shaped bottle';
        u++;
        setTimeout(tickUnstable, 2100);
      };
      tickUnstable();
    } else {
      unstableRows[0].classList.add('flip');
    }

    /* -------- chapter 4: loss demo -------- */
    const lossItems = [
      { id: 'coke', label: 'Coke', hexc: '#d93025', n: 8, norm: 1.42, angle: 2.72, spread: 0.09, rgb: hexy('#d93025') },
      { id: 'juice', label: 'Orange juice', hexc: '#e8710a', n: 8, norm: 1.26, angle: 0.42, spread: 0.09, rgb: hexy('#e8710a') },
      { id: 'round', label: 'round bottle', hexc: '#4b86ad', n: 6, norm: 1.18, angle: 1.95, spread: 0.08, rgb: hexy('#4b86ad') },
      { id: 'shaped', label: 'shaped bottle', hexc: '#5c8a5e', n: 6, norm: 1.06, angle: -0.72, spread: 0.08, rgb: hexy('#5c8a5e') }
    ];
    const lossCanvasEl = document.getElementById('space-loss-canvas');
    const lossSpace = new SpaceCanvas(lossCanvasEl, { items: lossItems, seed: 11 });
    const lossNote = document.getElementById('lossNote');
    const lossToggles = document.getElementById('lossToggles');
    const LOSS_NOTES = {
      pos: 'Without ℒ pos, multiple views of the same object no longer collapse into one direction. Each instance smears across the space.',
      neg: 'Without ℒ neg, instances are free to drift into each other. Visually similar objects become indistinguishable.',
      reconst: 'Without reconstruction, nothing anchors vectors to CLIP meaning. Features inflate outward and the space stops tracking language.'
    };
    lossToggles.addEventListener('click', (e) => {
      const btn = e.target.closest('button');
      if (!btn) return;
      const name = btn.dataset.loss;
      lossSpace.toggles[name] = !lossSpace.toggles[name];
      btn.setAttribute('aria-pressed', String(lossSpace.toggles[name]));
      const off = Object.keys(lossSpace.toggles).filter((k) => !lossSpace.toggles[k]);
      lossNote.textContent = off.length
        ? off.map((k) => LOSS_NOTES[k]).join(' ')
        : 'All terms on: each instance holds one direction, different instances stay apart, ambiguous concepts sit near the origin.';
    });

    /* -------- chapter 5: norm demo -------- */
    const normItems = [
      { id: 'coke', label: 'Coke', hexc: '#d93025', n: 7, norm: 1.45, angle: 2.72, spread: 0.07, rgb: hexy('#d93025') },
      { id: 'juice', label: 'Orange juice', hexc: '#e8710a', n: 7, norm: 1.28, angle: 0.42, spread: 0.07, rgb: hexy('#e8710a') },
      { id: 'round', label: 'round bottle', hexc: '#4b86ad', n: 5, norm: 0.56, angle: 1.9, spread: 0.05, rgb: hexy('#4b86ad') },
      { id: 'shaped', label: 'shaped bottle', hexc: '#5c8a5e', n: 5, norm: 0.48, angle: -0.8, spread: 0.05, rgb: hexy('#5c8a5e') }
    ];
    const normLabels = [
      { id: 'bottle', label: 'bottle', hexc: '#b06000', norm: 0.17, angle: 1.2, rgb: hexy('#b06000') },
      { id: 'drink', label: 'drink', hexc: '#b06000', norm: 0.09, angle: -1.9, rgb: hexy('#b06000') }
    ];
    const normCanvasEl = document.getElementById('space-norm-canvas');
    const normSpace = new SpaceCanvas(normCanvasEl, {
      items: normItems, labels: normLabels, seed: 23, defaultQuery: 'bottle'
    });
    const muRange = document.getElementById('muRange');
    const muOut = document.getElementById('muOut');
    const normNote = document.getElementById('normNote');
    const NORM_NOTES = {
      coke: 'Query “coke”: vector length 1.45, far outside the threshold circle. Exactly one instance matches, so retrieval is safe.',
      juice: 'Query “orange juice”: length 1.28. Also specific to a single instance.',
      round: 'Query “round bottle”: length 0.56, just outside the default circle. It mostly points at the round bottle, but the margin is thin.',
      bottle: 'Query “bottle”: length 0.17, deep inside the threshold circle. The system classifies it as ambiguous and would ask for clarification instead of retrieving.'
    };
    function applyNormQuery() {
      const q = normSpace.queryId;
      if (!q || !NORM_NOTES[q]) return;
      const note = NORM_NOTES[q];
      if (q === 'round' && normSpace.mu > 0.56) {
        normNote.textContent = 'Query “round bottle”: length 0.56, now inside the raised circle, so the verdict flips to ambiguous. The boundary is a policy choice, not a truth.';
      } else {
        normNote.textContent = note;
      }
    }
    document.getElementById('normQueries').addEventListener('click', (e) => {
      const btn = e.target.closest('button');
      if (!btn) return;
      normSpace.queryId = btn.dataset.q;
      document.querySelectorAll('#normQueries .chip').forEach((b) => b.setAttribute('aria-pressed', String(b === btn)));
      applyNormQuery();
    });
    muRange.addEventListener('input', () => {
      normSpace.mu = muRange.value / 100;
      muOut.textContent = normSpace.mu.toFixed(2);
      muRange.setAttribute('aria-valuetext', normSpace.mu.toFixed(2));
      applyNormQuery();
    });

    /* -------- chapter 5: measured norm chart -------- */
    const NORM_DATA = [
      { scene: 'Bench scene · 3D-OVS', rows: [['“food”', 0.10, 'amb'], ['“fruit”', 0.53, 'ok'], ['“tart”', 0.74, 'ok'], ['“green grape”', 1.59, 'ok']] },
      { scene: 'Figurines · LERF', rows: [['“animal”', 0.08, 'amb'], ['“apple”', 0.32, 'amb'], ['“kitchen tool”', 0.44, 'amb'], ['“red apple”', 0.60, 'ok'], ['“green apple”', 0.68, 'ok'], ['“spatula”', 0.71, 'ok']] }
    ];
    const normChart = document.getElementById('normChart');
    for (const group of NORM_DATA) {
      const head = document.createElement('div');
      head.className = 'norm-scene';
      head.textContent = group.scene;
      normChart.appendChild(head);
      for (const [name, v, kind] of group.rows) {
        const row = document.createElement('div');
        row.className = 'norm-row ' + kind;
        row.innerHTML = '<span class="norm-name">' + name + '</span>' +
          '<div class="norm-bar"><i style="--v:' + v + '"></i></div>' +
          '<span class="norm-val">' + v.toFixed(2) + '</span>';
        normChart.appendChild(row);
      }
    }
    if (REDUCED) normChart.querySelectorAll('.norm-row').forEach((r) => r.classList.add('in'));
    else {
      const io = new IntersectionObserver((ents) => {
        for (const e of ents) if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); }
      }, { threshold: 0.5 });
      normChart.querySelectorAll('.norm-row').forEach((r) => io.observe(r));
    }

    /* -------- chapter 5: label stream -------- */
    const LABELS = [
      ['Coca-Cola can', 'spec'], ['red can with white script', 'spec'], ['aluminium drink can', 'spec'],
      ['soda can', 'amb'], ['soft drink', 'amb'], ['can', 'amb'], ['drink', 'amb'],
      ['beverage', 'amb'], ['container', 'amb'], ['recyclable item', 'amb'],
      ['Coke', 'spec'], ['cola', 'amb']
    ];
    const stream = document.getElementById('labelStream');
    const genBtn = document.getElementById('genLabels');
    let genCount = 0;
    function generateLabels() {
      stream.innerHTML = '';
      genCount++;
      const order = REDUCED ? LABELS.map((_, i) => i) : LABELS.map((_, i) => i);
      order.forEach((idx, i) => {
        const [text, kind] = LABELS[idx];
        const chip = document.createElement('span');
        chip.className = 'label-chip ' + kind;
        chip.textContent = text;
        stream.appendChild(chip);
        if (REDUCED) chip.classList.add('on');
        else setTimeout(() => chip.classList.add('on'), 70 * i + (genCount > 1 ? 0 : 150));
      });
    }
    genBtn.addEventListener('click', generateLabels);
    if (!REDUCED) {
      const streamIO = new IntersectionObserver((ents) => {
        if (ents.some((e) => e.isIntersecting)) { generateLabels(); streamIO.disconnect(); }
      }, { threshold: 0.4 });
      streamIO.observe(stream);
    } else generateLabels();

    /* -------- chapter 6: retrieval demo -------- */
    const retrieveCanvas = document.getElementById('retrieve-canvas');
    const rField = new Field(retrieveCanvas, benchObjects.map((o) => Object.assign({}, o)), {
      zoom: 1.6, rotSpeed: 0.06, cx: 0.5, cy: 0.52
    });
    const AMB2 = hexy('#b06000'), OK2 = hexy('#188038');
    const QUERIES = {
      food: { norm: 0.10, target: null, amb: true, label: '“food”' },
      fruit: { norm: 0.53, target: 'grapes', label: '“fruit”' },
      tart: { norm: 0.74, target: 'tart', label: '“tart”' },
      grape: { norm: 1.59, target: 'grapes', label: '“green grape”' },
      thing: { norm: 0.06, target: null, amb: true, label: '“thing”' },
      unknown: { norm: null, target: null, amb: false, label: 'this phrase' }
    };
    const NAMES = { tart: 'the tart', grapes: 'the green grapes' };
    const rNorm = document.getElementById('retrieveNorm');
    const rNormOut = document.getElementById('retrieveNormOut');
    const rResult = document.getElementById('retrieveResult');
    const rMeter = rNorm.closest('.meter');
    const rChips = document.getElementById('retrieveQueries');

    function clarifyMarkup(subject) {
      return '<p class="rr-title">Ambiguity detected</p>' +
        '<p class="rr-ask">‖q‖₂ is inside the μ circle. ' + subject + ' asks before it acts.</p>' +
        '<div class="rr-btns">' +
        '<button type="button" class="chip" data-clarify="tart">the tart</button>' +
        '<button type="button" class="chip" data-clarify="grape">the green grapes</button>' +
        '</div>';
    }

    function runQuery(key, displayLabel) {
      const q = QUERIES[key] || QUERIES.unknown;
      rField.clearStates();
      if (q.norm === null) {
        rNorm.style.width = '0%';
        rMeter.classList.remove('is-ok');
        rNormOut.textContent = '—';
        rResult.innerHTML = '<p class="rr-title">No match</p><p class="rr-none">Nothing in this scene scores above τ for ' +
          (displayLabel || q.label) + '. Try “tart”, “fruit”, “green grape”, or “food”.</p>';
        return;
      }
      rNorm.style.width = clamp(q.norm / 1.7, 0, 1) * 100 + '%';
      rMeter.classList.toggle('is-ok', !q.amb);
      rNormOut.textContent = q.norm.toFixed(2);
      if (q.amb) {
        rResult.innerHTML = clarifyMarkup(displayLabel || q.label);
        rField.set('tart', { hl: 1, hlColor: AMB2, pulse: true });
        rField.set('grapes', { hl: 1, hlColor: AMB2, pulse: true });
      } else {
        rResult.innerHTML = '<p class="rr-title">Retrieved</p>' +
          '<p class="rr-query">' + (displayLabel || q.label) + ' · ‖q‖₂ = ' + q.norm.toFixed(2) + ' above μ</p>' +
          '<p class="rr-match">Matched ' + NAMES[q.target] + '. Returning every pixel above τ as the object region.</p>';
        for (const o of ['tart', 'grapes']) {
          if (o === q.target) rField.set(o, { hl: 1, hlColor: OK2 });
          else rField.set(o, { dim: 0.18 });
        }
      }
    }

    rChips.addEventListener('click', (e) => {
      const btn = e.target.closest('button');
      if (!btn) return;
      rChips.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(b === btn)));
      runQuery(btn.dataset.q);
    });
    rResult.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-clarify]');
      if (!btn) return;
      runQuery(btn.dataset.clarify);
    });
    document.getElementById('retrieveForm').addEventListener('submit', (e) => {
      e.preventDefault();
      const input = document.getElementById('retrieveInput');
      const text = input.value.trim();
      if (!text) return;
      const low = text.toLowerCase();
      let key = 'unknown';
      if (/(grape|berry)/.test(low)) key = 'grape';
      else if (/(tart|pie|pastry|cake)/.test(low)) key = 'tart';
      else if (/fruit/.test(low)) key = 'fruit';
      else if (/(food|snack|eat|hungry|dessert|breakfast)/.test(low)) key = 'food';
      else if (/(bottle|thing|stuff|object|something|anything)/.test(low)) key = 'thing';
      rChips.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', 'false'));
      runQuery(key, '“' + text.replace(/^bring me (the )?/i, '') + '”');
    });

    /* -------- footer -------- */
    const bib = document.getElementById('bibtex');
    document.getElementById('copyBib').addEventListener('click', (e) => copyText(bib.textContent, e.currentTarget));

    /* -------- fonts: redraw canvases once webfonts land -------- */
    if (document.fonts && document.fonts.ready) {
      document.fonts.ready.then(() => {
        for (const cv of document.querySelectorAll('canvas')) {
          if (cv.__field) cv.__field.draw();
          if (cv.id === 'compress-canvas') drawCompress();
        }
        lossSpace.redraw();
        normSpace.redraw();
      });
    }
  });
})();
