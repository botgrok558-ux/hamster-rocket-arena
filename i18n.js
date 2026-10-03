/* DE/EN/FR language handling for Hamster Rocket Arena (same pattern as the main demo). Load in <head>.
   Static text: <span data-l="en">…</span><span data-l="de">…</span><span data-l="fr">…</span> (CSS hides the inactive ones).
   Dynamic text: HRI18N.t(key, englishFallback). Auto-detect: fr* -> fr, de* -> de, else en. A manual choice is remembered. */
(() => {
  const KEY = "hr_lang", LANGS = ["en", "de", "fr"];
  let saved = null; try { saved = localStorage.getItem(KEY); } catch (e) { }
  const nav = ((navigator.languages && navigator.languages[0]) || navigator.language || "").toLowerCase();
  const guess = /^fr\b/.test(nav) ? "fr" : /^de\b/.test(nav) ? "de" : "en";
  let lang = LANGS.includes(saved) ? saved : guess;
  const root = document.documentElement;
  root.dataset.lang = lang; root.lang = lang;

  const DICT = {
    de: {
      "hud.wave": "WELLE", "hud.best": "BESTWERT", "hud.combo": "COMBO", "hud.left": "ÜBRIG", "hud.boss": "ROBO-KATZE",
      "hud.bossWave": "BOSS-WELLE!", "hud.bossName": "RIESIGE ROBO-KATZE", "hud.bossDown": "ROBO-KATZE BESIEGT!", "hud.angry": "ROBO-KATZE IST SAUER!",
      "hud.clear": "WELLE GESCHAFFT!", "hud.ready": "MACH DICH BEREIT!", "hud.meow": "MIAU!", "hud.move": "BEWEGEN", "hud.aim": "ZIELEN (AUTO)",
      "pw.triple": "DREIFACHSCHUSS!", "pw.rapid": "SCHNELLFEUER!", "pw.shield": "SCHILD!", "pw.heal": "+LEBEN!",
      "ui.best": "Bestwert", "ui.noBest": "Noch kein Bestwert. Leg los!", "ui.waves1": "1 Welle", "ui.wavesN": "{n} Wellen",
      "ui.debug": "Debug: Start bei Welle {n} (zählt nicht als Bestwert)",
      "share.text1": "Ich habe 1 Welle in Hamster Rocket Arena überlebt 🐹🚀 Schaffst du mehr?",
      "share.textN": "Ich habe {n} Wellen in Hamster Rocket Arena überlebt 🐹🚀 Schaffst du mehr?",
      "a11y.mute": "Ton aus", "a11y.unmute": "Ton an", "a11y.pause": "Pause"
    },
    fr: {
      "hud.wave": "VAGUE", "hud.best": "RECORD", "hud.combo": "COMBO", "hud.left": "RESTANTS", "hud.boss": "ROBO-CHAT",
      "hud.bossWave": "VAGUE DE BOSS !", "hud.bossName": "ROBO-CHAT GÉANT", "hud.bossDown": "ROBO-CHAT VAINCU !", "hud.angry": "ROBO-CHAT EST FÂCHÉ !",
      "hud.clear": "VAGUE TERMINÉE !", "hud.ready": "PRÉPARE-TOI !", "hud.meow": "MIAOU !", "hud.move": "BOUGER", "hud.aim": "VISER (AUTO)",
      "pw.triple": "TIR TRIPLE !", "pw.rapid": "TIR RAPIDE !", "pw.shield": "BOUCLIER !", "pw.heal": "+VIE !",
      "ui.best": "Record", "ui.noBest": "Pas encore de record. À toi de jouer !", "ui.waves1": "1 vague", "ui.wavesN": "{n} vagues",
      "ui.debug": "Debug : départ à la vague {n} (pas compté comme record)",
      "share.text1": "J’ai survécu à 1 vague dans Hamster Rocket Arena 🐹🚀 Tu peux me battre\u00a0?",
      "share.textN": "J’ai survécu à {n} vagues dans Hamster Rocket Arena 🐹🚀 Tu peux me battre\u00a0?",
      "a11y.mute": "Couper le son", "a11y.unmute": "Activer le son", "a11y.pause": "Pause"
    }
  };
  const t = (k, en) => (DICT[lang] && DICT[lang][k]) || en;
  function sync() {
    document.querySelectorAll("[data-lang-btn]").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.langBtn === lang)));
    document.querySelectorAll("[data-i18n-attr]").forEach(el => { const [attr, en, de, fr] = el.dataset.i18nAttr.split("|"); el.setAttribute(attr, lang === "de" ? de : lang === "fr" ? (fr || en) : en); });
    window.dispatchEvent(new CustomEvent("hr:lang", { detail: lang }));
  }
  function set(l) {
    lang = LANGS.includes(l) ? l : "en"; root.dataset.lang = lang; root.lang = lang;
    try { localStorage.setItem(KEY, lang); } catch (e) { }
    sync();
  }
  window.HRI18N = { t, set, get lang() { return lang; } };
  document.addEventListener("DOMContentLoaded", () => {
    sync();   // auto-detected language is applied but not stored as a choice
    document.querySelectorAll("[data-lang-btn]").forEach(b => b.addEventListener("click", () => set(b.dataset.langBtn)));
  });
})();
