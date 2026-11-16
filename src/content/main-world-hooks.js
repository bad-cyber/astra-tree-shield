(function () {
  if (window.__astraMainHooksLoaded) return;
  window.__astraMainHooksLoaded = true;
  window.__astraMinersEnabled = true;

  const MINER_PATTERNS = [
    "miner", "cryptonight", "coinhive", "coin-hive", "cryptoloot",
    "jsecoin", "minero", "webminepool", "deepminer", "authedmine", "stratum"
  ];

  const isMinerUrl = (u) => {
    if (!u) return false;
    const low = String(u).toLowerCase();
    return MINER_PATTERNS.some((p) => low.includes(p));
  };

  const post = (hook, extra = {}) => {
    try { window.postMessage({ __astra: true, hook, ...extra }, "*"); } catch {}
  };

  window.addEventListener("message", (e) => {
    if (e.source === window && e.data?.__astraCtrl === "SET_MINERS") {
      window.__astraMinersEnabled = !!e.data.enabled;
    }
  });

  const origInst = WebAssembly.instantiate;
  WebAssembly.instantiate = function (...args) {
    post("wasm-instantiate");
    return origInst.apply(this, args);
  };

  const origInstS = WebAssembly.instantiateStreaming;
  if (origInstS) {
    WebAssembly.instantiateStreaming = function (...args) {
      post("wasm-instantiate");
      return origInstS.apply(this, args);
    };
  }

  const OrigWorker = window.Worker;
  window.Worker = function (url, opts) {
    const u = typeof url === "string" ? url : (url && url.toString()) || "";
    const minerSuspected = isMinerUrl(u) || u.startsWith("blob:");
    if (minerSuspected) {
      post("worker-spawn", { blocked: window.__astraMinersEnabled && isMinerUrl(u), url: u.slice(0, 120) });
      if (window.__astraMinersEnabled && isMinerUrl(u)) {
        throw new DOMException("Blocked by Astra Miner Shield", "SecurityError");
      }
    }
    return new OrigWorker(url, opts);
  };
  window.Worker.prototype = OrigWorker.prototype;
})();
