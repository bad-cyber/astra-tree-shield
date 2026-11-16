// reputation.js — Astra · Древо Щит · v0.3.0
// Загрузка открытых баз фишинга/вредоносов (без ключей).
// Интегрирован в service-worker через updateThreatFeeds().

const FEEDS = [
  { name: "OpenPhish",   url: "https://openphish.com/feed.txt", isUrlList: true  },
  { name: "Spam404",     url: "https://raw.githubusercontent.com/Spam404/lists/master/main-blacklist.txt", isUrlList: false },
  { name: "DigitalSide", url: "https://raw.githubusercontent.com/DigitalSide/threat-intel/main/domains.txt", isUrlList: false },
];

export async function fetchThreatFeeds() {
  const allHosts = new Set();

  for (const feed of FEEDS) {
    try {
      const resp = await fetch(feed.url, {
        signal: AbortSignal.timeout(15000),
        headers: { "User-Agent": "Astra-Browser-Extension/0.3.0" },
      });
      if (!resp.ok) continue;

      const text = await resp.text();
      for (let line of text.split(/\r?\n/)) {
        line = line.trim();
        if (!line || line.startsWith('#') || line.startsWith('//')) continue;

        if (feed.isUrlList) {
          try {
            const u = new URL(line);
            allHosts.add(u.hostname.replace(/^www\./, ""));
          } catch {}
        } else {
          const domain = line.split('/')[0].replace(/^www\./, "");
          if (domain && domain.includes('.')) allHosts.add(domain);
        }
      }
    } catch (e) {
      console.warn(`[Astra] Не удалось загрузить ${feed.name}:`, e.message);
    }
  }
  return Array.from(allHosts);
}

export function checkThreatFeed(host, feedArray) {
  if (!host || !feedArray || feedArray.length === 0) return false;
  return feedArray.includes(host);
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