/* UI glue for the Hamster Rocket Arena test site: overlays, buttons, language, share. The game itself is in arena.js. */
(() => {
  "use strict";
  const $ = id => document.getElementById(id);
  const T = (k, en) => (window.HRI18N ? HRI18N.t(k, en) : en);
  const SITE = "https://botgrok558-ux.github.io/hamster-rocket-arena/";
  const params = new URLSearchParams(location.search);
  const startWave = Math.min(99, Math.max(1, parseInt(params.get("wave"), 10) || 1));
  const debugRun = startWave !== 1;          // ?wave=N jumps ahead for testing; such runs never touch the best score
  let lastResult = null;

  const overlays = ["ov-start", "ov-pause", "ov-over"];
  const show = id => overlays.forEach(o => $(o).classList.toggle("hidden", o !== id));
  const wavesText = n => (n === 1 ? T("ui.waves1", "1 wave") : T("ui.wavesN", "{n} waves").replace("{n}", n));

  const game = HamsterArena.create({ canvas: $("arena"), assetBase: "assets/", t: T, storagePrefix: "hra_", onEvent });
  window.HR_ARENA = game;   // handy for testing from the console

  function onEvent(type, d) {
    if (type === "state") {
      $("btn-pause").classList.toggle("hidden", d.state !== "play");
      if (d.state === "play") { show(null); if (document.activeElement && document.activeElement.blur) document.activeElement.blur(); }
      else if (d.state === "paused") { show("ov-pause"); }
    } else if (type === "gameover") {
      lastResult = d;
      $("go-score").textContent = d.score;
      $("go-waves").textContent = d.survived;
      $("go-kills").textContent = d.kills;
      $("go-combo").textContent = d.bestCombo;
      $("go-newbest").classList.toggle("hidden", !d.newBest);
      updateBest();
      show("ov-over");
      setTimeout(() => $("btn-again").focus({ preventScroll: true }), 50);
    } else if (type === "mute") updateMute();
  }

  function updateBest() {
    const b = game.best(), txt = b.score > 0 ? `${T("ui.best", "Best")}: ${b.score} · ${wavesText(b.waves)}` : T("ui.noBest", "No best score yet. Go for it!");
    $("start-best").textContent = txt;
    $("go-best").textContent = b.score > 0 ? txt : "";
    if (debugRun) { $("debug-line").textContent = T("ui.debug", "Debug: starting at wave {n} (not saved as best)").replace("{n}", startWave); $("debug-line").classList.remove("hidden"); }
  }
  function updateMute() {
    const m = game.muted;
    $("btn-mute").classList.toggle("is-muted", m);
    $("btn-mute").setAttribute("aria-label", m ? T("a11y.unmute", "Unmute") : T("a11y.mute", "Mute"));
    $("btn-mute").setAttribute("aria-pressed", String(m));
  }
  function play() { game.start(startWave, { record: !debugRun }); }
  function share() {
    const n = lastResult ? lastResult.survived : 0;
    const text = n === 1 ? T("share.text1", "I survived 1 wave in Hamster Rocket Arena 🐹🚀 Can you beat me?")
      : T("share.textN", "I survived {n} waves in Hamster Rocket Arena 🐹🚀 Can you beat me?").replace("{n}", n);
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
  window.addEventListener("hr:lang", () => { updateBest(); updateMute(); });
  updateBest(); updateMute();
})();
