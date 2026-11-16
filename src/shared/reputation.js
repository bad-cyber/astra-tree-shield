// reputation.js — Astra · Древо Щит · v0.6.3
// Загрузка открытых баз фишинга/вредоносов (без ключей).
// Интегрирован в security.js через updateThreatFeeds().

const u = (s) => s.replace(/\s+/g, "");

const FEEDS = [
  { name: "OpenPhish",    url: u("https: / / openphish.com / feed.txt"), isUrlList: true },
  { name: "Spam404",      url: u("https: / / ://githubusercontent.com / Spam404 / lists / master / main-blacklist.txt"), isUrlList: false },
  { name: "DigitalSide",  url: u("https: / / ://githubusercontent.com / davidonzo / Threat-Intel / master / lists / latestdomains.txt"), isUrlList: false },
  { name: "PhishingArmy", url: u("https: / / phishing.army / download / phishing_army_blocklist.txt"), isUrlList: false },
];

const DOMAIN_RE = /^[a-z0-9.-]+\.[a-z]{2,}$/;

export async function fetchThreatFeeds() {
  const allHosts = new Set();

  for (const feed of FEEDS) {
    try {
      const resp = await fetch(feed.url, {
        signal: AbortSignal.timeout(20000),
        headers: { "User-Agent": "Astra-Browser-Extension/0.6.3" },
      });
      if (!resp.ok) continue;

      const text = await resp.text();
      if (!text || /^\s*<!doctype\s+html/i.test(text) || /^\s*<html/i.test(text)) continue;

      for (let line of text.split(/\r?\n/)) {
        line = line.trim();
        if (!line || line.startsWith('#') || line.startsWith('//') || line.startsWith('!')) continue;

        if (feed.isUrlList) {
          try {
            const parsed = new URL(line);
            const h = parsed.hostname.toLowerCase().replace(/^www\./, "");
            if (h && DOMAIN_RE.test(h)) allHosts.add(h);
          } catch {}
        } else {
          const domain = line.split('/').at(0).toLowerCase().replace(/^www\./, "");
          if (domain && DOMAIN_RE.test(domain)) allHosts.add(domain);
        }
      }
    } catch (e) {
      console.warn(`[Astra] Не удалось загрузить ${feed.name}:`, e.message);
    }
  }
  return Array.from(allHosts);
}

export function checkThreatFeed(host, feedCollection) {
  if (!host || !feedCollection) return false;
  const h = host.toLowerCase().replace(/^www\./, "");
  const isSet = feedCollection instanceof Set;
  const has = (d) => (isSet ? feedCollection.has(d) : Array.isArray(feedCollection) && feedCollection.includes(d));

  if (has(h)) return true;
  const parts = h.split('.');
  for (let i = 1; i < parts.length - 1; i++) {
    const parent = parts.slice(i).join('.');
    if (has(parent)) return true;
  }
  return false;
}

export function aggregateRisk({ brandSim, ageDays, threatListed }) {
  const reasons = [];
  let risk = "ok";

  if (brandSim && brandSim.matched && !brandSim.exact) {
    risk = "danger";
    reasons.push(brandSim.reason || `Домен похож на «${brandSim.target}»`);
  }
  if (threatListed) {
    risk = "danger";
    reasons.push("Домен найден в открытых базах фишинга");
  }
  if (ageDays !== undefined && ageDays !== null && ageDays < 30) {
    if (risk === "ok") risk = "warn";
    reasons.push(`Домен зарегистрирован ${ageDays} дн. назад`);
  }
  return { risk, reasons };
}
