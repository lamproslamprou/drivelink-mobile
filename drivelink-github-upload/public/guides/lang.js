// Shared bilingual toggle for the static /guides/ pages.
//
// These pages are plain static HTML, outside the React app entirely, so
// they can't read src/i18n.jsx's LangContext directly. This mirrors that
// file's detectLang() and STORAGE_KEY exactly instead, so a language choice
// made in the app carries over here, and a choice made here carries back
// into the app — same localStorage key, same detection order (saved choice,
// then navigator.language, then English).
//
// Not a build-time include: plain <script src="/guides/lang.js"> on every
// page in this directory. Load it early and unblocked (no defer/async, no
// type=module) so applyLang() runs before the page paints — otherwise a
// Spanish-preferring visitor sees an English flash before the swap.
(function () {
  var STORAGE_KEY = "drivelink_lang";

  function detectLang() {
    try {
      var saved = localStorage.getItem(STORAGE_KEY);
      if (saved === "en" || saved === "es") return saved;
    } catch (e) {
      // Private browsing can throw on localStorage access. Fall through to
      // navigator.language, same as src/i18n.jsx's detectLang().
    }
    var nav = (navigator.language || "").toLowerCase();
    return nav.indexOf("es") === 0 ? "es" : "en";
  }

  function applyLang(lang) {
    var root = document.documentElement;
    root.lang = lang;
    root.classList.remove("lang-en", "lang-es");
    root.classList.add("lang-" + lang);
    var buttons = document.querySelectorAll("[data-lang-btn]");
    for (var i = 0; i < buttons.length; i++) {
      var btn = buttons[i];
      btn.setAttribute(
        "aria-pressed",
        btn.getAttribute("data-lang-btn") === lang ? "true" : "false"
      );
    }
  }

  function setLang(lang) {
    try {
      localStorage.setItem(STORAGE_KEY, lang);
    } catch (e) {
      // Ignore — the toggle still works for this page load, it just won't
      // persist across a reload or back into the app.
    }
    applyLang(lang);
  }

  // Exposed in case a page ever wants to read/set language from other
  // inline script (none currently do).
  window.DL_LANG = { get: detectLang, set: setLang };

  // Runs synchronously, before <body> is parsed — this is the flash-avoider.
  applyLang(detectLang());

  document.addEventListener("DOMContentLoaded", function () {
    var toggle = document.querySelector("[data-lang-toggle]");
    if (!toggle) return;
    toggle.addEventListener("click", function (e) {
      var btn = e.target.closest("[data-lang-btn]");
      if (!btn) return;
      setLang(btn.getAttribute("data-lang-btn"));
    });
  });
})();
