(function () {
  const post = (hook) => window.postMessage({ __astra: true, hook }, "*");

  const origInst = WebAssembly.instantiate;
  WebAssembly.instantiate = function (...args) {
    try { post("wasm-instantiate"); } catch {}
    return origInst.apply(this, args);
  };

  const origInstS = WebAssembly.instantiateStreaming;
  if (origInstS) {
    WebAssembly.instantiateStreaming = function (...args) {
      try { post("wasm-instantiate"); } catch {}
      return origInstS.apply(this, args);
    };
  }

  const OrigWorker = window.Worker;
  window.Worker = function (url, opts) {
    try {
      const u = typeof url === "string" ? url : (url && url.toString());
      if (u && (u.startsWith("blob:") || u.includes("miner") || u.includes("cryptonight")))
        post("worker-spawn");
    } catch {}
    return new OrigWorker(url, opts);
  };
  window.Worker.prototype = OrigWorker.prototype;
})();