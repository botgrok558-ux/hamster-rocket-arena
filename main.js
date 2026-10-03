/* UI glue for the Hamster Rocket Arena test site: overlays, level-up cards, language, share. The game itself is in arena.js. */
(() => {
  "use strict";
  const $ = id => document.getElementById(id);
  const T = (k, en) => (window.HRI18N ? HRI18N.t(k, en) : en);
  const SITE = "https://botgrok558-ux.github.io/hamster-rocket-arena/";
  const params = new URLSearchParams(location.search);
  const t0 = Math.min(3600, Math.max(0, parseInt(params.get("t"), 10) || 0));   // ?t=SECONDS starts with the difficulty of that minute
  const bossNow = params.get("boss") === "1";                                    // ?boss=1 spawns the robo-cat right away
  const debugRun = t0 > 0 || bossNow;                                            // debug runs never touch the best score
  let lastResult = null, cardTimer = 0;

  const UP = {
    damage: ["💥", "Seed damage", "+25% damage"], rate: ["⚡", "Fire rate", "Shoot 15% faster"], multi: ["🌻", "Multishot", "+1 seed per shot"],
    speed: ["💨", "Move speed", "Fly 10% faster"], hp: ["❤️", "Max health", "+20 max HP, heal 20"], pierce: ["🎯", "Pierce", "Seeds go through +1 enemy"]
  };
  const overlays = ["ov-start", "ov-pause", "ov-level", "ov-over"];
  const show = id => overlays.forEach(o => $(o).classList.toggle("hidden", o !== id));

  const game = HamsterArena.create({ canvas: $("arena"), assetBase: "assets/", t: T, storagePrefix: "hra_", onEvent });
  window.HR_ARENA = game;   // handy for testing from the console
  const fmt = game.fmt;

  function onEvent(type, d) {
    if (type === "state") {
      $("btn-pause").classList.toggle("hidden", d.state !== "play");
      if (d.state === "play") { show(null); if (document.activeElement && document.activeElement.blur) document.activeElement.blur(); }
      else if (d.state === "paused") show("ov-pause");
    } else if (type === "levelup") {
      renderCards(d.choices);
      show("ov-level");
    } else if (type === "gameover") {
      lastResult = d;
      $("go-time").textContent = fmt(d.time);
      $("go-kills").textContent = d.kills;
      $("go-level").textContent = d.level;
      $("go-newbest").classList.toggle("hidden", !d.newBest);
      updateBest();
      show("ov-over");
      setTimeout(() => $("btn-again").focus({ preventScroll: true }), 50);
    } else if (type === "mute") updateMute();
  }

  function renderCards(choices) {
    const box = $("lv-cards"); box.innerHTML = "";
    choices.forEach((c, i) => {
      const [icon, name, desc] = UP[c.id];
      const b = document.createElement("button");
      b.type = "button"; b.className = "lv-card"; b.dataset.up = c.id; b.disabled = true;
      b.innerHTML = `<span class="lv-icon" aria-hidden="true">${icon}</span><span class="lv-text"><b></b><span></span></span><span class="lv-pips"></span><kbd class="lv-key">${i + 1}</kbd>`;
      b.querySelector("b").textContent = T("up." + c.id, name);
      b.querySelector(".lv-text span").textContent = T("up." + c.id + ".d", desc);
      b.querySelector(".lv-pips").textContent = `${T("ui.lvl", "Lv")} ${c.lvl + 1}/${c.max}`;
      b.addEventListener("click", () => game.choose(c.id));
      box.appendChild(b);
    });
    clearTimeout(cardTimer);   // short delay so a thumb that is still on the screen can't pick a card by accident
    cardTimer = setTimeout(() => box.querySelectorAll("button").forEach(b => { b.disabled = false; }), 350);
  }

  function updateBest() {
    const b = game.best(), txt = b.time > 0 ? `${T("ui.best", "Best")}: ${fmt(b.time)} · ${b.kills} ${T("ui.kills", "kills")}` : T("ui.noBest", "No best score yet. Go for it!");
    $("start-best").textContent = txt;
    $("go-best").textContent = b.time > 0 ? txt : "";
    if (debugRun) { $("debug-line").textContent = T("ui.debug", "Debug start (not saved as best)") + (t0 ? ` · t=${fmt(t0)}` : "") + (bossNow ? " · boss" : ""); $("debug-line").classList.remove("hidden"); }
  }
  function updateMute() {
    const m = game.muted;
    $("btn-mute").classList.toggle("is-muted", m);
    $("btn-mute").setAttribute("aria-label", m ? T("a11y.unmute", "Unmute") : T("a11y.mute", "Mute"));
    $("btn-mute").setAttribute("aria-pressed", String(m));
  }
  function play() { game.start({ t0, boss: bossNow, record: !debugRun }); }
  function share() {
    const text = T("share.text", "I survived {t} in Hamster Rocket Arena 🐹🚀 Can you beat me?").replace("{t}", fmt(lastResult ? lastResult.time : 0));
    const url = "https://x.com/intent/tweet?text=" + encodeURIComponent(text) + "&url=" + encodeURIComponent(SITE);
    window.open(url, "_blank", "noopener,noreferrer");
  }

  $("btn-play").addEventListener("click", play);
  $("btn-again").addEventListener("click", play);
  $("btn-restart").addEventListener("click", play);
  $("btn-resume").addEventListener("click", () => game.resume());
  $("btn-pause").addEventListener("click", () => game.pause("button"));
  $("btn-mute").addEventListener("click", () => game.toggleMute());
  $("btn-share").addEventListener("click", share);
  document.addEventListener("keydown", e => {
    if (e.code !== "Enter" || e.repeat) return;
    if (game.state === "menu" || game.state === "over") { if (document.activeElement && document.activeElement.tagName === "BUTTON") return; e.preventDefault(); play(); }
  });
  window.addEventListener("hr:lang", () => { updateBest(); updateMute(); if (game.state === "levelup" && game.choices) renderCards(game.choices.map(id => ({ id, lvl: 0, max: HamsterArena.upgrades[id] }))); });
  updateBest(); updateMute();
})();
