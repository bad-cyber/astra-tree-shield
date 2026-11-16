/* metrics.js — Astra · Древо Щит · v0.6.3
   Монитор нагрузки страницы и сбор метрик ресурсов для вкладки «Загрузка страницы».
*/
(() => {
  'use strict';
  const A = (window.AstraShield = window.AstraShield || {});
  if (A.metricsLoaded) return;
  A.metricsLoaded = true;

  const TRACKER_HOSTS = [
    'doubleclick' + '.net', 'googlesyndication' + '.com', 'googleadservices' + '.com',
    'yabs.yandex', 'an.yandex', 'awaps.yandex', 'advertising.yandex',
    'adfox', 'adriver', 'ad.mail', 'ads.vk', 'criteo', 'taboola', 'outbrain',
    'mytarget', 'mc.yandex', 'top-fwz1', 'r.mail', 'rtrg',
    'smi2', 'lentainform', 'marketgid', 'mgid', 'directadvert', 'nativeroll', 'videonow', 'seedr',
    'facebook' + '.com/tr', 'google-analytics',
  ];

  function isTrackerUrl(url) {
    const u = url.toLowerCase();
    return TRACKER_HOSTS.some((h) => u.includes(h));
  }

  A.sendPageMetrics = () => {
    if (window.top !== window.self) return;
    if (!A.isContextValid()) return;

    try {
      const resources = performance.getEntriesByType('resource') || [];
      const byType = {
        script: { bytes: 0, count: 0 },
        image: { bytes: 0, count: 0 },
        stylesheet: { bytes: 0, count: 0 },
        xmlhttprequest: { bytes: 0, count: 0 },
        fetch: { bytes: 0, count: 0 },
        font: { bytes: 0, count: 0 },
        media: { bytes: 0, count: 0 },
        other: { bytes: 0, count: 0 },
      };
      let totalBytes = 0, adBytes = 0;
      const top = [];

      for (const r of resources) {
        const size = r.transferSize || r.decodedBodySize || 0;
        let type = 'other';
        const init = r.initiatorType || '';
        if (init === 'script') type = 'script';
        else if (init === 'img' || init === 'image') type = 'image';
        else if (init === 'link' || init === 'css') type = 'stylesheet';
        else if (init === 'xmlhttprequest') type = 'xmlhttprequest';
        else if (init === 'fetch') type = 'fetch';
        else if (init === 'font') type = 'font';
        else if (init === 'media' || init === 'video' || init === 'audio') type = 'media';

        byType[type].bytes += size;
        byType[type].count += 1;
        totalBytes += size;
        if (isTrackerUrl(r.name)) adBytes += size;

        if (size > 0) {
          top.push({
            url: r.name,
            size,
            type,
            duration: Math.round(r.duration || 0),
            domain: (() => { try { return new URL(r.name).hostname; } catch { return ''; } })(),
            tracker: isTrackerUrl(r.name),
          });
        }
      }
      top.sort((a, b) => b.size - a.size);
      const timing = performance.timing || {};
      const domContentLoaded = timing.domContentLoadedEventEnd && timing.navigationStart
        ? Math.round(timing.domContentLoadedEventEnd - timing.navigationStart)
        : 0;
      const loadComplete = timing.loadEventEnd && timing.navigationStart
        ? Math.round(timing.loadEventEnd - timing.navigationStart)
        : 0;

      const metrics = {
        url: location.href,
        host: location.hostname,
        totalBytes,
        adBytes,
        totalCount: resources.length,
        byType,
        top: top.slice(0, 15),
        domContentLoaded,
        loadComplete,
        ts: Date.now(),
      };
      try { chrome.runtime.sendMessage({ type: 'PAGE_METRICS', metrics }).catch(() => {}); } catch {}
    } catch (e) {
      console.warn('[Astra] sendPageMetrics:', e);
    }
  };

  A.scheduleMetrics = () => {
    if (window.top !== window.self) return;
    if (document.readyState === 'complete') {
      setTimeout(A.sendPageMetrics, 1500);
      setTimeout(A.sendPageMetrics, 6000);
    } else {
      window.addEventListener('load', () => {
        setTimeout(A.sendPageMetrics, 1500);
        setTimeout(A.sendPageMetrics, 6000);
      }, { once: true });
    }
  };
})();
