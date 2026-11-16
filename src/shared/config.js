// config.js — Astra · Древо Щит · v0.6.3
export const DEFAULTS = {
  enabled: true,
  theme: "auto",
  modules: {
    phishing: true,
    ads: true,
    miners: true,
    downloads: true,
    clickjacking: true,
    blockDownloads: false,
  },
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
    loadMonitor: { ...DEFAULTS.loadMonitor, ...(config?.loadMonitor || {}) },
  };
}

export async function saveConfig(patch) {
  const cur = await loadConfig();
  const next = {
    ...cur,
    ...patch,
    modules: { ...cur.modules, ...(patch.modules || {}) },
    loadMonitor: { ...cur.loadMonitor, ...(patch.loadMonitor || {}) },
  };
  await chrome.storage.sync.set({ config: next });
  return next;
}

export function getHostname(url) {
  try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return ""; }
}

// Универсальная проверка: домен в списке (точное совпадение или поддомен)
export function isHostInList(host, list) {
  if (!host || !Array.isArray(list)) return false;
  const h = host.toLowerCase().replace(/^www\./, "");
  return list.some((d) => {
    if (!d) return false;
    const dd = d.toLowerCase().replace(/^www\./, "");
    return h === dd || h.endsWith("." + dd);
  });
}

// === БЕЛЫЙ СПИСОК ОФИЦИАЛЬНЫХ РЕСУРСОВ ===
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
  "mos.ru", "nalog.gov.ru", "nalog.ru", "gov.ru"
];
const BRANDS = [
  "gosuslugi", "sberbank", "sber", "vtb", "alfabank", "alfa",
  "tbank", "tinkoff", "tcsbank", "gazprombank", "psbank", "rshb", "mkb",
  "yandex", "mail", "vk", "ok", "wildberries", "ozon", "avito",
  "kinopoisk", "rutube", "dzen", "mos", "nalog", "paypal", "appleid", "metamask"
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
    const u = new URL(rawUrl);
    const h = u.hostname.toLowerCase();
    const p = u.pathname.toLowerCase();
    if (h === "://appspot.com" && (
      p.includes("phishing") || p.includes("malware") || p.includes("unwanted") || p.includes("low_rep") || p.includes("suspicious")
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
