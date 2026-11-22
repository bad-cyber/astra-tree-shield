/* downloads-guard.js — Astra · Древо Щит · v0.7.2
   Контроль загрузок: опасные расширения, подозрительные архивы, репутация источника и SHA-256 хэши.
*/
import {
  loadConfig, getHostname, EICAR_SHA256_HASHES, isTestPhishingUrl
} from '../shared/config.js';
import { bumpStats } from './stats.js';
import { evaluateUrlSecurity } from './security.js';
import { getEffectiveModulesForHost } from './tab-tracker.js';

const DANGEROUS_EXT = [
  '.exe', '.msi', '.scr', '.js', '.vbs', '.ps1', '.bat', '.cmd',
  '.hta', '.lnk', '.iso', '.img', '.vhd', '.cab', '.jar', '.wsf',
  '.wsh', '.reg', '.com', '.pif', '.apk'
];
const ARCHIVE_EXT = ['.zip', '.rar', '.7z', '.tgz', '.gz', '.ace', '.tar'];
const SUSPICIOUS_ARCHIVE_RE = /(password|pass|crack|keygen|patch|invoice|akt|акт|счет|оплата|uncommon|eicar)/i;

export function initDownloadsGuard(notifyFn) {
  chrome.downloads.onCreated.addListener(async (item) => {
    const cfg = await loadConfig();
    if (!cfg.enabled) return;

    const downloadUrl = item.finalUrl || item.url || '';
    const sourceHost = getHostname(item.referrer || downloadUrl);
    const eff = await getEffectiveModulesForHost(cfg, sourceHost);

    const rawPath = (item.filename || downloadUrl).toLowerCase().split('?').at(0);
    const shortName = rawPath.split(/[/\\]/).pop() || 'файл';
    const isDangerousExt = DANGEROUS_EXT.some((ext) => rawPath.endsWith(ext));
    const isSuspiciousArchive = ARCHIVE_EXT.some((ext) => rawPath.endsWith(ext)) && SUSPICIOUS_ARCHIVE_RE.test(shortName);

    let isMaliciousSource = false;
    let sourceReason = '';
    if (eff.phishing && downloadUrl.startsWith('http')) {
      if (isTestPhishingUrl(downloadUrl)) {
        isMaliciousSource = true;
        sourceReason = 'тестовый вредоносный/фишинговый файл безопасности';
      } else {
        try {
          const sourceEval = await evaluateUrlSecurity(downloadUrl);
          if (sourceEval.risk === 'danger') {
            isMaliciousSource = true;
            sourceReason = sourceEval.reasons.at(0) || 'опасный источник загрузки';
          }
        } catch {}
      }
    }
    let isKnownBadHash = false;
    try {
      const { maliciousHashes = [] } = await chrome.storage.local.get('maliciousHashes');
      const combinedHashes = [
        ...EICAR_SHA256_HASHES,
        ...(Array.isArray(maliciousHashes) ? maliciousHashes : []),
      ];
      if (combinedHashes.length > 0) {
        const hashSet = new Set(combinedHashes.map((h) => String(h).toLowerCase()));
        const urlHashMatches = downloadUrl.match(/\b[a-f0-9]{64}\b/gi) || [];
        if (urlHashMatches.some((h) => hashSet.has(h.toLowerCase()))) {
          isKnownBadHash = true;
        }
      }
    } catch {}

    if (!isDangerousExt && !isSuspiciousArchive && !isMaliciousSource && !isKnownBadHash) return;

    const reasonLabel = isKnownBadHash
      ? 'Совпадение с локальной базой вредоносных SHA-256 хэшей'
      : isMaliciousSource
        ? `Опасный источник: ${sourceReason}`
        : isSuspiciousArchive
          ? `Подозрительный архив: ${shortName}`
          : `Исполняемый/скриптовый файл: ${shortName}`;

    if (eff.blockDownloads || isKnownBadHash || isMaliciousSource) {
      try {
        await chrome.downloads.cancel(item.id);
        await chrome.downloads.erase({ id: item.id });
        notifyFn('Astra: Загрузка заблокирована', `${shortName} — ${reasonLabel}`);
        await bumpStats(1, true);
      } catch {
        notifyFn('Astra: Не удалось заблокировать', `${shortName} — ${reasonLabel}`);
      }
    } else if (eff.downloads) {
      notifyFn('Astra: Осторожно, загрузка!', `${shortName} — ${reasonLabel}`);
    }
  });
}
