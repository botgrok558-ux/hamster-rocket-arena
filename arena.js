/* Hamster Rocket Arena: self-contained 2D arena-shooter module (Canvas 2D + WebAudio, no dependencies).

   const game = HamsterArena.create({
     canvas,                    // <canvas> that fills its container (CSS size decides the arena size)
     assetBase: "assets/",      // folder with rocket_back.svg + hamster_face.svg (falls back to vector art)
     t: (key, english) => str,  // optional translator for in-canvas text
     storagePrefix: "hra_",     // localStorage prefix for best score + mute
     onEvent: (type, data) => {}// "state" {state, reason}, "wave" {wave, boss}, "power" {type}, "gameover" {...}, "mute" {muted}
   });
   game.start(wave = 1, { record = true })   game.pause()   game.resume()   game.toggleMute()   game.state   game.best()

   Simulation, rendering, input and sound all live in this one file so it can later be dropped into the
   main Hamster Rocket demo as an extra mode. */
(function (global) {
  "use strict";
  const TAU = Math.PI * 2, INK = "#170d33", FONT = '"Luckiest Guy", system-ui, sans-serif';
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v), rand = (a, b) => a + Math.random() * (b - a);
  const hyp = Math.hypot;

  const CFG = {
    baseSize: 440, maxScale: 1.45, minScale: 0.6,          // the short screen side shows ~440 world units
    player: { r: 24, speed: 290, hp: 100, inv: 0.75 },
    seed: { speed: 680, r: 6, dmg: 1, interval: 0.22, rapid: 0.085, spread: 0.24, life: 1.5 },
    power: { triple: 10, rapid: 8, shield: 7 }, heal: 35,
    comboWindow: 2.2, stickR: 56, mineBlast: 92
  };
  const PW = ["triple", "rapid", "shield", "heal"];
  const PW_COL = { triple: "#ffd23f", rapid: "#ff8a1f", shield: "#38d9ff", heal: "#ff6b81" };
  const PW_NAME = { triple: ["pw.triple", "TRIPLE SHOT!"], rapid: ["pw.rapid", "RAPID FIRE!"], shield: ["pw.shield", "SHIELD!"], heal: ["pw.heal", "+HEALTH!"] };

  /* ------------------------------------------------------------------ difficulty */
  // Gentle ramp: wave 1 = 4 slow cat drones, vacuums from wave 2, mines from wave 3, boss every 5th wave.
  function wavePlan(n) {
    const boss = n % 5 === 0, k = Math.floor(n / 5), list = [];
    if (boss) {
      list.push("boss");
      for (let i = 0; i < Math.min(6, (k - 1) * 2); i++) list.push("mine");
    } else {
      const cats = Math.round(3 + n * 1.2), vacs = n < 2 ? 0 : Math.floor(n / 2), mines = n < 3 ? 0 : Math.min(8, Math.floor((n - 1) / 2) + 1);
      const rest = [];
      for (let i = 2; i < cats; i++) rest.push("cat");
      for (let i = 0; i < vacs; i++) rest.push("vac");
      for (let i = 0; i < mines; i++) rest.push("mine");
      for (let i = rest.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [rest[i], rest[j]] = [rest[j], rest[i]]; }
      list.push("cat", "cat", ...rest);   // every wave opens with two cats
    }
    return {
      list, boss,
      interval: Math.max(0.4, 1.3 - 0.08 * (n - 1)),
      group: 1 + Math.floor((n - 1) / 3),          // enemies per spawn tick: 1 (waves 1-3), 2 (4-6), 3 (7-9)...
      maxAlive: Math.min(28, 4 + n * 2),
      catSpeed: Math.min(200, 80 + 9 * (n - 1)),
      vacSpeed: Math.min(85, 42 + 3 * (n - 1)),
      hpMul: 1 + 0.12 * Math.max(0, n - 3)
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
    return {
      ensure,
      get muted() { return muted; },
      setMuted(m) { muted = !!m; if (master) master.gain.value = muted ? 0 : VOL; },
      shoot() { if (gap("shoot", 55)) tone("square", 900, 480, 0.05, 0.05); },
      hit() { if (gap("hit", 35)) tone("triangle", 320, 180, 0.06, 0.12); },
      pop() { if (gap("pop", 30)) { tone("square", 560, 110, 0.13, 0.12); noise(0.1, 0.1, 2600); } },
      boom() { if (gap("boom", 60)) { noise(0.5, 0.42, 1000); tone("sawtooth", 130, 38, 0.42, 0.18); } },
      hurt() { if (gap("hurt", 120)) { tone("sawtooth", 280, 90, 0.24, 0.2); noise(0.12, 0.12, 900); } },
      block() { if (gap("block", 80)) tone("sine", 1200, 700, 0.12, 0.14); },
      pickup() { arp([660, 880, 1320], "triangle", 0.055, 0.09, 0.15); },
      wave() { arp([523, 659, 784, 1046], "square", 0.08, 0.12, 0.07); },
      clear() { arp([784, 988, 1175, 1568], "triangle", 0.07, 0.14, 0.13); },
      boss() { tone("sawtooth", 95, 55, 1.0, 0.22); tone("square", 190, 95, 1.0, 0.07); noise(0.6, 0.15, 500); },
      enemyShot() { if (gap("es", 90)) tone("sine", 420, 260, 0.1, 0.07); },
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
  function powerIcon(c, type, x, y, r) {
    const k = r / 16;
    c.save(); c.translate(x, y); c.lineJoin = "round";
    c.fillStyle = PW_COL[type]; c.strokeStyle = INK; c.lineWidth = Math.max(2, r * 0.18);
    c.beginPath(); c.arc(0, 0, r, 0, TAU); c.fill(); c.stroke();
    c.fillStyle = "rgba(255,255,255,.35)"; c.beginPath(); c.ellipse(-r * 0.3, -r * 0.42, r * 0.38, r * 0.2, -0.5, 0, TAU); c.fill();
    c.fillStyle = "#fff"; c.lineWidth = Math.max(1.5, r * 0.12);
    c.beginPath();
    if (type === "triple") {
      for (let i = -1; i <= 1; i++) { c.save(); c.translate(0, 7 * k); c.rotate(i * 0.55); c.beginPath(); c.ellipse(0, -9 * k, 3.2 * k, 6 * k, 0, 0, TAU); c.fill(); c.stroke(); c.restore(); }
    } else if (type === "rapid") {
      const P = [[3, -12], [-7, 2], [-1, 2], [-4, 12], [7, -3], [1, -3]];
      P.forEach(([px, py], i) => (i ? c.lineTo(px * k, py * k) : c.moveTo(px * k, py * k))); c.closePath(); c.fill(); c.stroke();
    } else if (type === "shield") {
      c.moveTo(0, -11 * k); c.lineTo(9 * k, -7 * k); c.quadraticCurveTo(9 * k, 6 * k, 0, 11 * k); c.quadraticCurveTo(-9 * k, 6 * k, -9 * k, -7 * k); c.closePath(); c.fill(); c.stroke();
    } else {
      c.moveTo(0, 9 * k); c.bezierCurveTo(-13 * k, 0, -8 * k, -12 * k, 0, -4.5 * k); c.bezierCurveTo(8 * k, -12 * k, 13 * k, 0, 0, 9 * k); c.closePath(); c.fill(); c.stroke();
    }
    c.restore();
  }
  function hpBar(c, x, y, w, f) {
    const h = 6; c.fillStyle = "rgba(0,0,0,.55)"; rr(c, x - w / 2, y, w, h, 3); c.fill();
    c.fillStyle = f > 0.5 ? "#5be37d" : f > 0.25 ? "#ffd23f" : "#ff4d6d"; rr(c, x - w / 2, y, w * clamp(f, 0, 1), h, 3); c.fill();
    c.lineWidth = 2; c.strokeStyle = INK; rr(c, x - w / 2, y, w, h, 3); c.stroke();
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

    /* ---------- view / resize ---------- */
    let cssW = 1, cssH = 1, dpr = 1, sc = 1, W = 1, H = 1, pad = 10, bg = null, stars = [];
    function resize() {
      const r = canvas.getBoundingClientRect();
      cssW = Math.max(1, r.width); cssH = Math.max(1, r.height);
      dpr = Math.min(2, global.devicePixelRatio || 1);
      canvas.width = Math.round(cssW * dpr); canvas.height = Math.round(cssH * dpr);
      sc = clamp(Math.min(cssW, cssH) / CFG.baseSize, CFG.minScale, CFG.maxScale);
      W = cssW / sc; H = cssH / sc; pad = 10 / sc;
      buildBg();
      if (g) clampInside(g.p, g.p.r);
      render();
    }
    function buildBg() {
      bg = document.createElement("canvas"); bg.width = canvas.width; bg.height = canvas.height;
      const c = bg.getContext("2d"); c.scale(dpr, dpr);
      const gr = c.createRadialGradient(cssW * 0.5, cssH * 0.15, 10, cssW * 0.5, cssH * 0.5, Math.max(cssW, cssH) * 0.9);
      gr.addColorStop(0, "#3b3fb6"); gr.addColorStop(0.5, "#1b1d6b"); gr.addColorStop(1, "#0a0b2e");
      c.fillStyle = gr; c.fillRect(0, 0, cssW, cssH);
      c.strokeStyle = "rgba(56,217,255,.09)"; c.lineWidth = 2;
      for (let i = 1; i <= 4; i++) { c.beginPath(); c.arc(cssW / 2, cssH / 2, Math.min(cssW, cssH) * 0.16 * i, 0, TAU); c.stroke(); }
      c.fillStyle = "rgba(255,255,255,.06)"; const step = 34 * sc;
      for (let x = step / 2; x < cssW; x += step) for (let y = step / 2; y < cssH; y += step) c.fillRect(x - 1, y - 1, 2, 2);
      const planet = (x, y, r, col, ringed) => {
        c.save(); c.globalAlpha = 0.55; c.lineWidth = 4; c.strokeStyle = INK;
        c.fillStyle = col; c.beginPath(); c.arc(x, y, r, 0, TAU); c.fill(); c.stroke();
        c.fillStyle = "rgba(255,255,255,.25)"; c.beginPath(); c.arc(x - r * 0.3, y - r * 0.3, r * 0.3, 0, TAU); c.fill();
        if (ringed) { c.strokeStyle = "#ffd23f"; c.lineWidth = 5; c.beginPath(); c.ellipse(x, y, r * 1.7, r * 0.45, -0.35, 0, TAU); c.stroke(); }
        c.restore();
      };
      planet(cssW * 0.88, cssH * 0.82, 30 * sc, "#ff8a1f", true);
      planet(cssW * 0.1, cssH * 0.2, 16 * sc, "#ff6b81", false);
      stars = [];
      const n = Math.round(cssW * cssH / 2600);
      for (let i = 0; i < n; i++) stars.push({ x: Math.random() * cssW, y: Math.random() * cssH, r: rand(0.6, 1.8), p: Math.random() * TAU, s: rand(1, 3) });
      c.lineWidth = 8; c.strokeStyle = INK; rr(c, 4, 4, cssW - 8, cssH - 8, 18); c.stroke();
      c.lineWidth = 3; c.strokeStyle = "rgba(255,210,63,.75)"; c.setLineDash([14, 10]); rr(c, 4, 4, cssW - 8, cssH - 8, 18); c.stroke(); c.setLineDash([]);
    }

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
    let state = "menu", g = null, record = true, raf = 0, last = 0, menuT = 0;
    let best = parseInt(store.get("best", "0"), 10) || 0, bestWave = parseInt(store.get("bestWave", "0"), 10) || 0;

    function newRun(startWave) {
      g = {
        t: 0, score: 0, wave: startWave - 1, startWave, cleared: 0, kills: 0, combo: 0, comboT: 0, bestCombo: 0,
        p: { x: W / 2, y: H / 2, vx: 0, vy: 0, r: CFG.player.r, hp: CFG.player.hp, maxHp: CFG.player.hp, inv: 1, aim: -Math.PI / 2, fireT: 0, wheel: 0, dead: false, deadT: 0, recoil: 0 },
        power: { triple: 0, rapid: 0, shield: 0 },
        enemies: [], seeds: [], shots: [], pickups: [], parts: [], texts: [],
        queue: [], plan: wavePlan(Math.max(1, startWave)), spawnT: 0, interT: 0, waveActive: false, banner: null, shake: 0, boss: null, target: null, god: false, hurtT: 0
      };
    }
    const mult = () => Math.min(5, 1 + Math.floor(g.combo / 4));

    function startWave(n) {
      g.wave = n; g.plan = wavePlan(n); g.queue = g.plan.list.slice(); g.spawnT = 0.9; g.waveActive = true;
      if (g.plan.boss) { g.banner = { txt: T("hud.bossWave", "BOSS WAVE!"), sub: T("hud.bossName", "GIANT ROBO-CAT"), t: 2.4, max: 2.4, col: "#ff6b81" }; sfx.boss(); }
      else { g.banner = { txt: T("hud.wave", "WAVE") + " " + n, sub: n === 1 ? T("hud.ready", "GET READY!") : "", t: 1.8, max: 1.8, col: "#ffd23f" }; sfx.wave(); }
      if (n >= 2) dropPickup(null, rand(W * 0.2, W * 0.8), rand(H * 0.25, H * 0.75));
      emit("wave", { wave: n, boss: g.plan.boss });
    }

    function edgePoint(r) {
      const p = g.p; let bestP = null, bd = -1;
      for (let i = 0; i < 10; i++) {
        const side = Math.floor(Math.random() * 4), m = r + 14; let x, y;
        if (side === 0) { x = rand(0, W); y = -m; } else if (side === 1) { x = W + m; y = rand(0, H); }
        else if (side === 2) { x = rand(0, W); y = H + m; } else { x = -m; y = rand(0, H); }
        const d = hyp(x - p.x, y - p.y);
        if (d > Math.min(W, H) * 0.55) return [x, y];
        if (d > bd) { bd = d; bestP = [x, y]; }
      }
      return bestP;
    }
    function freePoint(margin, minDist) {
      let pt = [W / 2, H / 4];
      for (let i = 0; i < 30; i++) {
        const x = rand(margin, W - margin), y = rand(margin + 40, H - margin);
        if (hyp(x - g.p.x, y - g.p.y) < minDist) continue;
        if (g.enemies.some(e => e.type === "mine" && hyp(e.x - x, e.y - y) < 80)) continue;
        pt = [x, y]; break;
      }
      return pt;
    }

    function spawn(type, x, y) {
      const pl = g.plan || wavePlan(Math.max(1, g.wave)), hm = pl.hpMul;
      const e = { type, x: 0, y: 0, vx: 0, vy: 0, flash: 0, seed: Math.random() * 10, dead: false, inside: false };
      if (type === "cat") Object.assign(e, { r: 17, hp: Math.ceil(2 * hm), spd: pl.catSpeed * rand(0.9, 1.1), dmg: 10, score: 100 });
      else if (type === "vac") Object.assign(e, { r: 27, hp: Math.ceil(9 * hm), spd: pl.vacSpeed * rand(0.9, 1.1), dmg: 15, score: 250, suck: 0 });
      else if (type === "mine") Object.assign(e, { r: 19, hp: 1, dmg: 22, score: 50, st: "drop", stT: 0, rot: rand(-0.5, 0.5), inside: true });
      else if (type === "boss") {
        const k = Math.max(1, Math.round(g.wave / 5));
        Object.assign(e, { r: 62, hp: 90 + 50 * (k - 1), spd: 70, dmg: 20, score: 5000 * k, st: "enter", stT: 0, atkT: 1.2, atk: 0, orb: rand(0, TAU), phase2: false, dx: 0, dy: 0, k });
      } else return null;
      e.maxHp = e.hp;
      if (x == null) {
        if (type === "mine") [x, y] = freePoint(50, 170);
        else if (type === "boss") { x = W / 2; y = -e.r - 30; }
        else [x, y] = edgePoint(e.r);
      }
      e.x = x; e.y = y;
      g.enemies.push(e);
      if (type === "boss") g.boss = e;
      return e;
    }

    function dropPickup(type, x, y) {
      if (g.pickups.length >= 4) return;
      if (!type) {
        const w = { triple: 2, rapid: 2, shield: 1.4, heal: g.p.hp < g.p.maxHp * 0.5 ? 3 : 0.8 };
        let s = Math.random() * (w.triple + w.rapid + w.shield + w.heal);
        type = PW.find(k => (s -= w[k]) < 0) || "heal";
      }
      g.pickups.push({ type, x: clamp(x, 40, W - 40), y: clamp(y, 70, H - 40), t: 11, r: 15, ph: Math.random() * TAU });
    }
    function applyPower(type) {
      if (type === "heal") g.p.hp = Math.min(g.p.maxHp, g.p.hp + CFG.heal);
      else g.power[type] = CFG.power[type];
      const [k, en] = PW_NAME[type];
      floatText(g.p.x, g.p.y - 40, T(k, en), PW_COL[type], 20);
      burst(g.p.x, g.p.y, 16, [PW_COL[type], "#fff"], 220, 4, 0.5);
      ring(g.p.x, g.p.y, 60, PW_COL[type]);
      sfx.pickup(); emit("power", { type });
    }

    /* ---------- particles ---------- */
    function burst(x, y, n, cols, spd, size, life) {
      for (let i = 0; i < n && g.parts.length < 380; i++) {
        const a = rand(0, TAU), s = rand(0.3, 1) * spd;
        g.parts.push({ k: "dot", x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, r: rand(0.5, 1) * size, c: cols[i % cols.length], t: life * rand(0.6, 1), m: life });
      }
    }
    function puff(x, y, n, R) {
      for (let i = 0; i < n && g.parts.length < 380; i++) {
        const a = rand(0, TAU), s = rand(20, 90);
        g.parts.push({ k: "puff", x: x + Math.cos(a) * R * 0.3, y: y + Math.sin(a) * R * 0.3, vx: Math.cos(a) * s, vy: Math.sin(a) * s, r: rand(0.35, 0.6) * R, c: i % 3 ? "#ffb02e" : "#ff6b81", t: rand(0.35, 0.6), m: 0.6 });
      }
    }
    function ring(x, y, R, col) { if (g.parts.length < 380) g.parts.push({ k: "ring", x, y, vx: 0, vy: 0, r: R, c: col, t: 0.35, m: 0.35 }); }
    function floatText(x, y, s, col, size) { if (g.texts.length < 40) g.texts.push({ x, y, s, c: col, size, t: 0.9, m: 0.9 }); }

    /* ---------- damage ---------- */
    function hurtPlayer(dmg, fromX, fromY) {
      const p = g.p; if (p.dead) return;
      if (g.power.shield > 0) { if (p.inv <= 0) { sfx.block(); ring(p.x, p.y, p.r + 18, "#38d9ff"); p.inv = 0.25; } return; }
      if (p.inv > 0 || g.god) return;
      p.hp -= dmg; p.inv = CFG.player.inv; g.combo = 0; g.comboT = 0; g.shake = Math.max(g.shake, 7); g.hurtT = 0.35;
      const a = Math.atan2(p.y - fromY, p.x - fromX); p.vx += Math.cos(a) * 260; p.vy += Math.sin(a) * 260;
      floatText(p.x, p.y - 30, "-" + dmg, "#ff4d6d", 18); burst(p.x, p.y, 10, ["#fff", "#ff6b81"], 200, 3.5, 0.4);
      sfx.hurt();
      if (p.hp <= 0) {
        p.hp = 0; p.dead = true; p.deadT = 1.3; g.shake = 14;
        puff(p.x, p.y, 18, 40); burst(p.x, p.y, 30, ["#ffd23f", "#ff8a1f", "#fff", "#38d9ff"], 340, 5, 0.9); ring(p.x, p.y, 110, "#ffd23f");
        sfx.boom();
      }
    }
    function hitEnemy(e, dmg, ax, ay) {
      if (e.dead) return;
      if (e.type === "mine") { if (e.st !== "fuse") { e.st = "fuse"; e.stT = 0.08; e.shot = true; } return; }
      if (e.type === "boss" && e.st === "enter") { burst(e.x, e.y + e.r * 0.6, 3, ["#fff"], 150, 2, 0.2); return; }
      e.hp -= dmg; e.flash = e.type === "boss" ? 0.05 : 0.08;
      if (e.type === "cat") { e.vx += ax * 150; e.vy += ay * 150; } else if (e.type === "vac") { e.vx += ax * 30; e.vy += ay * 30; }
      sfx.hit();
      if (e.hp <= 0) killEnemy(e, true);
    }
    function killEnemy(e, byPlayer) {
      e.dead = true;
      if (byPlayer) {
        g.combo++; g.comboT = CFG.comboWindow; g.bestCombo = Math.max(g.bestCombo, g.combo); g.kills++;
        const m = mult(), pts = e.score * m; g.score += pts;
        floatText(e.x, e.y - e.r - 6, "+" + pts, m > 1 ? "#ffd23f" : "#fff", e.type === "boss" ? 30 : 16);
        if (g.combo >= 4 && g.combo % 4 === 0) floatText(e.x, e.y - e.r - 28, "×" + m + " " + T("hud.combo", "COMBO") + "!", "#ff8a1f", 18);
      }
      if (e.type === "boss") {
        g.boss = null; g.shots.length = 0; g.shake = 18;
        for (let i = 0; i < 4; i++) puff(e.x + rand(-40, 40), e.y + rand(-40, 40), 8, 60);
        burst(e.x, e.y, 50, ["#ffd23f", "#ff8a1f", "#fff", "#9aa6c8"], 420, 7, 1.1); ring(e.x, e.y, 200, "#ffd23f");
        g.banner = { txt: T("hud.bossDown", "ROBO-CAT DOWN!"), sub: "", t: 2, max: 2, col: "#5be37d" };
        dropPickup("heal", e.x - 30, e.y); dropPickup(null, e.x + 30, e.y);
        sfx.boom(); sfx.clear();
      } else if (e.type !== "mine") {
        puff(e.x, e.y, 6, e.r * 1.4); burst(e.x, e.y, 12, e.type === "cat" ? ["#ffa94d", "#fff", "#9aa6c8"] : ["#e7ecf6", "#4b5577", "#ff6b81"], 230, 3.5, 0.5);
        g.shake = Math.max(g.shake, e.type === "vac" ? 5 : 2.5); sfx.pop();
        const chance = e.type === "vac" ? 0.35 : 0.07;
        if (byPlayer && Math.random() < chance) dropPickup(null, e.x, e.y);
      }
    }
    function explodeMine(e) {
      killEnemy(e, !!e.shot);
      const R = CFG.mineBlast, p = g.p;
      puff(e.x, e.y, 14, 46); burst(e.x, e.y, 24, ["#ffd23f", "#ff8a1f", "#e0a96d", "#fff"], 320, 4.5, 0.6); ring(e.x, e.y, R, "#ff8a1f");
      g.shake = Math.max(g.shake, 9); sfx.boom();
      if (hyp(p.x - e.x, p.y - e.y) < R + p.r * 0.6) hurtPlayer(e.dmg, e.x, e.y);
      for (const o of g.enemies) {
        if (o === e || o.dead) continue;
        const d = hyp(o.x - e.x, o.y - e.y); if (d > R + o.r * 0.5) continue;
        if (o.type === "mine") { if (o.st !== "fuse") { o.st = "fuse"; o.stT = 0.18; o.shot = e.shot; } }
        else if (!(o.type === "boss" && o.st === "enter")) { o.hp -= o.type === "boss" ? 6 : 5; o.flash = 0.1; if (o.hp <= 0) killEnemy(o, true); }
      }
    }

    /* ---------- input ---------- */
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
        if (x < cssW * 0.5 && !input.move) input.move = st; else if (!input.aim) input.aim = st; else if (!input.move) input.move = st;
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
          if (s === input.move && d > R) { s.ox = x - dx / d * R; s.oy = y - dy / d * R; }   // floating stick follows the thumb
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
    function nearest() {
      const p = g.p; let bestE = null, bd = Infinity;
      for (const e of g.enemies) {
        if (e.dead || (e.type === "boss" && e.st === "enter")) continue;
        let d = (e.x - p.x) ** 2 + (e.y - p.y) ** 2;
        if (e.type === "mine") d *= 2.2;
        if (e.x < 0 || e.x > W || e.y < 0 || e.y > H) d *= 3;
        if (d < bd) { bd = d; bestE = e; }
      }
      return bestE;
    }
    const onScreen = e => e.x > -e.r * 0.5 && e.x < W + e.r * 0.5 && e.y > -e.r * 0.5 && e.y < H + e.r * 0.5;
    function clampInside(o, r) { o.x = clamp(o.x, pad + r, W - pad - r); o.y = clamp(o.y, pad + r, H - pad - r); }

    /* ---------- update ---------- */
    function update(dt) {
      g.t += dt;
      const p = g.p;
      for (const k in g.power) if (g.power[k] > 0) g.power[k] = Math.max(0, g.power[k] - dt);
      if (g.comboT > 0) { g.comboT -= dt; if (g.comboT <= 0) g.combo = 0; }
      g.shake = Math.max(0, g.shake - dt * 30); g.hurtT = Math.max(0, g.hurtT - dt);
      if (g.banner) { g.banner.t -= dt; if (g.banner.t <= 0) g.banner = null; }

      if (!p.dead) {
        p.inv = Math.max(0, p.inv - dt); p.recoil = Math.max(0, p.recoil - dt * 8);
        const [mx, my] = moveVec(), a = 1 - Math.exp(-12 * dt);
        p.vx += (mx * CFG.player.speed - p.vx) * a; p.vy += (my * CFG.player.speed - p.vy) * a;
        p.x += p.vx * dt; p.y += p.vy * dt; clampInside(p, p.r);
        p.wheel += hyp(p.vx, p.vy) * dt * 0.06 + dt * 2;
        // aim + fire
        g.target = null; let fire = false;
        const tgt = nearest();
        if (input.mode === "touch") {
          const s = input.aim, sd = s ? hyp(s.x - s.ox, s.y - s.oy) : 0;
          if (s && sd > CFG.stickR * 0.3) { p.aim = Math.atan2(s.y - s.oy, s.x - s.ox); fire = true; }
          else if (tgt && onScreen(tgt)) { g.target = tgt; p.aim = Math.atan2(tgt.y - p.y, tgt.x - p.x); fire = true; }
        } else {
          if (input.mouse.has) p.aim = Math.atan2(input.mouse.y / sc - p.y, input.mouse.x / sc - p.x);
          else if (tgt) { g.target = tgt; p.aim = Math.atan2(tgt.y - p.y, tgt.x - p.x); }
          fire = input.mouse.down || input.space;
        }
        const iv = g.power.rapid > 0 ? CFG.seed.rapid : CFG.seed.interval;
        if (fire) { p.fireT -= dt; let n = 0; while (p.fireT <= 0 && n++ < 3) { shoot(); p.fireT += iv; } }
        else p.fireT = Math.max(0, p.fireT - dt);
      } else {
        p.deadT -= dt;
        if (p.deadT <= 0) return gameOver();
      }

      // waves / spawning
      if (g.waveActive) {
        g.spawnT -= dt;
        if (g.queue.length && g.spawnT <= 0 && g.enemies.length < g.plan.maxAlive) {
          for (let i = 0; i < g.plan.group && g.queue.length && g.enemies.length < g.plan.maxAlive; i++) spawn(g.queue.shift());
          g.spawnT = g.plan.interval * rand(0.8, 1.2);
        }
        if (!g.queue.length && !g.enemies.length && !p.dead) {
          g.waveActive = false; g.cleared++; g.interT = 2.4;
          const bonus = 100 * g.wave; g.score += bonus;
          p.hp = Math.min(p.maxHp, p.hp + 8);
          g.banner = { txt: T("hud.clear", "WAVE CLEAR!"), sub: "+" + bonus, t: 2, max: 2, col: "#5be37d" };
          sfx.clear();
        }
      } else if (!p.dead) { g.interT -= dt; if (g.interT <= 0) startWave(g.wave + 1); }

      // enemies
      for (const e of g.enemies) {
        if (e.dead) continue;
        e.flash = Math.max(0, e.flash - dt);
        const dx = p.x - e.x, dy = p.y - e.y, d = hyp(dx, dy) || 1, nx = dx / d, ny = dy / d;
        if (e.type === "cat") {
          const w = Math.sin(g.t * 3 + e.seed) * 0.35, a = 1 - Math.exp(-2.6 * dt);
          const tx = p.dead ? -nx * e.spd * 0.5 : (nx - ny * w) * e.spd, ty = p.dead ? -ny * e.spd * 0.5 : (ny + nx * w) * e.spd;
          e.vx += (tx - e.vx) * a; e.vy += (ty - e.vy) * a;
        } else if (e.type === "vac") {
          const a = 1 - Math.exp(-1.5 * dt); e.vx += (nx * e.spd - e.vx) * a; e.vy += (ny * e.spd - e.vy) * a;
          e.suck = d < 190 && !p.dead ? 1 - d / 190 : 0;
          if (e.suck > 0 && g.power.shield <= 0) { p.x -= nx * 70 * e.suck * dt; p.y -= ny * 70 * e.suck * dt; clampInside(p, p.r); }
        } else if (e.type === "mine") {
          e.stT += dt;
          if (e.st === "drop" && e.stT > 0.6) { e.st = "armed"; e.stT = 0; puff(e.x, e.y + 8, 4, 18); }
          else if (e.st === "armed" && d < 78 && !p.dead) { e.st = "fuse"; e.stT = 0.7; }
          else if (e.st === "fuse") { e.stT -= 2 * dt; if (e.stT <= 0) explodeMine(e); }
        } else if (e.type === "boss") updateBoss(e, dt, nx, ny);
        if (e.type !== "mine") {
          e.x += e.vx * dt; e.y += e.vy * dt;
          if (!e.inside) { if (e.x > pad + e.r && e.x < W - pad - e.r && e.y > pad + e.r && e.y < H - pad - e.r) e.inside = true; }
          else if (e.type !== "boss" || e.st !== "charge") clampInside(e, e.r);
        }
        if (!p.dead && e.type !== "mine" && !e.dead && d < e.r + p.r * 0.85) {
          hurtPlayer(e.type === "boss" && e.st === "charge" ? 25 : e.dmg, e.x, e.y);
          if (e.type === "cat") { e.vx = -nx * 320; e.vy = -ny * 320; }
          else if (e.type === "vac") { e.vx = -nx * 120; e.vy = -ny * 120; }
          const push = e.r + p.r * 0.85 - d; p.x += nx * push; p.y += ny * push; clampInside(p, p.r);
        }
      }
      // separation (no stacking)
      const es = g.enemies;
      for (let i = 0; i < es.length; i++) {
        const a = es[i]; if (a.dead || a.type === "mine") continue;
        for (let j = i + 1; j < es.length; j++) {
          const b = es[j]; if (b.dead || b.type === "mine") continue;
          const dx = b.x - a.x, dy = b.y - a.y, md = a.r + b.r, d2 = dx * dx + dy * dy;
          if (d2 > 0.01 && d2 < md * md) {
            const d = Math.sqrt(d2), o = (md - d) / 2, ux = dx / d, uy = dy / d;
            const wa = a.type === "boss" ? 0.1 : b.type === "boss" ? 1.9 : 1;
            a.x -= ux * o * wa; a.y -= uy * o * wa; b.x += ux * o * (2 - wa); b.y += uy * o * (2 - wa);
          }
        }
      }
      // seeds
      for (const s of g.seeds) {
        s.x += s.vx * dt; s.y += s.vy * dt; s.life -= dt;
        if (s.life <= 0 || s.x < -20 || s.x > W + 20 || s.y < -20 || s.y > H + 20) { s.dead = true; continue; }
        for (const e of g.enemies) {
          if (e.dead) continue;
          const r2 = e.r + CFG.seed.r;
          if ((e.x - s.x) ** 2 + (e.y - s.y) ** 2 < r2 * r2) {
            s.dead = true; hitEnemy(e, CFG.seed.dmg, s.vx / CFG.seed.speed, s.vy / CFG.seed.speed);
            burst(s.x, s.y, 3, ["#f4ecd8", "#ffd23f"], 120, 2, 0.25); break;
          }
        }
      }
      // enemy shots (yarn balls)
      for (const s of g.shots) {
        s.x += s.vx * dt; s.y += s.vy * dt; s.life -= dt; s.rot += dt * 6;
        if (s.life <= 0 || s.x < -40 || s.x > W + 40 || s.y < -40 || s.y > H + 40) { s.dead = true; continue; }
        if (!p.dead && hyp(s.x - p.x, s.y - p.y) < s.r + p.r * 0.8) { s.dead = true; hurtPlayer(10, s.x, s.y); burst(s.x, s.y, 6, ["#ff6b81", "#fff"], 140, 3, 0.3); }
      }
      // pickups
      for (const u of g.pickups) {
        u.t -= dt; u.ph += dt * 3;
        if (u.t <= 0) { u.dead = true; continue; }
        const d = hyp(p.x - u.x, p.y - u.y);
        if (!p.dead && d < 80) { const s = Math.min(1, 300 * dt / Math.max(d, 1)); u.x += (p.x - u.x) * s; u.y += (p.y - u.y) * s; }
        if (!p.dead && d < p.r + u.r + 4) { u.dead = true; applyPower(u.type); }
      }
      for (const q of g.parts) { q.t -= dt; q.x += q.vx * dt; q.y += q.vy * dt; q.vx *= 1 - 3 * dt; q.vy *= 1 - 3 * dt; }
      for (const q of g.texts) { q.t -= dt; q.y -= 40 * dt; }
      g.enemies = g.enemies.filter(e => !e.dead); g.seeds = g.seeds.filter(s => !s.dead); g.shots = g.shots.filter(s => !s.dead);
      g.pickups = g.pickups.filter(u => !u.dead); g.parts = g.parts.filter(q => q.t > 0); g.texts = g.texts.filter(q => q.t > 0);
      if (g.target && g.target.dead) g.target = null;
    }

    function shoot() {
      const p = g.p, n = g.power.triple > 0 ? 3 : 1, nose = p.r + 12;
      for (let i = 0; i < n; i++) {
        const a = p.aim + (i - (n - 1) / 2) * CFG.seed.spread + rand(-0.03, 0.03);
        g.seeds.push({ x: p.x + Math.cos(p.aim) * nose, y: p.y + Math.sin(p.aim) * nose, vx: Math.cos(a) * CFG.seed.speed, vy: Math.sin(a) * CFG.seed.speed, a, life: CFG.seed.life });
      }
      p.recoil = 1; sfx.shoot();
    }
    function bossShot(e, a, spd) { g.shots.push({ x: e.x + Math.cos(a) * e.r, y: e.y + Math.sin(a) * e.r, vx: Math.cos(a) * spd, vy: Math.sin(a) * spd, r: 8, life: 7, rot: 0 }); }
    function updateBoss(e, dt, nx, ny) {
      const p = g.p;
      if (!e.phase2 && e.hp < e.maxHp * 0.5) { e.phase2 = true; g.banner = { txt: T("hud.angry", "ROBO-CAT IS ANGRY!"), sub: "", t: 1.6, max: 1.6, col: "#ff6b81" }; sfx.boss(); }
      const spd = e.phase2 ? 95 : 70;
      if (e.st === "enter") { e.vx = 0; e.vy = 90; if (e.y >= Math.min(H * 0.28, 160)) { e.st = "move"; e.vy = 0; e.inside = true; } return; }
      if (e.st === "move") {
        e.orb += dt * 0.45;
        const R = Math.min(W, H) * 0.36;
        const tx = clamp(p.x + Math.cos(e.orb) * R, e.r + pad, W - e.r - pad), ty = clamp(p.y + Math.sin(e.orb) * R * 0.7, e.r + pad, H - e.r - pad);
        const dx = tx - e.x, dy = ty - e.y, dd = hyp(dx, dy) || 1, a = 1 - Math.exp(-2 * dt), f = Math.min(1, dd / 60);
        e.vx += (dx / dd * spd * f - e.vx) * a; e.vy += (dy / dd * spd * f - e.vy) * a;
        e.atkT -= dt;
        if (e.atkT <= 0 && !p.dead) {
          const kind = e.atk++ % 4;
          if (kind === 0) { const n = e.phase2 ? 14 : 10, off = rand(0, TAU); for (let i = 0; i < n; i++) bossShot(e, off + i / n * TAU, e.phase2 ? 170 : 150); sfx.enemyShot(); }
          else if (kind === 1) { const n = e.phase2 ? 5 : 3, a0 = Math.atan2(ny, nx); for (let i = 0; i < n; i++) bossShot(e, a0 + (i - (n - 1) / 2) * 0.24, 230); sfx.enemyShot(); }
          else if (kind === 2) {
            const cats = g.enemies.filter(o => o.type === "cat" && !o.dead).length;
            for (let i = 0; i < 2 && cats + i < 6; i++) { const c = spawn("cat", e.x + (i ? 40 : -40), e.y + 30); c.inside = false; }
            floatText(e.x, e.y - e.r - 20, T("hud.meow", "MEOW!"), "#ffa94d", 22);
          } else { e.st = "windup"; e.stT = 0.75; }
          e.atkT = e.phase2 ? 1.6 : 2.3;
        }
      } else if (e.st === "windup") {
        e.vx *= 1 - 6 * dt; e.vy *= 1 - 6 * dt; e.stT -= dt;
        if (e.stT <= 0) { e.st = "charge"; e.stT = 0.6; e.dx = nx; e.dy = ny; sfx.boss(); }
      } else if (e.st === "charge") {
        e.vx = e.dx * 480; e.vy = e.dy * 480; e.stT -= dt;
        if (g.parts.length < 380) g.parts.push({ k: "puff", x: e.x - e.dx * e.r, y: e.y - e.dy * e.r, vx: 0, vy: 0, r: 18, c: "#9aa6c8", t: 0.3, m: 0.3 });
        const hitWall = e.x < pad + e.r || e.x > W - pad - e.r || e.y < pad + e.r || e.y > H - pad - e.r;
        if (e.stT <= 0 || hitWall) { clampInside(e, e.r); if (hitWall) { g.shake = Math.max(g.shake, 8); sfx.boom(); } e.st = "move"; e.vx *= 0.2; e.vy *= 0.2; }
      }
    }

    function gameOver() {
      state = "over";
      const survived = Math.max(0, g.startWave - 1 + g.cleared);
      let newBest = false;
      if (record) {
        if (g.score > best) { best = g.score; newBest = g.score > 0; store.set("best", best); }
        if (survived > bestWave) { bestWave = survived; store.set("bestWave", bestWave); }
      }
      sfx.over(); clearInput();
      emit("state", { state });
      emit("gameover", { score: g.score, wave: g.wave, survived, kills: g.kills, bestCombo: g.bestCombo, best, bestWave, newBest, recorded: record });
    }

    /* ---------- render ---------- */
    function render() {
      const c = ctx, now = performance.now() / 1000;
      c.setTransform(1, 0, 0, 1, 0, 0);
      if (bg) c.drawImage(bg, 0, 0); else { c.fillStyle = "#12134d"; c.fillRect(0, 0, canvas.width, canvas.height); }
      c.setTransform(dpr, 0, 0, dpr, 0, 0);
      c.fillStyle = "#fff";
      for (const s of stars) { c.globalAlpha = 0.35 + 0.35 * Math.sin(now * s.s + s.p); c.fillRect(s.x, s.y, s.r, s.r); }
      c.globalAlpha = 1;
      const sh = g && state === "play" ? g.shake : 0, ox = sh ? rand(-sh, sh) : 0, oy = sh ? rand(-sh, sh) : 0;
      c.setTransform(dpr * sc, 0, 0, dpr * sc, ox * dpr, oy * dpr);
      if (!g) {   // menu backdrop: idle hamster
        menuT += 1 / 60;
        const fake = { x: W / 2, y: H * 0.62 + Math.sin(menuT * 2) * 8, vx: 0, vy: 160, r: CFG.player.r * 1.6, aim: -Math.PI / 2 + Math.sin(menuT) * 0.3, wheel: menuT * 3, inv: 0, recoil: 0 };
        drawPlayer(c, fake, now, {});
        return;
      }
      const p = g.p;
      for (const e of g.enemies) if (e.type === "mine") drawMine(c, e, now);
      for (const u of g.pickups) drawPickup(c, u, now);
      for (const e of g.enemies) if (e.type === "vac") drawVac(c, e, now, p);
      for (const e of g.enemies) if (e.type === "cat") drawCat(c, e, now, p);
      if (g.boss) drawBoss(c, g.boss, now, p);
      if (g.target && input.mode === "touch" && state === "play") {
        const e = g.target; c.save(); c.strokeStyle = "rgba(255,210,63,.85)"; c.lineWidth = 2.5; c.setLineDash([6, 6]); c.lineDashOffset = -now * 30;
        c.beginPath(); c.arc(e.x, e.y, e.r + 8, 0, TAU); c.stroke(); c.restore();
      }
      for (const s of g.seeds) drawSeed(c, s);
      for (const s of g.shots) drawYarn(c, s);
      if (!p.dead) drawPlayer(c, p, now, g.power);
      for (const q of g.parts) {
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

    function drawPlayer(c, p, t, pw) {
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
      c.lineWidth = 40 * S; c.strokeStyle = pw.rapid > 0 ? "#ff8a1f" : pw.triple > 0 ? "#ffd23f" : "#38d9ff"; c.beginPath(); c.arc(0, 0, 262 * S, 0, TAU); c.stroke();
      c.globalAlpha = 1;
      if (pw.shield > 0 && (pw.shield > 2 || Math.floor(t * 8) % 2 === 0)) {
        const pulse = 0.6 + 0.3 * Math.sin(t * 8);
        c.fillStyle = `rgba(56,217,255,${0.12 + 0.08 * pulse})`; c.strokeStyle = `rgba(150,235,255,${pulse})`; c.lineWidth = 3;
        c.beginPath(); c.arc(0, 0, R + 14, 0, TAU); c.fill(); c.stroke();
      }
      c.restore();
    }
    function drawSeed(c, s) {
      c.save(); c.translate(s.x, s.y); c.rotate(s.a); c.scale(1.3, 1.3);
      c.fillStyle = "rgba(255,210,63,.45)"; c.beginPath(); c.ellipse(-10, 0, 12, 3, 0, 0, TAU); c.fill();
      c.fillStyle = "#f4ecd8"; c.strokeStyle = INK; c.lineWidth = 1.6;
      c.beginPath(); c.ellipse(0, 0, 7, 3.8, 0, 0, TAU); c.fill(); c.stroke();
      c.strokeStyle = "#3a3150"; c.lineWidth = 1.1; c.beginPath(); c.moveTo(-4.5, -1.3); c.lineTo(4.5, -1.3); c.moveTo(-4.5, 1.3); c.lineTo(4.5, 1.3); c.stroke();
      c.restore();
    }
    function drawYarn(c, s) {
      c.save(); c.translate(s.x, s.y); c.rotate(s.rot);
      c.fillStyle = "rgba(255,107,129,.25)"; c.beginPath(); c.arc(0, 0, s.r + 5, 0, TAU); c.fill();
      c.fillStyle = "#ff6b81"; c.strokeStyle = INK; c.lineWidth = 2.5; c.beginPath(); c.arc(0, 0, s.r, 0, TAU); c.fill(); c.stroke();
      c.strokeStyle = "#ffd1da"; c.lineWidth = 1.5; c.beginPath(); c.arc(-3, -2, s.r * 0.7, -0.6, 1.4); c.stroke(); c.beginPath(); c.arc(3, 2, s.r * 0.6, 2.4, 4.2); c.stroke();
      c.restore();
    }
    function flashOver(c, e, r) { if (e.flash > 0) { c.globalAlpha = e.type === "boss" ? 0.28 : 0.6; c.fillStyle = "#fff"; c.beginPath(); c.arc(0, 0, r, 0, TAU); c.fill(); c.globalAlpha = 1; } }
    function drawCat(c, e, t, p) {
      const r = e.r; c.save(); c.translate(e.x, e.y + Math.sin(t * 7 + e.seed) * 1.5);
      c.lineJoin = "round"; c.lineCap = "round"; c.strokeStyle = INK;
      c.fillStyle = "rgba(0,0,0,.22)"; c.beginPath(); c.ellipse(0, r * 1.2, r * 0.8, r * 0.25, 0, 0, TAU); c.fill();
      c.lineWidth = 2.5; c.beginPath(); c.moveTo(0, -r * 0.85); c.lineTo(0, -r * 1.35); c.stroke();
      const pw = r * 1.25 * Math.abs(Math.cos(t * 28 + e.seed)) + 2;
      c.fillStyle = "#c9d2ea"; c.beginPath(); c.ellipse(0, -r * 1.4, pw, 2.6, 0, 0, TAU); c.fill(); c.stroke();
      c.fillStyle = "#ffa94d"; c.lineWidth = 3;
      for (const s of [-1, 1]) { c.beginPath(); c.moveTo(s * r * 0.95, -r * 0.25); c.lineTo(s * r * 0.82, -r * 1.12); c.lineTo(s * r * 0.2, -r * 0.82); c.closePath(); c.fill(); c.stroke(); }
      c.fillStyle = "#ff9fb2"; for (const s of [-1, 1]) { c.beginPath(); c.moveTo(s * r * 0.78, -r * 0.45); c.lineTo(s * r * 0.75, -r * 0.92); c.lineTo(s * r * 0.4, -r * 0.72); c.closePath(); c.fill(); }
      c.fillStyle = "#ffa94d"; c.beginPath(); c.arc(0, 0, r, 0, TAU); c.fill(); c.stroke();
      c.strokeStyle = "#d9731a"; c.lineWidth = 2.2;
      for (const x of [-0.3, 0, 0.3]) { c.beginPath(); c.moveTo(x * r, -r * 0.95); c.lineTo(x * r * 0.8, -r * 0.62); c.stroke(); }
      const dx = p.x - e.x, dy = p.y - e.y, d = hyp(dx, dy) || 1, lx = dx / d * 2.2, ly = dy / d * 2.2;
      c.strokeStyle = INK; c.lineWidth = 1.8; c.fillStyle = "#fff";
      for (const s of [-1, 1]) { c.beginPath(); c.ellipse(s * r * 0.38, -r * 0.08, r * 0.26, r * 0.3, 0, 0, TAU); c.fill(); c.stroke(); }
      c.fillStyle = INK; for (const s of [-1, 1]) { c.beginPath(); c.arc(s * r * 0.38 + lx, -r * 0.06 + ly, r * 0.13, 0, TAU); c.fill(); }
      c.lineWidth = 2.6; for (const s of [-1, 1]) { c.beginPath(); c.moveTo(s * r * 0.66, -r * 0.5); c.lineTo(s * r * 0.14, -r * 0.33); c.stroke(); }
      c.fillStyle = "#ff6b81"; c.beginPath(); c.moveTo(-r * 0.12, r * 0.24); c.lineTo(r * 0.12, r * 0.24); c.lineTo(0, r * 0.38); c.closePath(); c.fill();
      c.lineWidth = 1.6; c.beginPath(); c.moveTo(-r * 0.22, r * 0.5); c.quadraticCurveTo(-r * 0.1, r * 0.6, 0, r * 0.42); c.quadraticCurveTo(r * 0.1, r * 0.6, r * 0.22, r * 0.5); c.stroke();
      c.lineWidth = 1.3; for (const s of [-1, 1]) { c.beginPath(); c.moveTo(s * r * 0.45, r * 0.32); c.lineTo(s * r * 1.2, r * 0.18); c.moveTo(s * r * 0.45, r * 0.42); c.lineTo(s * r * 1.15, r * 0.5); c.stroke(); }
      flashOver(c, e, r);
      c.restore();
    }
    function drawVac(c, e, t, p) {
      const r = e.r, ang = Math.atan2(p.y - e.y, p.x - e.x);
      c.save(); c.translate(e.x, e.y); c.lineJoin = "round";
      if (e.suck > 0) {
        for (let i = 0; i < 3; i++) {
          const ph = (t * 1.4 + i / 3) % 1, dist = r + 12 + (1 - ph) * 130;
          c.strokeStyle = `rgba(190,240,255,${0.45 * ph * Math.min(1, e.suck * 3)})`; c.lineWidth = 3;
          c.beginPath(); c.arc(0, 0, dist, ang - 0.32, ang + 0.32); c.stroke();
        }
      }
      c.fillStyle = "rgba(0,0,0,.25)"; c.beginPath(); c.ellipse(0, r * 0.3, r * 1.05, r * 0.9, 0, 0, TAU); c.fill();
      c.save(); c.rotate(ang);
      c.strokeStyle = INK; c.lineWidth = 3; c.fillStyle = "#4b5577"; rr(c, r * 0.65, -r * 0.34, r * 0.6, r * 0.68, 5); c.fill(); c.stroke();
      c.fillStyle = INK; rr(c, r * 1.12, -r * 0.24, r * 0.14, r * 0.48, 3); c.fill();
      c.fillStyle = "#e7ecf6"; c.lineWidth = 3.5; c.beginPath(); c.arc(0, 0, r, 0, TAU); c.fill(); c.stroke();
      c.fillStyle = "#b9c3da"; c.lineWidth = 2; c.beginPath(); c.arc(0, 0, r * 0.68, 0, TAU); c.fill(); c.stroke();
      c.strokeStyle = "#3a4166"; c.lineWidth = 5; c.beginPath(); c.arc(0, 0, r * 0.86, -1.05, 1.05); c.stroke();
      c.strokeStyle = INK; c.lineWidth = 1.6; c.fillStyle = "#fff";
      for (const s of [-1, 1]) { c.beginPath(); c.arc(r * 0.38, s * r * 0.28, r * 0.17, 0, TAU); c.fill(); c.stroke(); }
      c.fillStyle = "#ff3d5a"; for (const s of [-1, 1]) { c.beginPath(); c.arc(r * 0.44, s * r * 0.26, r * 0.08, 0, TAU); c.fill(); }
      c.lineWidth = 2.4; c.strokeStyle = INK; for (const s of [-1, 1]) { c.beginPath(); c.moveTo(r * 0.16, s * r * 0.5); c.lineTo(r * 0.5, s * r * 0.16); c.stroke(); }
      c.restore();
      const pulse = 0.5 + 0.5 * Math.sin(t * 6 + e.seed);
      c.fillStyle = `rgb(255,${Math.round(80 + 60 * pulse)},${Math.round(100 + 40 * pulse)})`; c.strokeStyle = INK; c.lineWidth = 2;
      c.beginPath(); c.arc(-r * 0.12, 0, r * 0.22, 0, TAU); c.fill(); c.stroke();
      flashOver(c, e, r);
      c.restore();
      if (e.hp < e.maxHp) hpBar(c, e.x, e.y - r - 12, r * 1.6, e.hp / e.maxHp);
    }
    function drawMine(c, e, t) {
      const r = e.r; c.save(); c.translate(e.x, e.y);
      let s = 1, a = 1;
      if (e.st === "drop") { const k = clamp(e.stT / 0.6, 0, 1); s = 1.8 - 0.8 * k; a = k; }
      if (e.st === "fuse") {
        s = 1 + 0.12 * Math.sin(t * 40);
        c.fillStyle = "rgba(255,77,109,.12)"; c.strokeStyle = "rgba(255,77,109,.75)"; c.lineWidth = 2.5; c.setLineDash([8, 6]);
        c.beginPath(); c.arc(0, 0, CFG.mineBlast, 0, TAU); c.fill(); c.stroke(); c.setLineDash([]);
      }
      c.globalAlpha = a; c.fillStyle = "rgba(0,0,0,.25)"; c.beginPath(); c.ellipse(0, r * 0.75, r * 1.1, r * 0.35, 0, 0, TAU); c.fill();
      c.rotate(e.rot); c.scale(s, s); c.lineJoin = "round"; c.strokeStyle = INK;
      const w = r * 2.1, h = r * 1.45;
      c.fillStyle = "#e0a96d"; rr(c, -w / 2, -h / 2, w, h, 4); c.fill(); c.lineWidth = 3; c.stroke();
      c.strokeStyle = "#b97a43"; c.lineWidth = 1.4; c.beginPath(); c.moveTo(-w * 0.42, -h * 0.18); c.quadraticCurveTo(0, -h * 0.3, w * 0.42, -h * 0.15); c.moveTo(-w * 0.4, h * 0.22); c.quadraticCurveTo(0, h * 0.1, w * 0.4, h * 0.25); c.stroke();
      c.strokeStyle = INK; c.lineWidth = 5; rr(c, -w * 0.4, -h * 0.34, w * 0.52, h * 0.68, 3); c.stroke();
      c.strokeStyle = "#dfe6f2"; c.lineWidth = 2.4; rr(c, -w * 0.4, -h * 0.34, w * 0.52, h * 0.68, 3); c.stroke();
      c.fillStyle = "#ffd23f"; c.strokeStyle = INK; c.lineWidth = 2; c.beginPath(); c.moveTo(w * 0.18, h * 0.28); c.lineTo(w * 0.44, h * 0.28); c.lineTo(w * 0.44, -h * 0.1); c.closePath(); c.fill(); c.stroke();
      c.fillStyle = "#e0b020"; c.beginPath(); c.arc(w * 0.36, h * 0.16, 1.8, 0, TAU); c.fill();
      const on = e.st === "fuse" ? Math.floor(t * 12) % 2 === 0 : e.st === "armed" ? Math.floor(t * 1.6 + e.seed) % 2 === 0 : false;
      c.fillStyle = on ? "#ff3d5a" : "#7a2a3a"; c.lineWidth = 1.6; c.beginPath(); c.arc(-w * 0.14, 0, 3.6, 0, TAU); c.fill(); c.stroke();
      if (on) { c.fillStyle = "rgba(255,61,90,.35)"; c.beginPath(); c.arc(-w * 0.14, 0, 8, 0, TAU); c.fill(); }
      c.restore();
    }
    function drawBoss(c, e, t, p) {
      const r = e.r, shk = e.st === "windup" ? 2.5 : 0;
      c.save(); c.translate(e.x + rand(-shk, shk), e.y + rand(-shk, shk)); c.lineJoin = "round"; c.lineCap = "round"; c.strokeStyle = INK;
      c.fillStyle = "rgba(0,0,0,.25)"; c.beginPath(); c.ellipse(0, r * 1.1, r * 0.9, r * 0.25, 0, 0, TAU); c.fill();
      c.lineWidth = 4; c.beginPath(); c.moveTo(0, -r * 0.9); c.lineTo(0, -r * 1.32); c.stroke();
      c.fillStyle = Math.floor(t * 3) % 2 ? "#ff3d5a" : "#ffd23f"; c.beginPath(); c.arc(0, -r * 1.38, 7, 0, TAU); c.fill(); c.stroke();
      c.lineWidth = 5;
      for (const s of [-1, 1]) {
        c.fillStyle = "#9aa6c8"; c.beginPath(); c.moveTo(s * r * 0.97, -r * 0.15); c.lineTo(s * r * 0.86, -r * 1.15); c.lineTo(s * r * 0.18, -r * 0.84); c.closePath(); c.fill(); c.stroke();
        c.fillStyle = "#ff6b81"; c.beginPath(); c.moveTo(s * r * 0.8, -r * 0.4); c.lineTo(s * r * 0.77, -r * 0.92); c.lineTo(s * r * 0.4, -r * 0.75); c.closePath(); c.fill();
      }
      c.fillStyle = "#b8c2da"; c.lineWidth = 6; c.beginPath(); c.arc(0, 0, r, 0, TAU); c.fill(); c.stroke();
      c.fillStyle = "rgba(255,255,255,.35)"; c.beginPath(); c.ellipse(-r * 0.35, -r * 0.6, r * 0.35, r * 0.14, -0.4, 0, TAU); c.fill();
      c.strokeStyle = "#8c98ab"; c.lineWidth = 2.5; c.beginPath(); c.arc(0, r * 0.1, r * 0.82, Math.PI * 1.15, Math.PI * 1.85); c.stroke();
      c.fillStyle = "#6c7699"; for (const [x, y] of [[-0.72, 0.38], [0.72, 0.38], [-0.45, -0.7], [0.45, -0.7]]) { c.beginPath(); c.arc(x * r, y * r, 3.5, 0, TAU); c.fill(); }
      c.strokeStyle = INK; c.lineWidth = 4; c.fillStyle = "#262a86"; rr(c, -r * 0.74, -r * 0.4, r * 1.48, r * 0.52, r * 0.24); c.fill(); c.stroke();
      const dx = p.x - e.x, dy = p.y - e.y, d = hyp(dx, dy) || 1, lx = dx / d * 5, ly = dy / d * 3;
      const angry = e.st === "windup" || e.st === "charge", eye = angry ? "#ffd23f" : "#ff3d5a";
      c.fillStyle = eye; c.shadowColor = eye; c.shadowBlur = 14;
      for (const s of [-1, 1]) { c.beginPath(); c.ellipse(s * r * 0.36 + lx, -r * 0.14 + ly, r * 0.16, angry ? r * 0.07 : r * 0.12, 0, 0, TAU); c.fill(); }
      c.shadowBlur = 0;
      c.lineWidth = 5; for (const s of [-1, 1]) { c.beginPath(); c.moveTo(s * r * 0.62, -r * 0.5); c.lineTo(s * r * 0.15, -r * 0.36); c.stroke(); }
      c.fillStyle = "#3a4166"; c.lineWidth = 4; rr(c, -r * 0.42, r * 0.26, r * 0.84, r * 0.36, 8); c.fill(); c.stroke();
      c.fillStyle = "#fff";
      for (let i = 0; i < 5; i++) { const x = -r * 0.34 + i * r * 0.136; c.beginPath(); c.moveTo(x, r * 0.28); c.lineTo(x + r * 0.068, r * 0.42); c.lineTo(x + r * 0.136, r * 0.28); c.closePath(); c.fill(); }
      const whisk = () => { for (const s of [-1, 1]) { c.beginPath(); c.moveTo(s * r * 0.55, r * 0.3); c.lineTo(s * r * 1.3, r * 0.15); c.moveTo(s * r * 0.55, r * 0.45); c.lineTo(s * r * 1.25, r * 0.55); c.stroke(); } };
      c.strokeStyle = INK; c.lineWidth = 5; whisk(); c.strokeStyle = "#dfe6f2"; c.lineWidth = 2.5; whisk();
      if (e.phase2) {
        c.strokeStyle = INK; c.lineWidth = 2.5; c.beginPath(); c.moveTo(r * 0.3, -r * 0.95); c.lineTo(r * 0.2, -r * 0.7); c.lineTo(r * 0.35, -r * 0.55); c.moveTo(-r * 0.8, r * 0.2); c.lineTo(-r * 0.6, r * 0.32); c.stroke();
        if (state === "play" && Math.random() < 0.15 && g.parts.length < 380) g.parts.push({ k: "puff", x: e.x + rand(-r, r) * 0.6, y: e.y - r * 0.6, vx: rand(-10, 10), vy: -50, r: 10, c: "rgba(80,80,110,.7)", t: 0.6, m: 0.6 });
      }
      flashOver(c, e, r);
      c.restore();
    }
    function drawPickup(c, u, t) {
      const bob = Math.sin(u.ph) * 3;
      if (u.t < 3 && Math.floor(t * 8) % 2 === 0) return;
      c.save(); c.globalAlpha = 0.5 + 0.3 * Math.sin(u.ph * 1.5); c.strokeStyle = PW_COL[u.type]; c.lineWidth = 3;
      c.beginPath(); c.arc(u.x, u.y + bob, u.r + 6 + Math.sin(u.ph * 1.5) * 2, 0, TAU); c.stroke(); c.restore();
      powerIcon(c, u.type, u.x, u.y + bob, u.r);
    }

    function drawHud(c, t) {
      const p = g.p, L = 14, T0 = 12, narrow = cssW < 520;
      if (g.hurtT > 0 || (p.hp < p.maxHp * 0.3 && !p.dead)) {
        const a = g.hurtT > 0 ? g.hurtT * 1.2 : 0.18 + 0.12 * Math.sin(t * 6);
        const gr = c.createRadialGradient(cssW / 2, cssH / 2, Math.min(cssW, cssH) * 0.35, cssW / 2, cssH / 2, Math.max(cssW, cssH) * 0.75);
        gr.addColorStop(0, "rgba(255,40,70,0)"); gr.addColorStop(1, `rgba(255,40,70,${clamp(a, 0, 0.5)})`); c.fillStyle = gr; c.fillRect(0, 0, cssW, cssH);
      }
      text(c, String(g.score), L, T0, narrow ? 24 : 28, "#fff");
      text(c, T("hud.best", "BEST") + " " + Math.max(best, record ? g.score : 0), L, T0 + (narrow ? 28 : 32), 12, "#ffd23f");
      const by = T0 + (narrow ? 46 : 52), bw = Math.min(150, cssW * 0.34), bh = 14, bx = L + 22;
      c.fillStyle = "rgba(0,0,0,.5)"; rr(c, bx, by, bw, bh, 7); c.fill();
      const f = p.hp / p.maxHp; c.fillStyle = f > 0.5 ? "#5be37d" : f > 0.25 ? "#ffd23f" : "#ff4d6d";
      if (f > 0) { rr(c, bx, by, Math.max(bh, bw * f), bh, 7); c.fill(); }
      c.lineWidth = 3; c.strokeStyle = g.power.shield > 0 ? "#38d9ff" : INK; rr(c, bx, by, bw, bh, 7); c.stroke();
      powerIcon(c, "heal", L + 9, by + bh / 2, 10);
      let px = L + 12;
      for (const k of ["triple", "rapid", "shield"]) {
        const v = g.power[k]; if (v <= 0) continue;
        const y = by + 34; powerIcon(c, k, px, y, 12);
        c.strokeStyle = "#fff"; c.lineWidth = 3; c.beginPath(); c.arc(px, y, 16, -Math.PI / 2, -Math.PI / 2 + TAU * v / CFG.power[k]); c.stroke();
        px += 38;
      }
      text(c, T("hud.wave", "WAVE") + " " + g.wave, cssW / 2, T0, narrow ? 20 : 24, "#fff", "center");
      if (g.boss && !g.boss.dead) {
        const w = Math.min(260, cssW * 0.46), x = cssW / 2 - w / 2, y = T0 + 30, e = g.boss;
        c.fillStyle = "rgba(0,0,0,.55)"; rr(c, x, y, w, 12, 6); c.fill();
        c.fillStyle = e.phase2 ? "#ff4d6d" : "#ff8a1f"; rr(c, x, y, Math.max(12, w * e.hp / e.maxHp), 12, 6); c.fill();
        c.lineWidth = 3; c.strokeStyle = INK; rr(c, x, y, w, 12, 6); c.stroke();
        text(c, T("hud.boss", "ROBO-CAT"), cssW / 2, y + 15, 11, "#ff9fb2", "center");
      } else if (g.waveActive) {
        text(c, (g.enemies.length + g.queue.length) + " " + T("hud.left", "LEFT"), cssW / 2, T0 + (narrow ? 26 : 30), 12, "#38d9ff", "center");
      }
      if (g.combo >= 2) {
        const y = T0 + (narrow ? 86 : 60), s = 1 + Math.max(0, g.comboT - (CFG.comboWindow - 0.15)) * 3;
        text(c, g.combo + " " + T("hud.combo", "COMBO") + "  ×" + mult(), cssW / 2, y, 17 * s, "#ffd23f", "center");
        const w = 90; c.fillStyle = "rgba(0,0,0,.5)"; rr(c, cssW / 2 - w / 2, y + 22, w, 5, 2.5); c.fill();
        c.fillStyle = "#ffd23f"; rr(c, cssW / 2 - w / 2, y + 22, w * clamp(g.comboT / CFG.comboWindow, 0, 1), 5, 2.5); c.fill();
      }
      if (g.banner) {
        const b = g.banner, k = 1 - b.t / b.max, s = k < 0.15 ? 0.6 + k / 0.15 * 0.4 : 1, a = b.t < 0.4 ? b.t / 0.4 : 1;
        c.save(); c.globalAlpha = a; c.translate(cssW / 2, cssH * 0.36); c.scale(s, s);
        text(c, b.txt, 0, 0, Math.min(48, cssW / (b.txt.length * 0.62 + 1)), b.col, "center", "middle");
        if (b.sub) text(c, b.sub, 0, 36, 18, "#fff", "center", "middle");
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
            c.save(); c.globalAlpha = g.wave <= g.startWave && g.t < 10 ? 0.45 : 0.18;
            c.strokeStyle = "#fff"; c.lineWidth = 3; c.setLineDash([6, 6]); c.beginPath(); c.arc(hx, hy, R, 0, TAU); c.stroke(); c.setLineDash([]);
            c.fillStyle = col; c.beginPath(); c.arc(hx, hy, 18, 0, TAU); c.fill();
            text(c, label, hx, hy + R + 8, 12, "#fff", "center"); c.restore();
          }
        };
        const hy = cssH - CFG.stickR - 34;
        stick(input.move, CFG.stickR + 20, hy, T("hud.move", "MOVE"), "rgba(255,210,63,.9)");
        stick(input.aim, cssW - CFG.stickR - 20, hy, T("hud.aim", "AIM (AUTO)"), "rgba(56,217,255,.9)");
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
    function start(wave = 1, o = {}) {
      sfx.ensure(); clearInput();
      record = o.record !== false;
      newRun(clamp(Math.floor(wave) || 1, 1, 99));
      state = "play"; last = 0;
      startWave(g.startWave);
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
      start, pause, resume, setMuted, toggleMute, destroy,
      get state() { return state; }, get muted() { return sfx.muted; },
      best: () => ({ score: best, waves: bestWave }),
      // test/debug helpers (only do something when called)
      debug: {
        info: () => g && {
          state, wave: g.wave, score: g.score, hp: g.p.hp, kills: g.kills, combo: g.combo, cleared: g.cleared, seeds: g.seeds.length, shots: g.shots.length,
          pickups: g.pickups.map(u => u.type), power: Object.assign({}, g.power), boss: g.boss ? { hp: g.boss.hp, maxHp: g.boss.maxHp, st: g.boss.st } : null,
          enemies: g.enemies.reduce((m, e) => (m[e.type] = (m[e.type] || 0) + 1, m), {}), queue: g.queue.length,
          player: { x: g.p.x, y: g.p.y, aim: g.p.aim }, world: { W, H, sc }, mode: input.mode,
          list: g.enemies.map(e => ({ type: e.type, x: Math.round(e.x), y: Math.round(e.y), r: e.r, st: e.st || "" }))
        },
        give: type => { if (g) applyPower(type); },
        drop: (type, dx = 70, dy = 0) => { if (g) dropPickup(type, g.p.x + dx, g.p.y + dy); },
        spawn: (type, x, y) => !!(g && spawn(type, x, y)),
        setHp: v => { if (g) g.p.hp = v; },
        clearPowers: () => { if (g) for (const k in g.power) g.power[k] = 0; },
        god: on => { if (g) g.god = !!on; },
        hurt: dmg => { if (g) { g.p.inv = 0; hurtPlayer(dmg, g.p.x, g.p.y - 1); } },
        toScreen: (x, y) => [x * sc, y * sc]
      }
    };
  }

  global.HamsterArena = { create, wavePlan, version: "0.1.0-test" };
})(window);
