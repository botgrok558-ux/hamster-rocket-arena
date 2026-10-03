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
      "hud.level": "LV", "hud.horde": "HORDE IM ANMARSCH!", "hud.bossWave": "BOSS!", "hud.bossName": "RIESIGE ROBO-KATZE", "hud.bossDown": "ROBO-KATZE BESIEGT!",
      "hud.boss": "ROBO-KATZE", "hud.move": "BEWEGEN", "hud.aim": "ZIELEN + SCHIESSEN",
      "up.damage": "Kern-Schaden", "up.damage.d": "+25 % Schaden",
      "up.rate": "Feuerrate", "up.rate.d": "15 % schneller schießen",
      "up.multi": "Mehrfachschuss", "up.multi.d": "+1 Kern pro Schuss",
      "up.speed": "Tempo", "up.speed.d": "10 % schneller fliegen",
      "up.hp": "Max. Leben", "up.hp.d": "+20 max. Leben, heilt 20",
      "up.pierce": "Durchschlag", "up.pierce.d": "Kerne durchbohren +1 Gegner",
      "ui.lvl": "Stufe", "ui.best": "Bestwert", "ui.kills": "Gegner", "ui.noBest": "Noch kein Bestwert. Leg los!",
      "ui.debug": "Debug-Start (zählt nicht als Bestwert)",
      "share.text": "Ich habe {t} in Hamster Rocket Arena überlebt 🐹🚀 Schaffst du mehr?",
      "a11y.mute": "Ton aus", "a11y.unmute": "Ton an", "a11y.pause": "Pause"
    },
    fr: {
      "hud.level": "NIV", "hud.horde": "LA HORDE ARRIVE !", "hud.bossWave": "BOSS !", "hud.bossName": "ROBO-CHAT GÉANT", "hud.bossDown": "ROBO-CHAT VAINCU !",
      "hud.boss": "ROBO-CHAT", "hud.move": "BOUGER", "hud.aim": "VISER + TIRER",
      "up.damage": "Dégâts", "up.damage.d": "+25 % de dégâts",
      "up.rate": "Cadence de tir", "up.rate.d": "Tire 15 % plus vite",
      "up.multi": "Tir multiple", "up.multi.d": "+1 graine par tir",
      "up.speed": "Vitesse", "up.speed.d": "Vole 10 % plus vite",
      "up.hp": "Vie max", "up.hp.d": "+20 PV max, soigne 20",
      "up.pierce": "Perforation", "up.pierce.d": "Les graines traversent +1 ennemi",
      "ui.lvl": "Niv.", "ui.best": "Record", "ui.kills": "ennemis", "ui.noBest": "Pas encore de record. À toi de jouer !",
      "ui.debug": "Départ debug (pas compté comme record)",
      "share.text": "J’ai survécu pendant {t} dans Hamster Rocket Arena 🐹🚀 Tu peux me battre\u00a0?",
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
