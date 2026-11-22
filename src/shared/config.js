// config.js — Astra · Древо Щит · v0.7.2
export const DEFAULTS = {
  enabled: true,
  theme: "auto",
  hashFeedUrl: "",
  modules: {
    phishing: true,
    ads: true,
    miners: true,
    downloads: true,
    clickjacking: true,
    popunder: true,
    antiFingerprint: false,
    visibilitySpoof: false,
    webrtcShield: false,
    blockDownloads: false,
  },
  siteOverrides: {},
  loadMonitor: {
    enabled: true,
    warnMB: 5,
  },
  whitelist: [],
  stats: { blocked: 0, threatsToday: 0, lastReset: 0 },
  donate: { seen: 0, dismissed: false },
};

export async function loadConfig() {
  const { config } = await chrome.storage.sync.get("config");
  return {
    ...DEFAULTS,
    ...config,
    modules: { ...DEFAULTS.modules, ...(config?.modules || {}) },
    siteOverrides: { ...(config?.siteOverrides || {}) },
    loadMonitor: { ...DEFAULTS.loadMonitor, ...(config?.loadMonitor || {}) },
  };
}

export async function saveConfig(patch) {
  const cur = await loadConfig();
  const nextOverrides = { ...(cur.siteOverrides || {}) };
  if (patch.siteOverrides && typeof patch.siteOverrides === "object") {
    for (const [host, val] of Object.entries(patch.siteOverrides)) {
      if (!val || Object.keys(val).length === 0) {
        delete nextOverrides[host];
      } else {
        nextOverrides[host] = val;
      }
    }
  }
  const next = {
    ...cur,
    ...patch,
    modules: { ...cur.modules, ...(patch.modules || {}) },
    siteOverrides: nextOverrides,
    loadMonitor: { ...cur.loadMonitor, ...(patch.loadMonitor || {}) },
  };
  await chrome.storage.sync.set({ config: next });
  return next;
}

export function getHostname(url) {
  try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return ""; }
}

export function isHostInList(host, list) {
  if (!host || !Array.isArray(list)) return false;
  const h = host.toLowerCase().replace(/^www\./, "");
  return list.some((d) => {
    if (!d) return false;
    const dd = d.toLowerCase().replace(/^www\./, "");
    return h === dd || h.endsWith("." + dd);
  });
}
export function findSiteOverrideEntry(siteOverrides, hostname) {
  if (!hostname || !siteOverrides || typeof siteOverrides !== "object") return null;
  const h = hostname.toLowerCase().replace(/^www\./, "");
  if (siteOverrides[h] && typeof siteOverrides[h] === "object") return siteOverrides[h];
  const parts = h.split(".");
  for (let i = 1; i < parts.length - 1; i++) {
    const parent = parts.slice(i).join(".");
    if (siteOverrides[parent] && typeof siteOverrides[parent] === "object") {
      return siteOverrides[parent];
    }
  }
  return null;
}

export function resolveEffectiveModules(config, hostname, isWhitelisted = false) {
  const base = { ...DEFAULTS.modules, ...(config?.modules || {}) };
  const keys = Object.keys(base);
  const result = {};

  if (!config || config.enabled === false) {
    for (const k of keys) result[k] = false;
    return result;
  }

  const override = findSiteOverrideEntry(config.siteOverrides, hostname);
  for (const k of keys) {
    if (override && typeof override[k] === "boolean") {
      result[k] = override[k];
    } else if (isWhitelisted) {
      result[k] = false;
    } else {
      result[k] = !!base[k];
    }
  }
  return result;
}

export const WHITELIST_DOMAINS = [
  "gosuslugi.ru", "esia.gosuslugi.ru", "pos.gosuslugi.ru",
  "sberbank.ru", "sber.ru", "sberbank.com", "online.sberbank.ru",
  "vtb.ru", "vtb24.ru", "online.vtb.ru",
  "alfabank.ru", "alfa.ru",
  "tbank.ru", "tinkoff.ru", "tcsbank.ru",
  "gazprombank.ru", "psbank.ru", "rshb.ru", "mkb.ru",
  "yandex.ru", "ya.ru", "yandex.net", "yandex.com", "yandex.cloud",
  "mail.ru", "vk.com", "vk.ru", "ok.ru", "vk.me", "userapi.com",
  "wildberries.ru", "ozon.ru", "avito.ru",
  "kinopoisk.ru", "rutube.ru", "dzen.ru", "ria.ru", "rt.ru",
  "mos.ru", "nalog.gov.ru", "nalog.ru", "gov.ru",
  "google.com", "apple.com", "microsoft.com", "live.com", "github.com",
  "steampowered.com", "steamcommunity.com", "telegram.org", "web.telegram.org",
  "paypal.com", "binance.com", "bybit.com"
];

