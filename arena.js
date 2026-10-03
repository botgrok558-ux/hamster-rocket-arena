/* Hamster Rocket Arena: self-contained top-down survival shooter (Canvas 2D + WebAudio, no dependencies).

   const game = HamsterArena.create({
     canvas,                    // <canvas> filling its container (CSS size = view size; the arena itself is bigger and scrolls)
     assetBase: "assets/",      // folder with rocket_back.svg + hamster_face.svg (falls back to vector art)
     t: (key, english) => str,  // optional translator for in-canvas text
     storagePrefix: "hra_",     // localStorage prefix (best time, best kills, mute)
     onEvent: (type, data) => {}// "state" {state, reason}, "levelup" {level, choices:[{id, lvl, max}]}, "gameover" {...}, "mute" {muted}, "boss" {}
   });
   game.start({ t0 = 0, boss = false, record = true })   game.choose(upgradeId)   game.pause()   game.resume()
   game.toggleMute()   game.state ("menu" | "play" | "levelup" | "paused" | "over")   game.best()

   Simulation, rendering, input and sound all live in this one file so it can later be dropped into the
   main Hamster Rocket demo as an extra mode. */
(function (global) {
  "use strict";
  const TAU = Math.PI * 2, INK = "#170d33", FONT = '"Luckiest Guy", system-ui, sans-serif';
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v), rand = (a, b) => a + Math.random() * (b - a);
  const hyp = Math.hypot;

  const CFG = {
    baseSize: 440, maxScale: 1.2, minScale: 0.6,   // the short screen side shows ~440 world units
    arena: 2400,                                   // square arena, world units
    player: { r: 24, speed: 210, hp: 100, inv: 0.6 },
    shot: { speed: 660, r: 6, dmg: 10, interval: 0.26, spread: 0.15, life: 0.95 },
    magnet: 85, stickR: 56, bossEvery: 180, hordeEvery: 60
  };
  // enemy archetypes: one basic cat, a fast kitten, a big slow robo-vacuum, and a simple boss that just walks at you
  const ENEMY = {
    cat: { r: 17, hp: 20, spd: 72, dmg: 8, xp: 1 },
    fast: { r: 14, hp: 12, spd: 138, dmg: 6, xp: 1 },
    big: { r: 30, hp: 110, spd: 42, dmg: 15, xp: 5 },
    boss: { r: 64, hp: 1400, spd: 54, dmg: 25, xp: 30 }
  };
  const UPGRADES = { damage: 8, rate: 8, multi: 4, speed: 5, hp: 6, pierce: 4 };   // id -> max level
  const xpNeed = L => Math.round(5 + (L - 1) * 4 + (L - 1) * (L - 1) * 0.6);

  // difficulty over time (seconds). Gentle first 15 s, then a steady ramp.
  function director(t) {
    return {
      rate: Math.min(11, t < 15 ? 1.15 : 1.15 + (t - 15) * 0.034),         // spawns per second
      maxAlive: Math.min(180, Math.round(30 + t * 0.6)),
      fast: t < 40 ? 0 : Math.min(0.25, 0.05 + (t - 40) / 500),
      big: t < 75 ? 0 : Math.min(0.12, 0.03 + (t - 75) / 900),
      hpMul: 1 + t / 120,
      spdMul: 1 + Math.min(0.4, t / 450)
    };
  }

  /* ------------------------------------------------------------------ sound (tiny WebAudio synth) */
  function makeSfx() {
    let ac = null, master = null, muted = false, noiseBuf = null;
    const last = {}, VOL = 0.32;
    function ensure() {
      try {
        if (!ac) {
          const AC = global.AudioContext || global.webkitAudioContext; if (!AC) return null;
          ac = new AC(); master = ac.createGain(); master.gain.value = muted ? 0 : VOL; master.connect(ac.destination);
          noiseBuf = ac.createBuffer(1, ac.sampleRate, ac.sampleRate);
          const d = noiseBuf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
        }
        if (ac.state === "suspended") ac.resume();
      } catch (e) { ac = null; }
      return ac;
    }
    const ok = () => ac && !muted && ac.state === "running";
    const gap = (k, ms) => { const n = performance.now(); if (last[k] && n - last[k] < ms) return false; last[k] = n; return true; };
    function tone(type, f0, f1, dur, vol, delay = 0) {
      if (!ok()) return;
      const t = ac.currentTime + delay, o = ac.createOscillator(), g = ac.createGain();
      o.type = type; o.frequency.setValueAtTime(f0, t); if (f1) o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.008); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g); g.connect(master); o.start(t); o.stop(t + dur + 0.03);
    }
    function noise(dur, vol, freq, delay = 0) {
      if (!ok()) return;
      const t = ac.currentTime + delay, s = ac.createBufferSource(), f = ac.createBiquadFilter(), g = ac.createGain();
      s.buffer = noiseBuf; f.type = "lowpass"; f.frequency.setValueAtTime(freq, t); f.frequency.exponentialRampToValueAtTime(Math.max(60, freq * 0.15), t + dur);
      g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      s.connect(f); f.connect(g); g.connect(master); s.start(t); s.stop(t + dur + 0.03);
    }
    const arp = (notes, type, step, dur, vol) => notes.forEach((f, i) => tone(type, f, 0, dur, vol, i * step));
    let xpPitch = 0, xpT = 0;
    return {
      ensure,
      get muted() { return muted; },
      setMuted(m) { muted = !!m; if (master) master.gain.value = muted ? 0 : VOL; },
      shoot() { if (gap("shoot", 60)) tone("square", 900, 480, 0.05, 0.045); },
      hit() { if (gap("hit", 45)) tone("triangle", 320, 180, 0.06, 0.1); },
      pop() { if (gap("pop", 45)) { tone("square", 560, 110, 0.12, 0.1); noise(0.08, 0.08, 2600); } },
      boom() { if (gap("boom", 80)) { noise(0.5, 0.42, 1000); tone("sawtooth", 130, 38, 0.42, 0.18); } },
      hurt() { if (gap("hurt", 120)) { tone("sawtooth", 280, 90, 0.24, 0.2); noise(0.12, 0.12, 900); } },
      xp() {
        const n = performance.now(); xpPitch = n - xpT < 400 ? Math.min(xpPitch + 1, 14) : 0; xpT = n;
        if (gap("xp", 40)) tone("sine", 700 * Math.pow(2, xpPitch / 24), 0, 0.06, 0.07);
      },
      heal() { arp([660, 880, 1320], "triangle", 0.055, 0.09, 0.15); },
      levelup() { arp([523, 659, 784, 1046, 1318], "triangle", 0.07, 0.16, 0.14); },
      horde() { tone("sawtooth", 140, 70, 0.6, 0.12); },
      boss() { tone("sawtooth", 95, 55, 1.0, 0.22); tone("square", 190, 95, 1.0, 0.07); noise(0.6, 0.15, 500); },
      over() { arp([523, 415, 330, 247], "triangle", 0.16, 0.22, 0.16); },
      click() { tone("triangle", 640, 0, 0.05, 0.08); }
    };
  }

  /* ------------------------------------------------------------------ drawing helpers */
  function rr(c, x, y, w, h, r) {
    r = Math.max(0, Math.min(r, w / 2, h / 2));
    c.beginPath(); c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r);
    c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath();
  }
  function text(c, s, x, y, size, fill, align = "left", base = "top") {
    c.font = `${Math.round(size)}px ${FONT}`; c.textAlign = align; c.textBaseline = base;
    c.lineJoin = "round"; c.lineWidth = Math.max(3, size * 0.22); c.strokeStyle = INK; c.strokeText(s, x, y);
    c.fillStyle = fill; c.fillText(s, x, y);
  }
  function heart(c, x, y, r) {
    const k = r / 16;
    c.save(); c.translate(x, y); c.lineJoin = "round";
    c.fillStyle = "#ff6b81"; c.strokeStyle = INK; c.lineWidth = Math.max(2, r * 0.18);
    c.beginPath(); c.arc(0, 0, r, 0, TAU); c.fill(); c.stroke();
    c.fillStyle = "#fff"; c.lineWidth = Math.max(1.5, r * 0.12); c.beginPath();
    c.moveTo(0, 9 * k); c.bezierCurveTo(-13 * k, 0, -8 * k, -12 * k, 0, -4.5 * k); c.bezierCurveTo(8 * k, -12 * k, 13 * k, 0, 0, 9 * k); c.closePath(); c.fill(); c.stroke();
    c.restore();
  }
  function hpBar(c, x, y, w, f) {
    const h = 6; c.fillStyle = "rgba(0,0,0,.55)"; rr(c, x - w / 2, y, w, h, 3); c.fill();
    c.fillStyle = f > 0.5 ? "#5be37d" : f > 0.25 ? "#ffd23f" : "#ff4d6d"; rr(c, x - w / 2, y, w * clamp(f, 0, 1), h, 3); c.fill();
    c.lineWidth = 2; c.strokeStyle = INK; rr(c, x - w / 2, y, w, h, 3); c.stroke();
  }
  // cartoon cat-drone head at the origin (used for baked sprites)
  function catShape(c, r, body, stripe, eye) {
    c.lineJoin = "round"; c.lineCap = "round"; c.strokeStyle = INK;
    c.fillStyle = "rgba(0,0,0,.22)"; c.beginPath(); c.ellipse(0, r * 1.2, r * 0.8, r * 0.25, 0, 0, TAU); c.fill();
    c.lineWidth = 2.5; c.beginPath(); c.moveTo(0, -r * 0.85); c.lineTo(0, -r * 1.35); c.stroke();
    c.fillStyle = "rgba(201,210,234,.85)"; c.beginPath(); c.ellipse(0, -r * 1.4, r * 1.2, 2.8, 0, 0, TAU); c.fill(); c.lineWidth = 2; c.stroke();
    c.fillStyle = body; c.lineWidth = 3;
    for (const s of [-1, 1]) { c.beginPath(); c.moveTo(s * r * 0.95, -r * 0.25); c.lineTo(s * r * 0.82, -r * 1.12); c.lineTo(s * r * 0.2, -r * 0.82); c.closePath(); c.fill(); c.stroke(); }
    c.fillStyle = "#ff9fb2"; for (const s of [-1, 1]) { c.beginPath(); c.moveTo(s * r * 0.78, -r * 0.45); c.lineTo(s * r * 0.75, -r * 0.92); c.lineTo(s * r * 0.4, -r * 0.72); c.closePath(); c.fill(); }
    c.fillStyle = body; c.beginPath(); c.arc(0, 0, r, 0, TAU); c.fill(); c.stroke();
    c.strokeStyle = stripe; c.lineWidth = 2.2;
    for (const x of [-0.3, 0, 0.3]) { c.beginPath(); c.moveTo(x * r, -r * 0.95); c.lineTo(x * r * 0.8, -r * 0.62); c.stroke(); }
    c.strokeStyle = INK; c.lineWidth = 1.8; c.fillStyle = eye;
    for (const s of [-1, 1]) { c.beginPath(); c.ellipse(s * r * 0.38, -r * 0.08, r * 0.26, r * 0.3, 0, 0, TAU); c.fill(); c.stroke(); }
    c.fillStyle = INK; for (const s of [-1, 1]) { c.beginPath(); c.arc(s * r * 0.38 + 1.6, -r * 0.04 + 0.8, r * 0.13, 0, TAU); c.fill(); }
    c.lineWidth = 2.6; for (const s of [-1, 1]) { c.beginPath(); c.moveTo(s * r * 0.66, -r * 0.5); c.lineTo(s * r * 0.14, -r * 0.33); c.stroke(); }
    c.fillStyle = "#ff6b81"; c.beginPath(); c.moveTo(-r * 0.12, r * 0.24); c.lineTo(r * 0.12, r * 0.24); c.lineTo(0, r * 0.38); c.closePath(); c.fill();
    c.lineWidth = 1.6; c.beginPath(); c.moveTo(-r * 0.22, r * 0.5); c.quadraticCurveTo(-r * 0.1, r * 0.6, 0, r * 0.42); c.quadraticCurveTo(r * 0.1, r * 0.6, r * 0.22, r * 0.5); c.stroke();
    c.lineWidth = 1.3; for (const s of [-1, 1]) { c.beginPath(); c.moveTo(s * r * 0.45, r * 0.32); c.lineTo(s * r * 1.2, r * 0.18); c.moveTo(s * r * 0.45, r * 0.42); c.lineTo(s * r * 1.15, r * 0.5); c.stroke(); }
  }
  // big slow robo-vacuum, facing +x
  function vacShape(c, r) {
    c.lineJoin = "round"; c.strokeStyle = INK;
    c.fillStyle = "rgba(0,0,0,.25)"; c.beginPath(); c.ellipse(0, r * 0.25, r * 1.05, r * 0.95, 0, 0, TAU); c.fill();
    c.lineWidth = 3; c.fillStyle = "#4b5577"; rr(c, r * 0.65, -r * 0.34, r * 0.6, r * 0.68, 5); c.fill(); c.stroke();
    c.fillStyle = INK; rr(c, r * 1.12, -r * 0.24, r * 0.14, r * 0.48, 3); c.fill();
    c.fillStyle = "#e7ecf6"; c.lineWidth = 3.5; c.beginPath(); c.arc(0, 0, r, 0, TAU); c.fill(); c.stroke();
    c.fillStyle = "#b9c3da"; c.lineWidth = 2; c.beginPath(); c.arc(0, 0, r * 0.68, 0, TAU); c.fill(); c.stroke();
    c.strokeStyle = "#3a4166"; c.lineWidth = 5; c.beginPath(); c.arc(0, 0, r * 0.86, -1.05, 1.05); c.stroke();
    c.strokeStyle = INK; c.lineWidth = 1.6; c.fillStyle = "#fff";
    for (const s of [-1, 1]) { c.beginPath(); c.arc(r * 0.38, s * r * 0.28, r * 0.17, 0, TAU); c.fill(); c.stroke(); }
    c.fillStyle = "#ff3d5a"; for (const s of [-1, 1]) { c.beginPath(); c.arc(r * 0.44, s * r * 0.26, r * 0.08, 0, TAU); c.fill(); }
    c.lineWidth = 2.4; for (const s of [-1, 1]) { c.beginPath(); c.moveTo(r * 0.16, s * r * 0.5); c.lineTo(r * 0.5, s * r * 0.16); c.stroke(); }
    c.fillStyle = "#ff6b81"; c.lineWidth = 2; c.beginPath(); c.arc(-r * 0.12, 0, r * 0.22, 0, TAU); c.fill(); c.stroke();
  }
  // XP seed (sunflower seed), pointing +x
  function seedShape(c, gold) {
    c.fillStyle = gold ? "#ffd23f" : "#f4ecd8"; c.strokeStyle = INK; c.lineWidth = 1.6;
    c.beginPath(); c.ellipse(0, 0, 7, 3.8, 0, 0, TAU); c.fill(); c.stroke();
    c.strokeStyle = gold ? "#b98a00" : "#3a3150"; c.lineWidth = 1.1; c.beginPath(); c.moveTo(-4.5, -1.3); c.lineTo(4.5, -1.3); c.moveTo(-4.5, 1.3); c.lineTo(4.5, 1.3); c.stroke();
  }

  /* ------------------------------------------------------------------ main factory */
  function create(opts) {
    const canvas = opts.canvas, ctx = canvas.getContext("2d");
    const T = opts.t || ((k, en) => en);
    const base = opts.assetBase == null ? "assets/" : opts.assetBase;
    const prefix = opts.storagePrefix || "hra_";
    const emit = (type, data) => { if (opts.onEvent) opts.onEvent(type, data || {}); };
    const store = {
      get(k, d) { try { const v = localStorage.getItem(prefix + k); return v == null ? d : v; } catch (e) { return d; } },
      set(k, v) { try { localStorage.setItem(prefix + k, String(v)); } catch (e) { } }
    };
    const sfx = makeSfx(); sfx.setMuted(store.get("muted", "0") === "1");
    const A = CFG.arena;

    /* ---------- view / resize / baked sprites ---------- */
    let cssW = 1, cssH = 1, dpr = 1, sc = 1, W = 1, H = 1, bg = null;
    const baked = {};
    function bake(name, r, draw, flash) {
      const k = sc * dpr, half = Math.ceil(r * 1.75), size = Math.ceil(half * 2 * k);
      const cv = document.createElement("canvas"); cv.width = cv.height = size;
      const c = cv.getContext("2d"); c.scale(k, k); c.translate(half, half); draw(c);
      baked[name] = { cv, half };
      if (flash) {
        const fv = document.createElement("canvas"); fv.width = fv.height = size;
        const f = fv.getContext("2d"); f.drawImage(cv, 0, 0); f.globalCompositeOperation = "source-atop"; f.fillStyle = "rgba(255,255,255,.7)"; f.fillRect(0, 0, size, size);
        baked[name + "!"] = { cv: fv, half };
      }
    }
    function bakeAll() {
      bake("cat", ENEMY.cat.r, c => catShape(c, ENEMY.cat.r, "#ffa94d", "#d9731a", "#fff"), true);
      bake("fast", ENEMY.fast.r, c => catShape(c, ENEMY.fast.r, "#e7ecf6", "#9aa6c8", "#bff3ff"), true);
      bake("big", ENEMY.big.r, c => vacShape(c, ENEMY.big.r), true);
      const gem = (c, k) => {
        const gr = c.createRadialGradient(0, 0, 1, 0, 0, 12 * k); gr.addColorStop(0, "rgba(160,255,120,.75)"); gr.addColorStop(1, "rgba(91,227,125,0)");
        c.fillStyle = gr; c.beginPath(); c.arc(0, 0, 12 * k, 0, TAU); c.fill(); c.scale(k, k); seedShape(c, true);
      };
      bake("seed", 12, c => gem(c, 1)); bake("gold", 18, c => gem(c, 1.5));
    }
    function resize() {
      const r = canvas.getBoundingClientRect();
      cssW = Math.max(1, r.width); cssH = Math.max(1, r.height);
      dpr = Math.min(2, global.devicePixelRatio || 1);
      canvas.width = Math.round(cssW * dpr); canvas.height = Math.round(cssH * dpr);
      sc = clamp(Math.min(cssW, cssH) / CFG.baseSize, CFG.minScale, CFG.maxScale);
      W = cssW / sc; H = cssH / sc;
      bg = document.createElement("canvas"); bg.width = canvas.width; bg.height = canvas.height;
      const c = bg.getContext("2d"), gr = c.createRadialGradient(bg.width / 2, bg.height * 0.3, 10, bg.width / 2, bg.height / 2, Math.max(bg.width, bg.height) * 0.8);
      gr.addColorStop(0, "#2b2f9a"); gr.addColorStop(0.55, "#1b1d6b"); gr.addColorStop(1, "#0d0e38"); c.fillStyle = gr; c.fillRect(0, 0, bg.width, bg.height);
      bakeAll();
      if (g) snapCam();
      render();
    }
    // world decoration (stars, cartoon planets, craters): fixed per page load
    const deco = { stars: [], blobs: [] };
    for (let i = 0; i < Math.round(A * A / 6000); i++) deco.stars.push({ x: Math.random() * A, y: Math.random() * A, r: rand(0.8, 2.2), p: Math.random() * TAU, s: rand(1, 3) });
    const BLOB = ["#ff8a1f", "#ff6b81", "#38d9ff", "#ffd23f", "#9b7bff"];
    for (let i = 0; i < 26; i++) deco.blobs.push({ x: rand(80, A - 80), y: rand(80, A - 80), r: rand(14, 46), c: BLOB[i % BLOB.length], ring: Math.random() < 0.3, crater: Math.random() < 0.4 });

    /* ---------- sprites (same art as the main demo) ---------- */
    const spr = {};
    function loadSprite(name, file) {
      const img = new Image();
      img.onload = () => { const c = document.createElement("canvas"); c.width = c.height = 360; c.getContext("2d").drawImage(img, 0, 0, 360, 360); spr[name] = c; };
      img.onerror = () => { };
      img.src = base + file;
    }
    loadSprite("back", "rocket_back.svg"); loadSprite("face", "hamster_face.svg");

    /* ---------- run state ---------- */
    let state = "menu", g = null, record = true, raf = 0, last = 0, menuT = 0, eid = 0;
    let bestTime = parseFloat(store.get("bestTime", "0")) || 0, bestKills = parseInt(store.get("bestKills", "0"), 10) || 0;

    function newRun(t0) {
      g = {
        t: t0, t0, kills: 0, level: 1, xp: 0, up: { damage: 0, rate: 0, multi: 0, speed: 0, hp: 0, pierce: 0 }, choices: null, pendingLevels: 0,
        p: { x: A / 2, y: A / 2, vx: 0, vy: 0, r: CFG.player.r, hp: CFG.player.hp, maxHp: CFG.player.hp, inv: 1.2, aim: -Math.PI / 2, fireT: 0, wheel: 0, dead: false, deadT: 0, recoil: 0 },
        cam: { x: A / 2, y: A / 2 },
        enemies: [], shots: [], gems: [], hearts: [], parts: [], texts: [],
        spawnAcc: 0, nextHorde: Math.max(CFG.hordeEvery, Math.ceil((t0 + 1) / CFG.hordeEvery) * CFG.hordeEvery), nextBoss: Math.max(CFG.bossEvery, Math.ceil((t0 + 1) / CFG.bossEvery) * CFG.bossEvery),
        boss: null, bossN: 0, banner: null, shake: 0, hurtT: 0, god: false
      };
    }
    const stats = () => ({
      dmg: CFG.shot.dmg * (1 + 0.25 * g.up.damage), interval: CFG.shot.interval * Math.pow(0.85, g.up.rate), shots: 1 + g.up.multi,
      speed: CFG.player.speed * (1 + 0.1 * g.up.speed), pierce: g.up.pierce
    });
    function snapCam() { const c = g.cam; c.x = camX(g.p.x); c.y = camY(g.p.y); }
    const camX = x => (A > W ? clamp(x, W / 2, A - W / 2) : A / 2), camY = y => (A > H ? clamp(y, H / 2, A - H / 2) : A / 2);

    function spawnPos(r) {
      const p = g.p, dist = hyp(W / 2, H / 2) + r + 30;
      for (let i = 0; i < 14; i++) {
        const a = rand(0, TAU), x = p.x + Math.cos(a) * dist, y = p.y + Math.sin(a) * dist;
        if (x > r && x < A - r && y > r && y < A - r) return [x, y];
      }
      const a = rand(0, TAU); return [clamp(p.x + Math.cos(a) * dist, r, A - r), clamp(p.y + Math.sin(a) * dist, r, A - r)];
    }
    function spawn(type, x, y) {
      const d = director(g.t), b = ENEMY[type]; if (!b) return null;
      const hpMul = type === "boss" ? 1 + 0.6 * g.bossN : d.hpMul;
      const e = { id: ++eid, type, r: b.r, hp: Math.ceil(b.hp * hpMul), spd: b.spd * (type === "boss" ? 1 : d.spdMul) * rand(0.92, 1.08), dmg: b.dmg, xp: b.xp, kx: 0, ky: 0, flash: 0, seed: Math.random() * 10, x: 0, y: 0 };
      e.maxHp = e.hp;
      if (x == null) [x, y] = spawnPos(e.r);
      e.x = x; e.y = y; g.enemies.push(e);
      if (type === "boss") { g.boss = e; g.bossN++; }
      return e;
    }
    function spawnHorde() {
      const n = Math.min(40, 10 + Math.floor(g.t / 30)), p = g.p, R = hyp(W / 2, H / 2) + 40, off = rand(0, TAU);
      for (let i = 0; i < n; i++) { const a = off + i / n * TAU; spawn("cat", clamp(p.x + Math.cos(a) * R, 20, A - 20), clamp(p.y + Math.sin(a) * R, 20, A - 20)); }
      g.banner = { txt: T("hud.horde", "HORDE INCOMING!"), sub: "", t: 1.6, max: 1.6, col: "#ff8a1f" }; sfx.horde();
    }
    function spawnBoss() {
      spawn("boss");
      g.banner = { txt: T("hud.bossWave", "BOSS!"), sub: T("hud.bossName", "GIANT ROBO-CAT"), t: 2.4, max: 2.4, col: "#ff6b81" };
      sfx.boss(); emit("boss", {});
    }

    /* ---------- particles / texts ---------- */
    function burst(x, y, n, cols, spd, size, life) {
      for (let i = 0; i < n && g.parts.length < 320; i++) {
        const a = rand(0, TAU), s = rand(0.3, 1) * spd;
        g.parts.push({ k: "dot", x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, r: rand(0.5, 1) * size, c: cols[i % cols.length], t: life * rand(0.6, 1), m: life });
      }
    }
    function puff(x, y, n, R, cols) {
      for (let i = 0; i < n && g.parts.length < 320; i++) {
        const a = rand(0, TAU), s = rand(20, 90);
        g.parts.push({ k: "puff", x: x + Math.cos(a) * R * 0.3, y: y + Math.sin(a) * R * 0.3, vx: Math.cos(a) * s, vy: Math.sin(a) * s, r: rand(0.35, 0.6) * R, c: cols[i % cols.length], t: rand(0.3, 0.5), m: 0.5 });
      }
    }
    function ring(x, y, R, col) { if (g.parts.length < 320) g.parts.push({ k: "ring", x, y, vx: 0, vy: 0, r: R, c: col, t: 0.35, m: 0.35 }); }
    function floatText(x, y, s, col, size) { if (g.texts.length < 30) g.texts.push({ x, y, s, c: col, size, t: 0.9, m: 0.9 }); }

    /* ---------- damage / xp / level-up ---------- */
    function hurtPlayer(dmg, fx, fy) {
      const p = g.p; if (p.dead || p.inv > 0 || g.god) return;
      p.hp -= dmg; p.inv = CFG.player.inv; g.shake = Math.max(g.shake, 6); g.hurtT = 0.35;
      const a = Math.atan2(p.y - fy, p.x - fx); p.vx += Math.cos(a) * 220; p.vy += Math.sin(a) * 220;
      burst(p.x, p.y, 10, ["#fff", "#ff6b81"], 200, 3.5, 0.4); sfx.hurt();
      if (p.hp <= 0) {
        p.hp = 0; p.dead = true; p.deadT = 1.3; g.shake = 14;
        puff(p.x, p.y, 18, 40, ["#ffb02e", "#ff6b81"]); burst(p.x, p.y, 30, ["#ffd23f", "#ff8a1f", "#fff", "#38d9ff"], 340, 5, 0.9); ring(p.x, p.y, 110, "#ffd23f");
        sfx.boom();
      }
    }
    function hitEnemy(e, dmg, ax, ay) {
      e.hp -= dmg; e.flash = 0.07;
      const kb = e.type === "boss" ? 8 : e.type === "big" ? 40 : 130; e.kx += ax * kb; e.ky += ay * kb;
      sfx.hit();
      if (e.hp <= 0) killEnemy(e);
    }
    function dropGem(x, y, v) { if (g.gems.length > 420) g.gems.shift(); g.gems.push({ x, y, v, a: rand(0, TAU), pull: false }); }
    function killEnemy(e) {
      e.dead = true; g.kills++;
      if (e.type === "boss") {
        g.boss = null; g.shake = 18;
        for (let i = 0; i < 4; i++) puff(e.x + rand(-40, 40), e.y + rand(-40, 40), 8, 60, ["#ffb02e", "#9aa6c8", "#ff6b81"]);
        burst(e.x, e.y, 50, ["#ffd23f", "#ff8a1f", "#fff", "#9aa6c8"], 420, 7, 1.1); ring(e.x, e.y, 200, "#ffd23f");
        for (let i = 0; i < 10; i++) { const a = i / 10 * TAU; dropGem(e.x + Math.cos(a) * 40, e.y + Math.sin(a) * 40, 3); }
        g.hearts.push({ x: e.x, y: e.y, t: 25 });
        g.banner = { txt: T("hud.bossDown", "ROBO-CAT DOWN!"), sub: "", t: 2, max: 2, col: "#5be37d" };
        sfx.boom();
        return;
      }
      const cols = e.type === "cat" ? ["#ffa94d", "#fff", "#d9731a"] : e.type === "fast" ? ["#e7ecf6", "#bff3ff", "#9aa6c8"] : ["#e7ecf6", "#4b5577", "#ff6b81"];
      puff(e.x, e.y, e.type === "big" ? 7 : 4, e.r * 1.4, ["#ffb02e", cols[0]]); burst(e.x, e.y, e.type === "big" ? 12 : 6, cols, 220, 3.2, 0.45);
      if (e.type === "big") { g.shake = Math.max(g.shake, 4); dropGem(e.x, e.y, 5); } else dropGem(e.x, e.y, 1);
      if (Math.random() < (e.type === "big" ? 0.2 : 0.008) && g.hearts.length < 6) g.hearts.push({ x: e.x, y: e.y, t: 20 });
      sfx.pop();
    }
    function addXp(v) {
      g.xp += v;
      if (state === "play" && g.xp >= xpNeed(g.level)) openLevelUp();
    }
    function openLevelUp() {
      const pool = Object.keys(UPGRADES).filter(k => g.up[k] < UPGRADES[k]);
      for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [pool[i], pool[j]] = [pool[j], pool[i]]; }
      g.choices = pool.slice(0, 3);
      if (!g.choices.length) { g.xp -= xpNeed(g.level); g.level++; g.p.hp = g.p.maxHp; return; }   // everything maxed: free heal
      state = "levelup"; clearInput(); sfx.levelup();
      emit("state", { state });
      emit("levelup", { level: g.level + 1, choices: g.choices.map(id => ({ id, lvl: g.up[id], max: UPGRADES[id] })) });
    }
    function choose(id) {
      if (state !== "levelup" || !g.choices || !g.choices.includes(id)) return false;
      g.up[id]++;
      if (id === "hp") { g.p.maxHp += 20; g.p.hp = Math.min(g.p.maxHp, g.p.hp + 20); }
      g.xp -= xpNeed(g.level); g.level++; g.choices = null;
      ring(g.p.x, g.p.y, 70, "#ffd23f"); burst(g.p.x, g.p.y, 16, ["#ffd23f", "#fff"], 220, 4, 0.5);
      state = "play"; last = 0; clearInput(); sfx.click();
      emit("state", { state });
      if (g.xp >= xpNeed(g.level)) openLevelUp();
      return true;
    }

    /* ---------- input (manual aim + fire on every device) ---------- */
    const coarse = !!(global.matchMedia && global.matchMedia("(pointer: coarse)").matches);
    const input = { keys: new Set(), mode: coarse ? "touch" : "mouse", mouse: { x: 0, y: 0, has: false, down: false }, move: null, aim: null, space: false };
    const KEYS = { KeyW: "u", ArrowUp: "u", KeyS: "d", ArrowDown: "d", KeyA: "l", ArrowLeft: "l", KeyD: "r", ArrowRight: "r" };
    const local = e => { const r = canvas.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
    function onDown(e) {
      sfx.ensure();
      const [x, y] = local(e);
      if (e.pointerType === "touch") {
        input.mode = "touch";
        const st = { id: e.pointerId, ox: x, oy: y, x, y };
        if (x < cssW * 0.5) { if (!input.move) input.move = st; else if (!input.aim) input.aim = st; }
        else { if (!input.aim) input.aim = st; else if (!input.move) input.move = st; }
      } else {
        input.mode = "mouse"; Object.assign(input.mouse, { x, y, has: true }); if (e.button === 0) input.mouse.down = true;
      }
      try { canvas.setPointerCapture(e.pointerId); } catch (err) { }
      if (e.cancelable) e.preventDefault();
    }
    function onMove(e) {
      const [x, y] = local(e);
      if (e.pointerType === "touch") {
        for (const s of [input.move, input.aim]) {
          if (!s || s.id !== e.pointerId) continue;
          s.x = x; s.y = y;
          const dx = x - s.ox, dy = y - s.oy, d = hyp(dx, dy), R = CFG.stickR;
          if (d > R) { s.ox = x - dx / d * R; s.oy = y - dy / d * R; }   // floating sticks follow the thumb
        }
        if (e.cancelable) e.preventDefault();
      } else { input.mode = "mouse"; Object.assign(input.mouse, { x, y, has: true }); }
    }
    function onUp(e) {
      if (input.move && input.move.id === e.pointerId) input.move = null;
      if (input.aim && input.aim.id === e.pointerId) input.aim = null;
      if (e.pointerType !== "touch") input.mouse.down = false;
    }
    function onKey(e) {
      const down = e.type === "keydown", k = KEYS[e.code];
      if (down) sfx.ensure();
      if (k) { if (down) input.keys.add(k); else input.keys.delete(k); if (state === "play") e.preventDefault(); return; }
      if (e.code === "Space") { input.space = down; if (state === "play") e.preventDefault(); return; }
      if (!down || e.repeat) return;
      if (state === "levelup" && /^Digit[123]$/.test(e.code) && g.choices) { const c = g.choices[+e.code.slice(5) - 1]; if (c) choose(c); emit("chosen", { id: c }); return; }
      if (e.code === "KeyP" || e.code === "Escape") { if (state === "play") pause("key"); else if (state === "paused") resume(); }
      else if (e.code === "KeyM") toggleMute();
    }
    function clearInput() { input.keys.clear(); input.space = false; input.mouse.down = false; input.move = null; input.aim = null; }
    canvas.addEventListener("pointerdown", onDown, { passive: false });
    canvas.addEventListener("pointermove", onMove, { passive: false });
    canvas.addEventListener("pointerup", onUp); canvas.addEventListener("pointercancel", onUp); canvas.addEventListener("lostpointercapture", onUp);
    canvas.addEventListener("contextmenu", e => e.preventDefault());
    global.addEventListener("keydown", onKey); global.addEventListener("keyup", onKey);
    global.addEventListener("blur", clearInput);
    const onVis = () => { if (document.hidden && state === "play") pause("hidden"); };
    document.addEventListener("visibilitychange", onVis);
    let ro = null;
    if (global.ResizeObserver) { ro = new ResizeObserver(() => resize()); ro.observe(canvas); } else global.addEventListener("resize", resize);

    function moveVec() {
      let x = 0, y = 0; const k = input.keys;
      if (k.has("l")) x--; if (k.has("r")) x++; if (k.has("u")) y--; if (k.has("d")) y++;
      let m = hyp(x, y); if (m > 0) { x /= m; y /= m; }
      const s = input.move;
      if (s) { const dx = s.x - s.ox, dy = s.y - s.oy, d = hyp(dx, dy); if (d > CFG.stickR * 0.12) { const f = Math.min(1, d / CFG.stickR); x += dx / d * f; y += dy / d * f; } }
      m = hyp(x, y); if (m > 1) { x /= m; y /= m; }
      return [x, y];
    }
    const toWorld = (sx, sy) => [sx / sc + g.cam.x - W / 2, sy / sc + g.cam.y - H / 2];

    /* ---------- spatial grid (separation + bullet hits) ---------- */
    const CELL = 64, GN = Math.ceil(A / CELL) + 1, grid = Array.from({ length: GN * GN }, () => []);
    const cellOf = (x, y) => clamp(Math.floor(x / CELL), 0, GN - 1) * GN + clamp(Math.floor(y / CELL), 0, GN - 1);
    function forNear(x, y, fn) {
      const cx = clamp(Math.floor(x / CELL), 0, GN - 1), cy = clamp(Math.floor(y / CELL), 0, GN - 1);
      for (let i = Math.max(0, cx - 1); i <= Math.min(GN - 1, cx + 1); i++)
        for (let j = Math.max(0, cy - 1); j <= Math.min(GN - 1, cy + 1); j++) { const cell = grid[i * GN + j]; for (let k = 0; k < cell.length; k++) if (fn(cell[k]) === false) return; }
    }

    /* ---------- update ---------- */
    function update(dt) {
      g.t += dt;
      const p = g.p, st = stats(), dir = director(g.t);
      g.shake = Math.max(0, g.shake - dt * 30); g.hurtT = Math.max(0, g.hurtT - dt);
      if (g.banner) { g.banner.t -= dt; if (g.banner.t <= 0) g.banner = null; }

      if (!p.dead) {
        p.inv = Math.max(0, p.inv - dt); p.recoil = Math.max(0, p.recoil - dt * 8);
        const [mx, my] = moveVec(), a = 1 - Math.exp(-12 * dt);
        p.vx += (mx * st.speed - p.vx) * a; p.vy += (my * st.speed - p.vy) * a;
        p.x = clamp(p.x + p.vx * dt, p.r, A - p.r); p.y = clamp(p.y + p.vy * dt, p.r, A - p.r);
        p.wheel += hyp(p.vx, p.vy) * dt * 0.06 + dt * 2;
        const ca = 1 - Math.exp(-10 * dt); g.cam.x += (camX(p.x) - g.cam.x) * ca; g.cam.y += (camY(p.y) - g.cam.y) * ca;
        // manual aim + fire
        let fire = false;
        if (input.mode === "touch") {
          const s = input.aim;
          if (s) { const dx = s.x - s.ox, dy = s.y - s.oy; if (hyp(dx, dy) > CFG.stickR * 0.25) { p.aim = Math.atan2(dy, dx); fire = true; } }
        } else {
          if (input.mouse.has) { const [wx, wy] = toWorld(input.mouse.x, input.mouse.y); p.aim = Math.atan2(wy - p.y, wx - p.x); }
          else if (mx || my) p.aim = Math.atan2(my, mx);
          fire = input.mouse.down || input.space;
        }
        if (fire) { p.fireT -= dt; let n = 0; while (p.fireT <= 0 && n++ < 3) { shoot(st); p.fireT += st.interval; } }
        else p.fireT = Math.max(0, p.fireT - dt);
      } else {
        p.deadT -= dt; if (p.deadT <= 0) return gameOver();
      }

      // director: endless spawns from all sides, a horde ring every minute, a boss every few minutes
      if (!p.dead) {
        g.spawnAcc += dir.rate * dt * (g.boss ? 0.6 : 1);
        while (g.spawnAcc >= 1) {
          if (g.enemies.length >= dir.maxAlive) { g.spawnAcc = Math.min(g.spawnAcc, 2); break; }
          g.spawnAcc--;
          const r = Math.random(), type = r < dir.big ? "big" : r < dir.big + dir.fast ? "fast" : "cat", e = spawn(type);
          // cats often shuffle in as a small clump
          if (e && type === "cat" && g.t > 8 && Math.random() < 0.3) for (let k = 0; k < 2 && g.enemies.length < dir.maxAlive; k++) spawn("cat", clamp(e.x + rand(-40, 40), 20, A - 20), clamp(e.y + rand(-40, 40), 20, A - 20));
        }
        if (g.t >= g.nextHorde) { spawnHorde(); g.nextHorde += CFG.hordeEvery; }
        if (g.t >= g.nextBoss) { if (!g.boss) spawnBoss(); g.nextBoss += CFG.bossEvery; }
      }

      // enemies: walk straight at the hamster
      for (const c of grid) c.length = 0;
      const kd = Math.exp(-8 * dt);
      for (const e of g.enemies) {
        e.flash = Math.max(0, e.flash - dt);
        const dx = p.x - e.x, dy = p.y - e.y, d = hyp(dx, dy) || 1, nx = dx / d, ny = dy / d;
        const sp = p.dead ? -e.spd * 0.4 : e.spd;
        e.x = clamp(e.x + (nx * sp + e.kx) * dt, e.r, A - e.r); e.y = clamp(e.y + (ny * sp + e.ky) * dt, e.r, A - e.r);
        e.kx *= kd; e.ky *= kd; e.face = dx < 0 ? -1 : 1; e.ang = Math.atan2(dy, dx);
        if (!p.dead && d < e.r + p.r * 0.8) { hurtPlayer(e.dmg, e.x, e.y); if (e.type !== "boss") { e.kx = -nx * 220; e.ky = -ny * 220; } }
        if (e.type !== "boss") grid[cellOf(e.x, e.y)].push(e);
      }
      // separation (no stacking), boss shoves everyone
      for (const e of g.enemies) {
        if (e.type === "boss") continue;
        forNear(e.x, e.y, o => {
          if (o.id <= e.id) return;
          const dx = o.x - e.x, dy = o.y - e.y, md = e.r + o.r, d2 = dx * dx + dy * dy;
          if (d2 > 0.01 && d2 < md * md) { const d = Math.sqrt(d2), k = (md - d) / 2 / d; e.x -= dx * k; e.y -= dy * k; o.x += dx * k; o.y += dy * k; }
        });
      }
      if (g.boss) for (const o of g.enemies) {
        if (o === g.boss) continue;
        const b = g.boss, dx = o.x - b.x, dy = o.y - b.y, md = b.r + o.r, d2 = dx * dx + dy * dy;
        if (d2 > 0.01 && d2 < md * md) { const d = Math.sqrt(d2), k = (md - d) / d; o.x += dx * k; o.y += dy * k; }
      }

      // seeds (bullets)
      for (const s of g.shots) {
        s.x += s.vx * dt; s.y += s.vy * dt; s.life -= dt;
        if (s.life <= 0 || s.x < 0 || s.x > A || s.y < 0 || s.y > A) { s.dead = true; continue; }
        const hit = e => {
          if (e.dead || s.dead || s.hits.includes(e.id)) return;
          const rr2 = e.r + CFG.shot.r;
          if ((e.x - s.x) ** 2 + (e.y - s.y) ** 2 < rr2 * rr2) {
            s.hits.push(e.id); hitEnemy(e, s.dmg, s.vx / CFG.shot.speed, s.vy / CFG.shot.speed);
            burst(s.x, s.y, 2, ["#f4ecd8", "#ffd23f"], 110, 2, 0.2);
            if (s.hits.length > s.pierce) s.dead = true;
          }
        };
        forNear(s.x, s.y, hit);
        if (g.boss && !s.dead) hit(g.boss);
      }
      // xp seeds + hearts
      const mr = CFG.magnet + p.r;
      for (const gm of g.gems) {
        if (p.dead) break;
        const dx = p.x - gm.x, dy = p.y - gm.y, d = hyp(dx, dy);
        if (!gm.pull && d < mr) gm.pull = true;
        if (gm.pull) { const s = Math.min(1, (380 + (mr - Math.min(d, mr)) * 4) * dt / Math.max(d, 1)); gm.x += dx * s; gm.y += dy * s; }
        if (d < p.r) { gm.dead = true; sfx.xp(); addXp(gm.v); }
      }
      for (const h of g.hearts) {
        h.t -= dt; if (h.t <= 0) { h.dead = true; continue; }
        if (!p.dead && hyp(p.x - h.x, p.y - h.y) < p.r + 16) { h.dead = true; p.hp = Math.min(p.maxHp, p.hp + 25); floatText(p.x, p.y - 40, "+25", "#ff6b81", 20); ring(p.x, p.y, 60, "#ff6b81"); sfx.heal(); }
      }
      for (const q of g.parts) { q.t -= dt; q.x += q.vx * dt; q.y += q.vy * dt; q.vx *= 1 - 3 * dt; q.vy *= 1 - 3 * dt; }
      for (const q of g.texts) { q.t -= dt; q.y -= 40 * dt; }
      g.enemies = g.enemies.filter(e => !e.dead); g.shots = g.shots.filter(s => !s.dead); g.gems = g.gems.filter(x => !x.dead);
      g.hearts = g.hearts.filter(h => !h.dead); g.parts = g.parts.filter(q => q.t > 0); g.texts = g.texts.filter(q => q.t > 0);
    }

    function shoot(st) {
      const p = g.p, n = st.shots, nose = p.r + 12;
      for (let i = 0; i < n; i++) {
        const a = p.aim + (i - (n - 1) / 2) * CFG.shot.spread + rand(-0.025, 0.025);
        g.shots.push({ x: p.x + Math.cos(p.aim) * nose, y: p.y + Math.sin(p.aim) * nose, vx: Math.cos(a) * CFG.shot.speed, vy: Math.sin(a) * CFG.shot.speed, a, life: CFG.shot.life, dmg: st.dmg, pierce: st.pierce, hits: [] });
      }
      p.recoil = 1; sfx.shoot();
    }

    function gameOver() {
      state = "over";
      const time = g.t - g.t0;
      let newBest = false;
      if (record) {
        if (time > bestTime) { bestTime = time; newBest = true; store.set("bestTime", time.toFixed(1)); }
        if (g.kills > bestKills) { bestKills = g.kills; store.set("bestKills", bestKills); }
      }
      sfx.over(); clearInput();
      emit("state", { state });
      emit("gameover", { time, kills: g.kills, level: g.level, bestTime, bestKills, newBest, recorded: record });
    }

    /* ---------- render ---------- */
    function render() {
      const c = ctx, now = performance.now() / 1000;
      c.setTransform(1, 0, 0, 1, 0, 0);
      if (bg) c.drawImage(bg, 0, 0); else { c.fillStyle = "#12134d"; c.fillRect(0, 0, canvas.width, canvas.height); }
      const cam = g ? g.cam : { x: A / 2, y: A / 2 };
      const sh = g && state === "play" ? g.shake : 0, ox = sh ? rand(-sh, sh) : 0, oy = sh ? rand(-sh, sh) : 0;
      const k = dpr * sc, tx = (W / 2 - cam.x) * k + ox * dpr, ty = (H / 2 - cam.y) * k + oy * dpr;
      c.setTransform(k, 0, 0, k, tx, ty);
      const vx0 = cam.x - W / 2 - 80, vx1 = cam.x + W / 2 + 80, vy0 = cam.y - H / 2 - 80, vy1 = cam.y + H / 2 + 80;
      const vis = (x, y) => x > vx0 && x < vx1 && y > vy0 && y < vy1;
      drawFloor(c, now, vx0, vx1, vy0, vy1, vis);
      if (!g) {   // menu backdrop: idle hamster in the middle of the arena
        menuT += 1 / 60;
        drawPlayer(c, { x: A / 2, y: A / 2 + H * 0.12 + Math.sin(menuT * 2) * 8, vx: 0, vy: 160, r: CFG.player.r * 1.6, aim: -Math.PI / 2 + Math.sin(menuT) * 0.3, wheel: menuT * 3, inv: 0, recoil: 0 }, now);
        return;
      }
      const p = g.p;
      for (const gm of g.gems) if (vis(gm.x, gm.y)) { const b = baked[gm.v > 1 ? "gold" : "seed"]; c.save(); c.translate(gm.x, gm.y); c.rotate(gm.a); c.drawImage(b.cv, -b.half, -b.half, b.half * 2, b.half * 2); c.restore(); }
      for (const h of g.hearts) if (vis(h.x, h.y) && (h.t > 4 || Math.floor(now * 8) % 2)) { c.save(); c.globalAlpha = 0.5; c.strokeStyle = "#ff6b81"; c.lineWidth = 3; c.beginPath(); c.arc(h.x, h.y, 19 + Math.sin(now * 5) * 2, 0, TAU); c.stroke(); c.restore(); heart(c, h.x, h.y, 13); }
      for (const e of g.enemies) {
        if (e.type === "boss" || !vis(e.x, e.y)) continue;
        const b = baked[e.flash > 0 ? e.type + "!" : e.type]; if (!b) continue;
        c.save(); c.translate(e.x, e.y + (e.type === "big" ? 0 : Math.sin(now * 7 + e.seed) * 1.5));
        if (e.type === "big") c.rotate(e.ang || 0); else if (e.face < 0) c.scale(-1, 1);
        c.drawImage(b.cv, -b.half, -b.half, b.half * 2, b.half * 2); c.restore();
        if (e.type === "big" && e.hp < e.maxHp) hpBar(c, e.x, e.y - e.r - 12, e.r * 1.6, e.hp / e.maxHp);
      }
      if (g.boss) drawBoss(c, g.boss, now, p);
      for (const s of g.shots) drawShot(c, s);
      if (!p.dead) drawPlayer(c, p, now);
      for (const q of g.parts) {
        if (!vis(q.x, q.y)) continue;
        const f = q.t / q.m; c.globalAlpha = clamp(f, 0, 1);
        if (q.k === "ring") { c.strokeStyle = q.c; c.lineWidth = 5 * f + 1; c.beginPath(); c.arc(q.x, q.y, q.r * (1.1 - f * 0.8), 0, TAU); c.stroke(); }
        else if (q.k === "puff") { c.fillStyle = q.c; c.beginPath(); c.arc(q.x, q.y, q.r * (1.3 - f * 0.5), 0, TAU); c.fill(); }
        else { c.fillStyle = q.c; c.beginPath(); c.arc(q.x, q.y, q.r * (0.4 + f * 0.6), 0, TAU); c.fill(); }
      }
      c.globalAlpha = 1;
      for (const q of g.texts) { c.globalAlpha = clamp(q.t / q.m * 1.6, 0, 1); text(c, q.s, q.x, q.y, q.size, q.c, "center", "middle"); }
      c.globalAlpha = 1;
      c.setTransform(dpr, 0, 0, dpr, 0, 0);
      drawHud(c, now);
    }

    function drawFloor(c, now, x0, x1, y0, y1, vis) {
      // outside the arena (only visible on huge screens)
      c.fillStyle = "#080924";
      if (x0 < 0) c.fillRect(x0, y0, -x0, y1 - y0); if (x1 > A) c.fillRect(A, y0, x1 - A, y1 - y0);
      if (y0 < 0) c.fillRect(x0, y0, x1 - x0, -y0); if (y1 > A) c.fillRect(x0, A, x1 - x0, y1 - A);
      // floor grid
      const G = 120; c.strokeStyle = "rgba(56,217,255,.07)"; c.lineWidth = 2; c.beginPath();
      for (let x = Math.max(0, Math.floor(x0 / G) * G); x <= Math.min(A, x1); x += G) { c.moveTo(x, Math.max(0, y0)); c.lineTo(x, Math.min(A, y1)); }
      for (let y = Math.max(0, Math.floor(y0 / G) * G); y <= Math.min(A, y1); y += G) { c.moveTo(Math.max(0, x0), y); c.lineTo(Math.min(A, x1), y); }
      c.stroke();
      for (const b of deco.blobs) {
        if (!vis(b.x, b.y)) continue;
        c.save(); c.globalAlpha = 0.45; c.lineWidth = 4; c.strokeStyle = INK;
        if (b.crater) { c.fillStyle = "rgba(10,11,46,.6)"; c.beginPath(); c.ellipse(b.x, b.y, b.r, b.r * 0.6, 0, 0, TAU); c.fill(); c.strokeStyle = "rgba(120,130,255,.35)"; c.stroke(); }
        else {
          c.fillStyle = b.c; c.beginPath(); c.arc(b.x, b.y, b.r, 0, TAU); c.fill(); c.stroke();
          c.fillStyle = "rgba(255,255,255,.25)"; c.beginPath(); c.arc(b.x - b.r * 0.3, b.y - b.r * 0.3, b.r * 0.3, 0, TAU); c.fill();
          if (b.ring) { c.strokeStyle = "#ffd23f"; c.lineWidth = 5; c.beginPath(); c.ellipse(b.x, b.y, b.r * 1.7, b.r * 0.45, -0.35, 0, TAU); c.stroke(); }
        }
        c.restore();
      }
      c.fillStyle = "#fff";
      for (const s of deco.stars) { if (!vis(s.x, s.y)) continue; c.globalAlpha = 0.3 + 0.3 * Math.sin(now * s.s + s.p); c.fillRect(s.x, s.y, s.r, s.r); }
      c.globalAlpha = 1;
      // arena wall
      c.lineWidth = 14; c.strokeStyle = INK; rr(c, -7, -7, A + 14, A + 14, 30); c.stroke();
      c.lineWidth = 5; c.strokeStyle = "rgba(255,210,63,.8)"; c.setLineDash([22, 16]); rr(c, -7, -7, A + 14, A + 14, 30); c.stroke(); c.setLineDash([]);
    }

    function drawPlayer(c, p, t) {
      const blink = p.inv > 0 && Math.floor(p.inv * 14) % 2 === 0;
      const R = p.r, S = R / 262, k = 1024 * S, spd = clamp(hyp(p.vx, p.vy) / CFG.player.speed, 0, 1);
      c.save(); c.translate(p.x, p.y); if (blink) c.globalAlpha = 0.5;
      c.save(); c.rotate(p.aim + Math.PI / 2); c.translate(0, p.recoil * 2.5);
      const fy = 318 * S, L = (0.5 + spd * 1.1 + Math.random() * 0.25) * R, w = 0.33 * R;
      const gr = c.createLinearGradient(0, fy, 0, fy + L); gr.addColorStop(0, "#fff6b0"); gr.addColorStop(0.35, "#ffb02e"); gr.addColorStop(1, "rgba(255,61,90,0)");
      c.fillStyle = gr; c.beginPath(); c.moveTo(-w, fy); c.quadraticCurveTo(-w * 0.9, fy + L * 0.6, 0, fy + L); c.quadraticCurveTo(w * 0.9, fy + L * 0.6, w, fy); c.closePath(); c.fill();
      if (spr.back) c.drawImage(spr.back, -512 * S, -480 * S, k, k);
      else { c.fillStyle = "#ff6b81"; c.strokeStyle = INK; c.lineWidth = 3; c.beginPath(); c.moveTo(-R * 0.45, -R * 0.85); c.lineTo(0, -R * 1.6); c.lineTo(R * 0.45, -R * 0.85); c.closePath(); c.fill(); c.stroke(); c.fillStyle = "#262a86"; c.beginPath(); c.arc(0, 0, R, 0, TAU); c.fill(); }
      c.restore();
      c.save(); c.rotate(p.wheel); c.strokeStyle = "#5b63d6"; c.lineWidth = 1.4;
      for (let i = 0; i < 8; i++) { const a = i * Math.PI / 4; c.beginPath(); c.moveTo(0, 0); c.lineTo(Math.cos(a) * R * 0.92, Math.sin(a) * R * 0.92); c.stroke(); }
      c.restore();
      const bob = Math.sin(t * 16) * 1.2 * spd;
      if (spr.face) c.drawImage(spr.face, -512 * S, -530 * S + bob, k, k);
      else { c.fillStyle = "#ffbb55"; c.beginPath(); c.arc(0, bob, R * 0.7, 0, TAU); c.fill(); }
      c.lineWidth = 64 * S; c.strokeStyle = INK; c.beginPath(); c.arc(0, 0, 262 * S, 0, TAU); c.stroke();
      c.lineWidth = 40 * S; c.strokeStyle = "#38d9ff"; c.beginPath(); c.arc(0, 0, 262 * S, 0, TAU); c.stroke();
      c.restore();
    }
    function drawShot(c, s) {
      c.save(); c.translate(s.x, s.y); c.rotate(s.a); c.scale(1.3, 1.3);
      c.fillStyle = "rgba(255,210,63,.45)"; c.beginPath(); c.ellipse(-10, 0, 12, 3, 0, 0, TAU); c.fill();
      seedShape(c, false);
      c.restore();
    }
    function drawBoss(c, e, t, p) {
      const r = e.r, angry = e.hp < e.maxHp * 0.5, stomp = Math.abs(Math.sin(t * 4)) * 3;
      c.save(); c.translate(e.x, e.y - stomp); c.lineJoin = "round"; c.lineCap = "round"; c.strokeStyle = INK;
      c.fillStyle = "rgba(0,0,0,.25)"; c.beginPath(); c.ellipse(0, r * 1.1 + stomp, r * 0.9, r * 0.25, 0, 0, TAU); c.fill();
      c.lineWidth = 4; c.beginPath(); c.moveTo(0, -r * 0.9); c.lineTo(0, -r * 1.32); c.stroke();
      c.fillStyle = Math.floor(t * 3) % 2 ? "#ff3d5a" : "#ffd23f"; c.beginPath(); c.arc(0, -r * 1.38, 7, 0, TAU); c.fill(); c.stroke();
      c.lineWidth = 5;
      for (const s of [-1, 1]) {
        c.fillStyle = "#9aa6c8"; c.beginPath(); c.moveTo(s * r * 0.97, -r * 0.15); c.lineTo(s * r * 0.86, -r * 1.15); c.lineTo(s * r * 0.18, -r * 0.84); c.closePath(); c.fill(); c.stroke();
        c.fillStyle = "#ff6b81"; c.beginPath(); c.moveTo(s * r * 0.8, -r * 0.4); c.lineTo(s * r * 0.77, -r * 0.92); c.lineTo(s * r * 0.4, -r * 0.75); c.closePath(); c.fill();
      }
      c.fillStyle = "#b8c2da"; c.lineWidth = 6; c.beginPath(); c.arc(0, 0, r, 0, TAU); c.fill(); c.stroke();
      c.fillStyle = "rgba(255,255,255,.35)"; c.beginPath(); c.ellipse(-r * 0.35, -r * 0.6, r * 0.35, r * 0.14, -0.4, 0, TAU); c.fill();
      c.fillStyle = "#6c7699"; for (const [x, y] of [[-0.72, 0.38], [0.72, 0.38], [-0.45, -0.7], [0.45, -0.7]]) { c.beginPath(); c.arc(x * r, y * r, 3.5, 0, TAU); c.fill(); }
      c.strokeStyle = INK; c.lineWidth = 4; c.fillStyle = "#262a86"; rr(c, -r * 0.74, -r * 0.4, r * 1.48, r * 0.52, r * 0.24); c.fill(); c.stroke();
      const dx = p.x - e.x, dy = p.y - e.y, d = hyp(dx, dy) || 1, lx = dx / d * 5, ly = dy / d * 3, eye = angry ? "#ffd23f" : "#ff3d5a";
      c.fillStyle = eye; c.shadowColor = eye; c.shadowBlur = 14;
      for (const s of [-1, 1]) { c.beginPath(); c.ellipse(s * r * 0.36 + lx, -r * 0.14 + ly, r * 0.16, angry ? r * 0.08 : r * 0.12, 0, 0, TAU); c.fill(); }
      c.shadowBlur = 0;
      c.lineWidth = 5; for (const s of [-1, 1]) { c.beginPath(); c.moveTo(s * r * 0.62, -r * 0.5); c.lineTo(s * r * 0.15, -r * 0.36); c.stroke(); }
      c.fillStyle = "#3a4166"; c.lineWidth = 4; rr(c, -r * 0.42, r * 0.26, r * 0.84, r * 0.36, 8); c.fill(); c.stroke();
      c.fillStyle = "#fff";
      for (let i = 0; i < 5; i++) { const x = -r * 0.34 + i * r * 0.136; c.beginPath(); c.moveTo(x, r * 0.28); c.lineTo(x + r * 0.068, r * 0.42); c.lineTo(x + r * 0.136, r * 0.28); c.closePath(); c.fill(); }
      const whisk = () => { for (const s of [-1, 1]) { c.beginPath(); c.moveTo(s * r * 0.55, r * 0.3); c.lineTo(s * r * 1.3, r * 0.15); c.moveTo(s * r * 0.55, r * 0.45); c.lineTo(s * r * 1.25, r * 0.55); c.stroke(); } };
      c.strokeStyle = INK; c.lineWidth = 5; whisk(); c.strokeStyle = "#dfe6f2"; c.lineWidth = 2.5; whisk();
      if (e.flash > 0) { c.globalAlpha = 0.28; c.fillStyle = "#fff"; c.beginPath(); c.arc(0, 0, r, 0, TAU); c.fill(); c.globalAlpha = 1; }
      c.restore();
    }

    const fmt = s => { s = Math.max(0, Math.floor(s)); return Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0"); };
    function drawHud(c, t) {
      const p = g.p, narrow = cssW < 520;
      if (g.hurtT > 0 || (p.hp < p.maxHp * 0.3 && !p.dead)) {
        const a = g.hurtT > 0 ? g.hurtT * 1.2 : 0.18 + 0.12 * Math.sin(t * 6);
        const gr = c.createRadialGradient(cssW / 2, cssH / 2, Math.min(cssW, cssH) * 0.35, cssW / 2, cssH / 2, Math.max(cssW, cssH) * 0.75);
        gr.addColorStop(0, "rgba(255,40,70,0)"); gr.addColorStop(1, `rgba(255,40,70,${clamp(a, 0, 0.5)})`); c.fillStyle = gr; c.fillRect(0, 0, cssW, cssH);
      }
      // XP bar across the top
      const need = xpNeed(g.level), xw = cssW - 20;
      c.fillStyle = "rgba(0,0,0,.5)"; rr(c, 10, 6, xw, 9, 4.5); c.fill();
      c.fillStyle = "#5be37d"; if (g.xp > 0) { rr(c, 10, 6, Math.max(9, xw * clamp(g.xp / need, 0, 1)), 9, 4.5); c.fill(); }
      c.lineWidth = 2.5; c.strokeStyle = INK; rr(c, 10, 6, xw, 9, 4.5); c.stroke();
      // HP + level (top-left)
      const by = 26, bw = Math.min(150, cssW * (narrow ? 0.25 : 0.3)), bx = 34;
      c.fillStyle = "rgba(0,0,0,.5)"; rr(c, bx, by, bw, 14, 7); c.fill();
      const f = p.hp / p.maxHp; c.fillStyle = f > 0.5 ? "#5be37d" : f > 0.25 ? "#ffd23f" : "#ff4d6d";
      if (f > 0) { rr(c, bx, by, Math.max(14, bw * f), 14, 7); c.fill(); }
      c.lineWidth = 3; c.strokeStyle = INK; rr(c, bx, by, bw, 14, 7); c.stroke();
      heart(c, 21, by + 7, 10);
      text(c, T("hud.level", "LV") + " " + g.level, 12, by + 22, 15, "#5be37d");
      // big timer + kills (top-centre)
      const ts = narrow ? 36 : 46, tt = fmt(g.t - g.t0), ky = 22 + ts + 4, kt = String(g.kills), b = baked.cat;
      c.font = `${ts}px ${FONT}`; const pw = Math.max(narrow ? 104 : 132, c.measureText(tt).width + 34);
      c.fillStyle = "rgba(13,7,32,.55)"; rr(c, cssW / 2 - pw / 2, 18, pw, ky + 22 - 18, 16); c.fill();
      text(c, tt, cssW / 2, 22, ts, "#fff", "center");
      c.font = `16px ${FONT}`; const kw = c.measureText(kt).width, kx = cssW / 2 - (kw + 24) / 2;
      if (b) c.drawImage(b.cv, kx, ky - 3, 20, 20);
      text(c, kt, kx + 24, ky, 16, "#ffd23f");
      if (g.boss) {
        const w = Math.min(260, cssW * 0.5), x = cssW / 2 - w / 2, y = ky + 24, e = g.boss;
        c.fillStyle = "rgba(0,0,0,.55)"; rr(c, x, y, w, 12, 6); c.fill();
        c.fillStyle = "#ff4d6d"; rr(c, x, y, Math.max(12, w * e.hp / e.maxHp), 12, 6); c.fill();
        c.lineWidth = 3; c.strokeStyle = INK; rr(c, x, y, w, 12, 6); c.stroke();
        text(c, T("hud.boss", "ROBO-CAT"), cssW / 2, y + 15, 11, "#ff9fb2", "center");
        // off-screen pointer to the boss
        const sx = (e.x - g.cam.x) * sc + cssW / 2, sy = (e.y - g.cam.y) * sc + cssH / 2;
        if (sx < 0 || sx > cssW || sy < 0 || sy > cssH) {
          const a = Math.atan2(sy - cssH / 2, sx - cssW / 2), m = 30;
          const ex = clamp(cssW / 2 + Math.cos(a) * cssW, m, cssW - m), ey = clamp(cssH / 2 + Math.sin(a) * cssH, m + 90, cssH - m);
          c.save(); c.translate(ex, ey); c.rotate(a); c.fillStyle = "#ff4d6d"; c.strokeStyle = INK; c.lineWidth = 3;
          c.beginPath(); c.moveTo(14, 0); c.lineTo(-8, -10); c.lineTo(-8, 10); c.closePath(); c.fill(); c.stroke(); c.restore();
        }
      }
      if (g.banner) {
        const bn = g.banner, kk = 1 - bn.t / bn.max, s = kk < 0.15 ? 0.6 + kk / 0.15 * 0.4 : 1, a = bn.t < 0.4 ? bn.t / 0.4 : 1;
        c.save(); c.globalAlpha = a; c.translate(cssW / 2, cssH * 0.34); c.scale(s, s);
        text(c, bn.txt, 0, 0, Math.min(46, cssW / (bn.txt.length * 0.62 + 1)), bn.col, "center", "middle");
        if (bn.sub) text(c, bn.sub, 0, 34, 18, "#fff", "center", "middle");
        c.restore();
      }
      if (input.mode === "touch" && state === "play") {
        const stick = (s, hx, hy, label, col) => {
          const R = CFG.stickR;
          if (s) {
            const dx = s.x - s.ox, dy = s.y - s.oy, d = hyp(dx, dy), k2 = d > R ? R / d : 1;
            c.fillStyle = "rgba(255,255,255,.1)"; c.strokeStyle = "rgba(255,255,255,.5)"; c.lineWidth = 3;
            c.beginPath(); c.arc(s.ox, s.oy, R, 0, TAU); c.fill(); c.stroke();
            c.fillStyle = col; c.strokeStyle = INK; c.beginPath(); c.arc(s.ox + dx * k2, s.oy + dy * k2, 24, 0, TAU); c.fill(); c.stroke();
          } else {
            c.save(); c.globalAlpha = g.t - g.t0 < 12 ? 0.5 : 0.18;
            c.strokeStyle = "#fff"; c.lineWidth = 3; c.setLineDash([6, 6]); c.beginPath(); c.arc(hx, hy, R, 0, TAU); c.stroke(); c.setLineDash([]);
            c.fillStyle = col; c.beginPath(); c.arc(hx, hy, 18, 0, TAU); c.fill();
            text(c, label, hx, hy + R + 8, 12, "#fff", "center"); c.restore();
          }
        };
        const hy = cssH - CFG.stickR - 34;
        stick(input.move, CFG.stickR + 20, hy, T("hud.move", "MOVE"), "rgba(255,210,63,.9)");
        stick(input.aim, cssW - CFG.stickR - 20, hy, T("hud.aim", "AIM + SHOOT"), "rgba(56,217,255,.9)");
      }
      if (input.mode === "mouse" && input.mouse.has && state === "play") {
        const { x, y } = input.mouse;
        const cross = () => { c.beginPath(); c.arc(x, y, 10, 0, TAU); c.moveTo(x - 17, y); c.lineTo(x - 6, y); c.moveTo(x + 6, y); c.lineTo(x + 17, y); c.moveTo(x, y - 17); c.lineTo(x, y - 6); c.moveTo(x, y + 6); c.lineTo(x, y + 17); c.stroke(); };
        c.strokeStyle = INK; c.lineWidth = 5; cross(); c.strokeStyle = input.mouse.down ? "#ff8a1f" : "#ffd23f"; c.lineWidth = 2.5; cross();
      }
    }

    /* ---------- loop ---------- */
    let cursor = "";
    function frame(ts) {
      raf = requestAnimationFrame(frame);
      const dt = Math.min(0.05, Math.max(0, (ts - (last || ts)) / 1000)); last = ts;
      if (state === "play") update(dt);
      render();
      const cur = state === "play" && input.mode === "mouse" && input.mouse.has ? "none" : "default";
      if (cur !== cursor) { canvas.style.cursor = cur; cursor = cur; }
    }

    /* ---------- public API ---------- */
    function start(o = {}) {
      sfx.ensure(); clearInput();
      record = o.record !== false;
      newRun(clamp(+o.t0 || 0, 0, 3600)); snapCam();
      state = "play"; last = 0;
      if (o.boss) g.nextBoss = g.t + 1.5;
      emit("state", { state });
    }
    function pause(reason = "user") { if (state !== "play") return; state = "paused"; clearInput(); emit("state", { state, reason }); }
    function resume() { if (state !== "paused") return; state = "play"; last = 0; clearInput(); sfx.ensure(); emit("state", { state }); }
    function setMuted(m) { sfx.setMuted(m); store.set("muted", m ? "1" : "0"); emit("mute", { muted: !!m }); }
    function toggleMute() { setMuted(!sfx.muted); if (!sfx.muted) { sfx.ensure(); sfx.click(); } }
    function destroy() {
      cancelAnimationFrame(raf); if (ro) ro.disconnect(); else global.removeEventListener("resize", resize);
      global.removeEventListener("keydown", onKey); global.removeEventListener("keyup", onKey); global.removeEventListener("blur", clearInput);
      document.removeEventListener("visibilitychange", onVis);
    }

    resize();
    raf = requestAnimationFrame(frame);

    return {
      start, choose, pause, resume, setMuted, toggleMute, destroy, fmt,
      get state() { return state; }, get muted() { return sfx.muted; },
      get choices() { return g && g.choices ? g.choices.slice() : null; },
      best: () => ({ time: bestTime, kills: bestKills }),
      // test/debug helpers (only do something when called)
      debug: {
        info: () => g && {
          state, time: g.t - g.t0, clock: g.t, kills: g.kills, level: g.level, xp: g.xp, need: xpNeed(g.level), hp: g.p.hp, maxHp: g.p.maxHp, up: Object.assign({}, g.up),
          shots: g.shots.length, gems: g.gems.length, boss: g.boss ? { hp: g.boss.hp, maxHp: g.boss.maxHp } : null,
          enemies: g.enemies.reduce((m, e) => (m[e.type] = (m[e.type] || 0) + 1, m), {}), count: g.enemies.length,
          player: { x: g.p.x, y: g.p.y, aim: g.p.aim }, cam: { x: g.cam.x, y: g.cam.y }, world: { W, H, sc, A }, mode: input.mode,
          list: g.enemies.map(e => ({ id: e.id, type: e.type, x: Math.round(e.x), y: Math.round(e.y), r: e.r })),
          gemList: g.gems.map(x => ({ x: Math.round(x.x), y: Math.round(x.y) }))
        },
        addXp: v => { if (g) addXp(v); },
        upgrade: (id, n = 1) => { if (g) for (let i = 0; i < n && g.up[id] < UPGRADES[id]; i++) { g.up[id]++; if (id === "hp") { g.p.maxHp += 20; g.p.hp += 20; } } },
        spawn: (type, x, y) => !!(g && spawn(type, x, y)),
        setHp: v => { if (g) g.p.hp = v; },
        god: on => { if (g) g.god = !!on; },
        hurt: dmg => { if (g) { g.p.inv = 0; hurtPlayer(dmg, g.p.x, g.p.y - 1); } },
        director, xpNeed
      }
    };
  }

  global.HamsterArena = { create, director, upgrades: UPGRADES, version: "0.2.0-test" };
})(window);
