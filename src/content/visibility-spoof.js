/* visibility-spoof.js — Astra · Древо Щит · v0.7.1
   B59: Защита от принудительной паузы видео/аудио при смене вкладки (Page Visibility Spoof в MAIN-мире).
*/
(function () {
  if (window.__astraVisibilitySpoofLoaded) return;
  window.__astraVisibilitySpoofLoaded = true;
  window.__astraVisibilitySpoofEnabled = false;

  window.addEventListener("message", (e) => {
    if (e.source !== window || !e.data) return;
    if (e.data.__astraCtrl === "SET_VISIBILITY_SPOOF") {
      window.__astraVisibilitySpoofEnabled = !!e.data.enabled;
    }
  });

  const blockVisibilityEvent = (e) => {
    if (!window.__astraVisibilitySpoofEnabled) return;
    e.stopImmediatePropagation();
  };

  for (const evtName of ["visibilitychange", "webkitvisibilitychange"]) {
    document.addEventListener(evtName, blockVisibilityEvent, { capture: true });
    window.addEventListener(evtName, blockVisibilityEvent, { capture: true });
  }

  const patchProp = (proto, prop, spoofedVal) => {
    try {
      const desc = Object.getOwnPropertyDescriptor(proto, prop);
      if (desc && typeof desc.get === "function") {
        Object.defineProperty(proto, prop, {
          configurable: true,
          get() {
            return window.__astraVisibilitySpoofEnabled ? spoofedVal : desc.get.call(this);
          }
        });
      }
    } catch {}
  };

  patchProp(Document.prototype, "hidden", false);
  patchProp(Document.prototype, "visibilityState", "visible");
  patchProp(Document.prototype, "webkitHidden", false);
  patchProp(Document.prototype, "webkitVisibilityState", "visible");
})();