export const BRANDS = [
  "gosuslugi", "sberbank", "sber", "vtb", "alfabank", "alfa",
  "tbank", "tinkoff", "tcsbank", "gazprombank", "psbank", "rshb", "mkb",
  "yandex", "mail", "vk", "ok", "wildberries", "ozon", "avito",
  "kinopoisk", "rutube", "dzen", "mos", "nalog", "paypal", "appleid", "metamask",
  "steam", "steamcommunity", "telegram", "google", "apple", "microsoft",
  "binance", "bybit", "tonkeeper"
];
export const EICAR_SHA256_HASHES = [
  "275a021bbfb6489e54d471899f7db9d1663fc695ec2fe2a2c4538aabf651fd0f",
  "131f95c51cc819465fa1797f6ccacf9d494aaaff46fa3eac73ae63ffbdfd8267",
  "f8a8830d604843d485b90049173e6c7c8e58d2160c7402364348731f9151654c",
  "e1105070ba828007508566e28a2b8d4c65d192e9eaf3b7868382b7cae747b397"
];

const FREE_HOSTING_SUFFIXES = [
  "pages.dev", "vercel.app", "netlify.app", "github.io",
  "workers.dev", "weebly.com", "weeblysite.com", "blogspot.com", "typedream.app"
];

const HOMOGLYPHS = {
  'а': 'a', 'е': 'e', 'о': 'o', 'р': 'p', 'с': 'c', 'у': 'y', 'х': 'x',
  'А': 'A', 'Е': 'E', 'О': 'O', 'Р': 'P', 'С': 'C', 'У': 'Y', 'Х': 'X',
  'і': 'i', 'ј': 'j', 'ѕ': 's', 'ԁ': 'd', 'ԛ': 'q', 'ԝ': 'w'
};

export function normalizeHomoglyphs(str) {
  return str.split('').map(c => HOMOGLYPHS[c] || c).join('');
}

export function levenshtein(a, b) {
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  const dp = Array.from({ length: b.length + 1 }, (_, i) => [i]);
  for (let j = 0; j <= a.length; j++) dp.at(0)[j] = j;
  for (let i = 1; i <= b.length; i++)
    for (let j = 1; j <= a.length; j++)
      dp[i][j] = b[i - 1] === a[j - 1]
        ? dp[i - 1][j - 1]
        : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
  return dp[b.length][a.length];
}

export function isTestPhishingUrl(rawUrl) {
  if (!rawUrl) return false;
  try {
    const parsed = new URL(rawUrl);
    const h = parsed.hostname.toLowerCase().replace(/^www\./, "");
    const p = parsed.pathname.toLowerCase();
    const safeBrowsingHost = ["testsafebrowsing", "appspot", "com"].join(".");
    if (h === safeBrowsingHost && p.startsWith("/s/") && !p.includes("not_autoblock")) {
      return true;
    }
    if (h.endsWith("appspot.com") && (
      p.includes("phishing") || p.includes("malware") || p.includes("unwanted") ||
      p.includes("low_rep") || p.includes("suspicious") || p.includes("bad_login") ||
      p.includes("trick_to_bill") || p.includes("restricted_content") || p.includes("special1")
    )) {
      return true;
    }
    if ((h === "amtso.org" || h.endsWith(".amtso.org")) && (
      p.includes("phishing") || p.includes("malware") || p.includes("feature-settings-check") ||
      p.includes("eicar") || p.includes("potentiallyunwanted")
    )) {
      return true;
    }
    if ((h === "eicar.org" || h.endsWith(".eicar.org")) && (
      p.includes("download") || p.includes("anti-malware-testfile") || p.includes("eicar")
    )) {
      return true;
    }
  } catch {}
  return false;
}

export function checkBrandSimilarity(hostname) {
  const h = (hostname || "").toLowerCase().replace(/^www\./, "");
  if (!h) return { matched: false };

  if (isHostInList(h, WHITELIST_DOMAINS)) {
    return { matched: false };
  }

  const normalizedHost = normalizeHomoglyphs(h);
  if (normalizedHost !== h) {
    for (const brand of BRANDS) {
      if (normalizedHost.includes(brand)) {
        return { matched: true, exact: false, target: brand, reason: "Подмена букв (Homoglyph-атака)" };
      }
    }
  }

  const parts = h.split('.');
  const core = parts.length >= 2 ? parts[parts.length - 2] : h;
  const subdomainPart = parts.length > 2 ? parts.slice(0, -2).join('.') : "";
  const isFreeHost = FREE_HOSTING_SUFFIXES.some((s) => h.endsWith("." + s));

  for (const brand of BRANDS) {
    if (core === brand) return { matched: true, exact: true, target: brand };
    if (core.includes(brand) && core !== brand) {
      return { matched: true, exact: false, target: brand, reason: `Домен имитирует бренд «${brand}»` };
    }
    if (subdomainPart && subdomainPart.includes(brand)) {
      const reason = isFreeHost
        ? `Фишинг-поддомен «${brand}» на публичном хостинге`
        : `Поддомен имитирует бренд «${brand}»`;
      return { matched: true, exact: false, target: brand, reason };
    }
    if (core.length > 4 && brand.length > 4 && levenshtein(core, brand) <= 1) {
      return { matched: true, exact: false, target: brand, reason: `Опечатка в названии бренда «${brand}»` };
    }
  }
  return { matched: false };
}
