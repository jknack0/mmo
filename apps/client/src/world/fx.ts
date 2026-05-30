// @ts-nocheck
/* Vendored verbatim from the Claude-Design handoff (reference/fx.reference.js).
   Canvas-2D pyromancy VFX built from hard-edged "fire-blob" sprites. Run as-is
   on an overlay canvas per the handoff — do NOT redesign the algorithm. The only
   addition is the window.MMO bootstrap + ES export at the bottom so it imports
   into the Solid/Vite client. Everything between the markers is unchanged. */

const _w = window as any;
_w.MMO = _w.MMO || {};
_w.MMO.C = _w.MMO.C || { fireCore: '#fff1c4', burn: '#ff6a3a' };
if (!_w.MMO.shake) _w.MMO.shake = () => {};
_w.MMO.tweaks = _w.MMO.tweaks || { embers: 1 };

// ===== BEGIN reference/fx.reference.js (verbatim) ============================
(function () {
  const MMO = window.MMO;
  const C = MMO.C;

  const fx = (MMO.fx = {
    over: [], ground: [], floats: [], embers: [],
  });

  const CHUNK = 4;
  const PALS = {
    fire:  [[0.34, '#fff1c4'], [0.62, '#ff9f1a'], [0.86, '#e0631a'], [1, '#a4291a']],
    burn:  [[0.4, '#ffe1a0'], [0.7, '#ff8a2a'], [1, '#c43a16']],
    blue:  [[0.36, '#dff3ff'], [0.66, '#6ab0ff'], [1, '#2f5a9a']],
    smoke: [[1, '#241c19']],
    coal:  [[0.5, '#7a2a14'], [1, '#3a1109']],
  };
  const _blobs = {};
  function getBlob(kind, R) {
    R = Math.max(1, Math.min(9, R | 0));
    const key = kind + R;
    if (_blobs[key]) return _blobs[key];
    const stops = PALS[kind] || PALS.fire;
    const d = R * 2 + 1;
    const cv = document.createElement('canvas'); cv.width = cv.height = d;
    const g = cv.getContext('2d');
    for (let j = 0; j < d; j++) for (let i = 0; i < d; i++) {
      const dist = Math.hypot(i - R, j - R) / (R + 0.35);
      if (dist > 1) continue;
      let col = null;
      for (let s = 0; s < stops.length; s++) { if (dist <= stops[s][0]) { col = stops[s][1]; break; } }
      if (col) { g.fillStyle = col; g.fillRect(i, j, 1, 1); }
    }
    return (_blobs[key] = cv);
  }
  function blob(ctx, kind, x, y, r, alpha) {
    const R = Math.max(1, Math.round(r / CHUNK));
    const b = getBlob(kind, R), s = b.width * CHUNK;
    ctx.globalAlpha = alpha == null ? 1 : alpha;
    ctx.drawImage(b, Math.round(x - s / 2), Math.round(y - s / 2), s, s);
    ctx.globalAlpha = 1;
  }
  fx.blob = blob;
  fx.GLOW = 'fire'; fx.GLOW_BURN = 'burn'; fx.GLOW_BLUE = 'blue';

  function P(o) { return Object.assign({ vx: 0, vy: 0, grav: 0, life: 0, max: 1, r: 6, fk: 'fire', kind: 'dot' }, o); }
  function pUpdate(p, dt) { p.life += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.vy += p.grav * dt; return p.life < p.max; }
  function pDraw(ctx, p) {
    const k = 1 - p.life / p.max;
    if (p.kind === 'ash') {
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = k * 0.85; ctx.fillStyle = p.c || '#3a322c';
      const s = Math.max(CHUNK, Math.round(p.r));
      ctx.fillRect(Math.round(p.x), Math.round(p.y), s, s);
      ctx.globalAlpha = 1;
    } else if (p.kind === 'smoke') {
      ctx.globalCompositeOperation = 'source-over';
      blob(ctx, 'smoke', p.x, p.y, p.r * (1.4 - k * 0.6) + 6, k * 0.28);
    } else {
      ctx.globalCompositeOperation = 'screen';
      blob(ctx, p.fk, p.x, p.y, p.r * (0.5 + k * 0.7), Math.min(1, k * 1.2));
      ctx.globalCompositeOperation = 'source-over';
    }
  }
  function emit(list, p) { list.push({ p: P(p), u: pUpdate, d: pDraw }); }
  fx.emit = (p) => emit(fx.over, p);

  function fkOf(c) {
    if (c === 'blue' || c === '#6ab0ff' || c === '#cdeaff') return 'blue';
    if (c === 'burn' || c === C.burn || c === '#ff6a3a') return 'burn';
    return 'fire';
  }

  function explosion(x, y, R, n) {
    const Rr = Math.max(10, R);
    fx.over.push({
      t: 0, max: 0.4,
      u(dt) { this.t += dt; return this.t < this.max; },
      d(ctx) {
        const k = this.t / this.max;
        ctx.globalCompositeOperation = 'screen';
        blob(ctx, 'fire', x, y, Rr * (0.55 + k * 0.5), (1 - k));
        const rr = Rr * (0.35 + k * 1.05);
        const seg = Math.max(7, Math.min(34, Math.floor(rr / 7)));
        for (let i = 0; i < seg; i++) {
          const a = (i / seg) * Math.PI * 2;
          blob(ctx, 'fire', x + Math.cos(a) * rr, y + Math.sin(a) * rr * 0.6, 7 - k * 2, (1 - k) * 0.95);
        }
        ctx.globalCompositeOperation = 'source-over';
      },
    });
    for (let i = 0; i < (n || 18); i++) {
      const a = Math.random() * 7, sp = 50 + Math.random() * Rr * 1.7;
      emit(fx.over, { x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp * 0.6 - 34, grav: 70, r: 7 + Math.random() * 7, max: 0.45 + Math.random() * 0.5, fk: Math.random() < 0.3 ? 'burn' : 'fire' });
    }
    for (let i = 0; i < 4; i++) emit(fx.over, { x: x + (Math.random() - .5) * Rr, y: y - 6, vy: -26 - Math.random() * 20, r: 16 + Math.random() * 12, max: 1.0, kind: 'smoke' });
    scorch(x, y, Rr * 0.7);
  }

  function scorch(x, y, r) {
    r = Math.max(0, r);
    fx.ground.push({
      t: 0, max: 6,
      u(dt) { this.t += dt; return this.t < this.max; },
      d(ctx) {
        const a = Math.max(0, 1 - this.t / this.max) * 0.55;
        ctx.globalCompositeOperation = 'source-over';
        ctx.globalAlpha = a; ctx.fillStyle = '#0a0606';
        const seg = 10;
        for (let i = 0; i < seg; i++) {
          const ang = (i / seg) * Math.PI * 2, rr = r * (0.55 + (i % 2 ? 0.3 : 0.1));
          const px = Math.round(x + Math.cos(ang) * rr), py = Math.round(y + Math.sin(ang) * rr * 0.5);
          ctx.fillRect(px - CHUNK, py - CHUNK, CHUNK * 2, CHUNK * 2);
        }
        ctx.fillRect(Math.round(x - r * 0.5), Math.round(y - r * 0.28), Math.round(r), Math.round(r * 0.56));
        ctx.globalAlpha = 1;
      },
    });
  }

  function telegraph(x, y, r, dur, kind) {
    r = Math.max(0, r); kind = kind || 'fire';
    fx.ground.push({
      t: 0, max: dur,
      u(dt) { this.t += dt; return this.t < this.max; },
      d(ctx) {
        const k = Math.min(1, this.t / this.max);
        ctx.globalCompositeOperation = 'screen';
        const blink = 0.55 + Math.sin(this.t * 16) * 0.3;
        const seg = Math.max(12, Math.floor(r / 6));
        for (let i = 0; i < seg; i++) {
          if (i % 2) continue;
          const a = (i / seg) * Math.PI * 2;
          blob(ctx, kind, x + Math.cos(a) * r, y + Math.sin(a) * r * 0.5, 5, blink);
        }
        if (k > 0) {
          const rr = r * k, sg = Math.max(8, Math.floor(rr / 7));
          for (let i = 0; i < sg; i++) { const a = (i / sg) * Math.PI * 2; blob(ctx, kind, x + Math.cos(a) * rr, y + Math.sin(a) * rr * 0.5, 4, 0.4); }
        }
        ctx.globalCompositeOperation = 'source-over';
      },
    });
  }

  function projectile(from, to, speed, R, spark, onImpact) {
    const dx = to.x - from.x, dy = to.y - from.y; const dist = Math.hypot(dx, dy) || 1;
    const dur = dist / speed; const nx = dx / dist, ny = dy / dist;
    fx.over.push({
      t: 0, max: dur, x: from.x, y: from.y,
      u(dt) {
        this.t += dt;
        this.x = from.x + dx * (this.t / dur); this.y = from.y + dy * (this.t / dur);
        if (Math.random() < (spark ? 0.5 : 0.95)) emit(fx.over, { x: this.x, y: this.y, vx: -nx * 40 + (Math.random() - .5) * 40, vy: -ny * 40 + (Math.random() - .5) * 40, r: spark ? 5 : 9, max: 0.4, fk: Math.random() < 0.4 ? 'burn' : 'fire' });
        if (this.t >= dur) { onImpact && onImpact(to.x, to.y); return false; }
        return true;
      },
      d(ctx) {
        ctx.globalCompositeOperation = 'screen';
        blob(ctx, 'fire', this.x, this.y, spark ? 8 : 16, 1);
        ctx.globalCompositeOperation = 'source-over';
      },
    });
  }

  function column(x, y, R, onImpact) {
    let hit = false;
    fx.over.push({
      t: 0, max: 1.0,
      u(dt) {
        this.t += dt;
        if (!hit && this.t > 0.12) { hit = true; onImpact && onImpact(x, y); }
        if (Math.random() < 0.9) emit(fx.over, { x: x + (Math.random() - .5) * R, y: y - Math.random() * 170, vy: -130 - Math.random() * 90, r: 7 + Math.random() * 7, max: 0.6, fk: Math.random() < 0.3 ? 'burn' : 'fire' });
        return this.t < this.max;
      },
      d(ctx) {
        const k = this.t / this.max;
        const a = Math.sin(Math.min(1, this.t / 0.15) * Math.PI / 2) * (1 - k * 0.6);
        ctx.globalCompositeOperation = 'screen';
        const top = y - 200;
        for (let yy = y; yy > top; yy -= CHUNK * 3) {
          const f = (yy - top) / (y - top);
          const rad = Math.max(7, R * 0.5 * (0.45 + f * 0.7) * (0.85 + Math.sin(this.t * 26 + yy) * 0.15));
          blob(ctx, f > 0.4 ? 'fire' : 'burn', x + (Math.random() - .5) * 6, yy, rad, a * (0.45 + f * 0.55));
        }
        ctx.globalCompositeOperation = 'source-over';
      },
    });
    telegraph(x, y, R, 0.2, 'fire');
  }

  fx.cast = function (skill, from, to, onImpact) {
    switch (skill.glyph) {
      case 'bolt': projectile(from, to, 1400, 0, true, (x, y) => { explosion(x, y, 28, 7); onImpact(x, y); }); break;
      case 'orb': projectile(from, to, 720, skill.radius, false, (x, y) => { explosion(x, y, skill.radius, 22); onImpact(x, y); }); break;
      case 'cone': {
        const a = Math.atan2(to.y - from.y, to.x - from.x);
        for (let i = 0; i < 26; i++) {
          const aa = a + (Math.random() - .5) * 0.95, sp = 170 + Math.random() * 240;
          emit(fx.over, { x: from.x, y: from.y - 60, vx: Math.cos(aa) * sp, vy: Math.sin(aa) * sp * 0.6, grav: 50, r: 7 + Math.random() * 6, max: 0.55 + Math.random() * 0.35, fk: 'burn' });
        }
        const mx = from.x + Math.cos(a) * 90, my = from.y + Math.sin(a) * 60;
        scorch(mx, my, skill.radius * 0.6); onImpact(mx, my); break;
      }
      case 'column': column(to.x, to.y, skill.radius, onImpact); break;
      case 'rings': {
        explosion(to.x, to.y, skill.radius, 24);
        for (let r = 34; r < skill.radius; r += 40) telegraph(to.x, to.y, r, 0.42, 'burn');
        onImpact(to.x, to.y); break;
      }
      case 'meteor': {
        telegraph(to.x, to.y, skill.radius, skill.delay, 'fire');
        setTimeout(() => {
          fx.over.push({
            t: 0, max: 0.34,
            u(dt) {
              this.t += dt;
              const k = this.t / this.max, rx = to.x - (1 - k) * 120, ry = to.y - (1 - k) * 420;
              emit(fx.over, { x: rx, y: ry, vx: (Math.random() - .5) * 30, vy: 30 + Math.random() * 40, r: 7, max: 0.4, fk: Math.random() < 0.4 ? 'burn' : 'fire' });
              return this.t < this.max;
            },
            d(ctx) {
              const k = this.t / this.max, rx = to.x - (1 - k) * 120, ry = to.y - (1 - k) * 420;
              ctx.globalCompositeOperation = 'screen';
              blob(ctx, 'fire', rx, ry, 26, 1);
              ctx.globalCompositeOperation = 'source-over';
            },
          });
          setTimeout(() => { explosion(to.x, to.y, skill.radius, 40); MMO.shake(10); onImpact(to.x, to.y); }, 330);
        }, skill.delay * 1000);
        break;
      }
      default: explosion(to.x, to.y, skill.radius || 40, 16); onImpact(to.x, to.y);
    }
  };

  fx.necroBolt = function (from, to, onArrive) {
    const dx = to.x - from.x, dy = to.y - from.y, dist = Math.hypot(dx, dy) || 1;
    const dur = dist / 360;
    fx.over.push({
      t: 0, max: dur, x: from.x, y: from.y,
      u(dt) {
        this.t += dt; this.x = from.x + dx * (this.t / dur); this.y = from.y + dy * (this.t / dur);
        if (Math.random() < 0.85) emit(fx.over, { x: this.x, y: this.y, vx: (Math.random() - .5) * 30, vy: (Math.random() - .5) * 30, r: 5, max: 0.4, fk: 'blue' });
        if (this.t >= dur) { onArrive && onArrive(); return false; }
        return true;
      },
      d(ctx) { ctx.globalCompositeOperation = 'screen'; blob(ctx, 'blue', this.x, this.y, 13, 1); ctx.globalCompositeOperation = 'source-over'; },
    });
  };
  fx.necroBurst = function (x, y) {
    fx.over.push({
      t: 0, max: 0.38,
      u(dt) { this.t += dt; return this.t < this.max; },
      d(ctx) {
        const k = this.t / this.max; ctx.globalCompositeOperation = 'screen';
        const rr = 6 + k * 28, seg = Math.max(8, Math.floor(rr / 6));
        for (let i = 0; i < seg; i++) { const a = (i / seg) * Math.PI * 2; blob(ctx, 'blue', x + Math.cos(a) * rr, y + Math.sin(a) * rr * 0.6, 5, (1 - k) * 0.9); }
        ctx.globalCompositeOperation = 'source-over';
      },
    });
    for (let i = 0; i < 12; i++) { const a = Math.random() * 7, sp = 40 + Math.random() * 100; emit(fx.over, { x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp * 0.7 - 22, grav: 60, r: 5, max: 0.5, fk: 'blue' }); }
  };

  fx.ash = function (x, y) {
    for (let i = 0; i < 24; i++) {
      const a = Math.random() * 7;
      emit(fx.over, { x: x + (Math.random() - .5) * 24, y: y - 30 - Math.random() * 50, vx: Math.cos(a) * 20, vy: -10 - Math.random() * 30, grav: 30, r: CHUNK + (Math.random() * CHUNK | 0), max: 1.1 + Math.random() * 0.8, c: Math.random() > .5 ? '#3a322c' : '#6a5a4a', kind: 'ash' });
    }
    for (let i = 0; i < 7; i++) emit(fx.over, { x: x + (Math.random() - .5) * 20, y: y - 30, vy: -22, r: 7, max: 0.5, fk: 'burn' });
    scorch(x, y, 30);
  };

  fx.spawnFloat = function (x, y, text, color, small) {
    fx.floats.push({ x: x + (Math.random() - .5) * 20, y, text: '' + text, color: color || C.fireCore, t: 0, max: 0.95, small });
  };

  function ember(w, h) {
    return { x: Math.random() * w, y: h * 0.3 + Math.random() * h * 0.7, vy: -12 - Math.random() * 26, vx: (Math.random() - .5) * 14, r: 1 + Math.random() * 2, t: Math.random() * 4, max: 3 + Math.random() * 4 };
  }
  fx.seedEmbers = function (w, h) { fx.embers = []; for (let i = 0; i < 55; i++) fx.embers.push(ember(w, h)); fx._w = w; fx._h = h; };

  fx.update = function (dt) {
    for (const list of [fx.over, fx.ground]) {
      for (let i = list.length - 1; i >= 0; i--) {
        const e = list[i]; const alive = e.p ? e.u(e.p, dt) : e.u(dt);
        if (!alive) list.splice(i, 1);
      }
    }
    for (let i = fx.floats.length - 1; i >= 0; i--) { const f = fx.floats[i]; f.t += dt; f.y -= 34 * dt; if (f.t >= f.max) fx.floats.splice(i, 1); }
    const dens = (MMO.tweaks && MMO.tweaks.embers) || 1;
    const target = Math.round(55 * dens);
    while (fx.embers.length < target) fx.embers.push(ember(fx._w, fx._h));
    while (fx.embers.length > target) fx.embers.pop();
    for (const e of fx.embers) {
      e.t += dt; e.x += (e.vx + Math.sin(e.t * 2) * 6) * dt; e.y += e.vy * dt;
      if (e.t > e.max || e.y < -10) Object.assign(e, ember(fx._w, fx._h), { y: fx._h + 10 });
    }
  };

  fx.drawGround = function (ctx) {
    ctx.imageSmoothingEnabled = false;
    for (const e of fx.ground) (e.p ? e.d(ctx, e.p) : e.d(ctx));
  };
  fx.drawOver = function (ctx) {
    ctx.imageSmoothingEnabled = false;
    for (const e of fx.over) (e.p ? e.d(ctx, e.p) : e.d(ctx));
    ctx.globalCompositeOperation = 'screen';
    for (const e of fx.embers) {
      const k = Math.min(1, e.t / 0.6) * Math.max(0, 1 - (e.t - (e.max - 1)) / 1);
      if (k <= 0) continue;
      blob(ctx, Math.random() < 0.25 ? 'burn' : 'fire', e.x, e.y, 3 + e.r, 0.55 * k);
    }
    ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
  };
  fx.drawFloats = function (ctx) {
    for (const f of fx.floats) {
      const k = 1 - f.t / f.max;
      ctx.globalAlpha = k; ctx.textAlign = 'center';
      ctx.font = `700 ${f.small ? 16 : 26}px "Pixelify Sans", monospace`;
      ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(0,0,0,0.8)'; ctx.strokeText(f.text, f.x, f.y);
      ctx.fillStyle = f.color; ctx.fillText(f.text, f.x, f.y);
    }
    ctx.globalAlpha = 1;
  };
})();
// ===== END reference/fx.reference.js ========================================

export const fx = _w.MMO.fx as any;

/** Skill id → fx.cast glyph + params. */
export const SKILL_GLYPH: Record<string, { glyph?: string; radius?: number; delay?: number }> = {
  spark: { glyph: 'bolt' },
  'cinder-spray': { glyph: 'cone', radius: 70 },
  'heat-wave': { glyph: 'rings', radius: 80 },
  fireball: { glyph: 'orb', radius: 64 },
  'flame-lance': { glyph: 'bolt' },
  combust: { glyph: 'rings', radius: 95 },
  meteor: { glyph: 'meteor', radius: 80, delay: 0.6 },
  firestorm: { glyph: 'rings', radius: 85 },
  'wall-of-flame': { glyph: 'cone', radius: 75 },
  'ember-step': { glyph: 'cone', radius: 55 },
  pyroclasm: { glyph: 'column', radius: 60 },
  cataclysm: { glyph: 'meteor', radius: 100, delay: 0.5 },
  'basic-attack': { glyph: 'orb', radius: 22 },
};
