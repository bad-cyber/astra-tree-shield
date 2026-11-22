(function () {
  if (window.__astraMainHooksLoaded) return;
  window.__astraMainHooksLoaded = true;
  window.__astraMinersEnabled = true;
  window.__astraPopunderEnabled = true;
  window.__astraAntiFpEnabled = false;
  window.__astraWebrtcShieldEnabled = false;

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
    if (e.source !== window || !e.data) return;
    if (e.data.__astraCtrl === "SET_MINERS") {
      window.__astraMinersEnabled = !!e.data.enabled;
    }
    if (e.data.__astraCtrl === "SET_POPUNDER") {
      window.__astraPopunderEnabled = !!e.data.enabled;
    }
    if (e.data.__astraCtrl === "SET_ANTIFP") {
      window.__astraAntiFpEnabled = !!e.data.enabled;
    }
    if (e.data.__astraCtrl === "SET_WEBRTC") {
      window.__astraWebrtcShieldEnabled = !!e.data.enabled;
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
  // === ПЕРЕХВАТЧИК POP-UNDER ЛОВУШЕК (B54) ===
  const INTERACTIVE_SELECTOR = [
    'a[href]', 'button', 'input', 'select', 'textarea', 'label', 'summary',
    '[role="button"]', '[role="link"]', '[role="tab"]', '[role="menuitem"]',
    '[contenteditable="true"]', 'video', 'audio'
  ].join(',');

  let lastGestureTs = 0;
  let lastGestureInteractive = false;

  const trackUserGesture = (e) => {
    if (!e || e.isTrusted === false) return;
    lastGestureTs = Date.now();
    const target = e.target && e.target.nodeType === 1 ? e.target : e.target?.parentElement;
    if (!target || target === document.body || target === document.documentElement) {
      lastGestureInteractive = false;
      return;
    }
    lastGestureInteractive = !!target.closest(INTERACTIVE_SELECTOR);
  };

  for (const evtName of ["pointerdown", "mousedown", "touchstart", "click"]) {
    window.addEventListener(evtName, trackUserGesture, { capture: true, passive: true });
  }

  const getRootDomain = (host) => {
    const clean = (host || "").toLowerCase().replace(/^www\./, "");
    const parts = clean.split(".");
    if (parts.length <= 2) return clean;
    const sld = parts.at(-2);
    if (parts.length >= 3 && sld && sld.length <= 3 && ["co", "com", "org", "net", "gov", "ac", "edu"].includes(sld)) {
      return parts.slice(-3).join(".");
    }
    return parts.slice(-2).join(".");
  };

  const isExternalPopupTarget = (rawUrl) => {
    if (!rawUrl) return false;
    const str = String(rawUrl).trim();
    if (!str || str === "about:blank" || str.startsWith("javascript:") || str.startsWith("#")) return false;
    try {
      const parsed = new URL(str, location.href);
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false;
      const curRoot = getRootDomain(location.hostname);
      const dstRoot = getRootDomain(parsed.hostname);
      return !!dstRoot && dstRoot !== curRoot;
    } catch {
      return false;
    }
  };

  const origOpen = window.open;
  window.open = function (url, target, features) {
    if (window.__astraPopunderEnabled && isExternalPopupTarget(url)) {
      const age = Date.now() - lastGestureTs;
      const noValidGesture = !lastGestureTs || age > 1500;
      const emptyAreaClick = !lastGestureInteractive;
      if (noValidGesture || emptyAreaClick) {
        const cleanUrl = String(url).trim().slice(0, 140);
        post("popunder-blocked", {
          url: cleanUrl,
          reason: noValidGesture ? "unsolicited" : "empty-area-click"
        });
        return null;
      }
    }
    return origOpen.apply(this, arguments);
  };
  // === ОПЦИОНАЛЬНЫЙ ANTI-FINGERPRINTING (B55) ===
  const seedBuf = new Uint32Array(2);
  try { crypto.getRandomValues(seedBuf); } catch { seedBuf[0] = 1337; seedBuf[1] = 4242; }
  const sessionSalt = ((seedBuf.at(0) || 1337) % 251) + 1;
  const deltaSign = (seedBuf.at(1) & 1) ? 1 : -1;

  const applyCanvasNoise = (imageData) => {
    const d = imageData && imageData.data;
    if (!d || d.length < 16) return;
    const step = Math.max(16, (sessionSalt % 31) * 4);
    for (let i = (sessionSalt % 7) * 4; i + 3 < d.length; i += step) {
      if (d[i + 3] === 0) continue;
      const ch = (i >> 2) % 3;
      const cur = d[i + ch];
      if (cur > 1 && cur < 254) {
        d[i + ch] = cur + deltaSign;
      }
    }
  };

  const origGetImageData = CanvasRenderingContext2D.prototype.getImageData;
  CanvasRenderingContext2D.prototype.getImageData = function (...args) {
    const imgData = origGetImageData.apply(this, args);
    if (window.__astraAntiFpEnabled) {
      try { applyCanvasNoise(imgData); } catch {}
    }
    return imgData;
  };

  const origToDataURL = HTMLCanvasElement.prototype.toDataURL;
  HTMLCanvasElement.prototype.toDataURL = function (...args) {
    if (!window.__astraAntiFpEnabled || !this.width || !this.height) {
      return origToDataURL.apply(this, args);
    }
    try {
      const clone = document.createElement("canvas");
      clone.width = this.width;
      clone.height = this.height;
      const ctx = clone.getContext("2d");
      if (ctx) {
        ctx.drawImage(this, 0, 0);
        const imgData = origGetImageData.call(ctx, 0, 0, clone.width, clone.height);
        applyCanvasNoise(imgData);
        ctx.putImageData(imgData, 0, 0);
        return origToDataURL.apply(clone, args);
      }
    } catch {}
    return origToDataURL.apply(this, args);
  };

  if (window.AudioBuffer && AudioBuffer.prototype.getChannelData) {
    const origGetChannelData = AudioBuffer.prototype.getChannelData;
    const audioOffset = deltaSign * (sessionSalt / 256) * 1e-7;
    AudioBuffer.prototype.getChannelData = function (...args) {
      const arr = origGetChannelData.apply(this, args);
      if (window.__astraAntiFpEnabled && arr && arr.length > 0 && !arr.__astraNoised) {
        try {
          Object.defineProperty(arr, "__astraNoised", { value: true });
          const stride = Math.max(32, (sessionSalt % 29) + 17);
          for (let i = sessionSalt % 13; i < arr.length; i += stride) {
            arr[i] += audioOffset;
          }
        } catch {}
      }
      return arr;
    };
  }
  try {
    const hwDesc = Object.getOwnPropertyDescriptor(Navigator.prototype, "hardwareConcurrency");
    if (hwDesc && hwDesc.get) {
      Object.defineProperty(Navigator.prototype, "hardwareConcurrency", {
        configurable: true,
        get() {
          return window.__astraAntiFpEnabled ? 4 : hwDesc.get.call(this);
        }
      });
    }
    const memDesc = Object.getOwnPropertyDescriptor(Navigator.prototype, "deviceMemory");
    if (memDesc && memDesc.get) {
      Object.defineProperty(Navigator.prototype, "deviceMemory", {
        configurable: true,
        get() {
          return window.__astraAntiFpEnabled ? 8 : memDesc.get.call(this);
        }
      });
    }
  } catch {}

  // === ЗАЩИТА ОТ WEBRTC IP-УТЕЧЕК (B61) ===
  const isPrivateOrLocalCandidate = (candStr) => {
    if (!candStr || typeof candStr !== "string") return false;
    const low = candStr.toLowerCase();
    if (low.includes(".local")) return true;
    if (/\btyp\s+host\b/.test(low)) return true;
    if (/\b(10\.\d{1,3}\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3}|169\.254\.\d{1,3}\.\d{1,3}|127\.\d{1,3}\.\d{1,3}\.\d{1,3})\b/.test(low)) {
      return true;
    }
    if (/\b172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}\b/.test(low)) return true;
    if (/\b(fe80:|fc00:|fd[0-9a-f]{2}:|::1\b)/.test(low)) return true;
    return false;
  };

  const sanitizeSdp = (sdp) => {
    if (!sdp || typeof sdp !== "string") return sdp;
    return sdp
      .split(/\r?\n/)
      .filter((line) => !line.startsWith("a=candidate:") || !isPrivateOrLocalCandidate(line))
      .join("\r\n");
  };

  const wrapDesc = (desc) => {
    if (!desc || !desc.sdp || !window.__astraWebrtcShieldEnabled) return desc;
    const cleanSdp = sanitizeSdp(desc.sdp);
    if (cleanSdp === desc.sdp) return desc;
    try {
      return new RTCSessionDescription({ type: desc.type, sdp: cleanSdp });
    } catch {
      return { type: desc.type, sdp: cleanSdp };
    }
  };

  const OrigRTC = window.RTCPeerConnection || window.webkitRTCPeerConnection;
  if (OrigRTC) {
    const WrappedRTC = function (config, constraints) {
      const pc = new OrigRTC(config, constraints);
      const origAddEventListener = pc.addEventListener.bind(pc);
      pc.addEventListener = function (type, listener, options) {
        if (type === "icecandidate" && typeof listener === "function") {
          const wrapped = function (ev) {
            if (window.__astraWebrtcShieldEnabled && ev?.candidate?.candidate && isPrivateOrLocalCandidate(ev.candidate.candidate)) {
              post("webrtc-leak-blocked", { candidate: ev.candidate.candidate.slice(0, 80) });
              return;
            }
            return listener.call(this, ev);
          };
          return origAddEventListener(type, wrapped, options);
        }
        return origAddEventListener(type, listener, options);
      };

      let userOnIce = null;
      Object.defineProperty(pc, "onicecandidate", {
        configurable: true,
        get() { return userOnIce; },
        set(fn) {
          userOnIce = typeof fn === "function" ? fn : null;
          origAddEventListener("icecandidate", (ev) => {
            if (!userOnIce) return;
            if (window.__astraWebrtcShieldEnabled && ev?.candidate?.candidate && isPrivateOrLocalCandidate(ev.candidate.candidate)) {
              post("webrtc-leak-blocked", { candidate: ev.candidate.candidate.slice(0, 80) });
              return;
            }
            userOnIce.call(pc, ev);
          });
        }
      });

      const origLocalDesc = Object.getOwnPropertyDescriptor(OrigRTC.prototype, "localDescription");
      if (origLocalDesc?.get) {
        Object.defineProperty(pc, "localDescription", {
          configurable: true,
          get() { return wrapDesc(origLocalDesc.get.call(pc)); }
        });
      }
      const origCurLocalDesc = Object.getOwnPropertyDescriptor(OrigRTC.prototype, "currentLocalDescription");
      if (origCurLocalDesc?.get) {
        Object.defineProperty(pc, "currentLocalDescription", {
          configurable: true,
          get() { return wrapDesc(origCurLocalDesc.get.call(pc)); }
        });
      }
      return pc;
    };
    WrappedRTC.prototype = OrigRTC.prototype;
    window.RTCPeerConnection = WrappedRTC;
    if (window.webkitRTCPeerConnection) window.webkitRTCPeerConnection = WrappedRTC;
  }
})();
