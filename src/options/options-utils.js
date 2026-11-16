/* options-utils.js — Astra · Древо Щит · v0.6.3
   Вспомогательные утилиты страницы настроек и нормализация доменов (фикс B32).
*/
export const $ = (s) => document.querySelector(s);

export function escapeHtml(str) {
  return String(str || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function formatRuleDate(ts) {
  if (!ts || typeof ts !== "number") return "";
  try {
    return new Date(ts).toLocaleString("ru-RU", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit"
    });
  } catch {
    return "";
  }
}

export function formatBytes(bytes) {
  const b = Number(bytes) || 0;
  if (b < 1024) return `${b} Б`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} КБ`;
  if (b < 1024 * 1024 * 1024) return `${(b / (1024 * 1024)).toFixed(2)} МБ`;
  return `${(b / (1024 * 1024 * 1024)).toFixed(2)} ГБ`;
}

export function normalizeHostInput(raw) {
  let val = String(raw || "").trim().toLowerCase();
  if (!val || val === "*") return val;
  val = val.replace(/^[a-z]+:\/\//, "").split("/").at(0).split(":").at(0).replace(/^www\./, "");
  return /^[a-z0-9а-яё.-]+\.[a-zа-яё]{2,}$/i.test(val) ? val : "";
}

export function isValidCssSelector(sel) {
  const clean = String(sel || "").trim();
  if (!clean) return false;
  try {
    document.createDocumentFragment().querySelector(clean);
    return true;
  } catch {
    return false;
  }
}

export async function notifyTabsBaseUpdated() {
  try {
    const tabs = await chrome.tabs.query({});
    for (const t of tabs) {
      if (t.id) chrome.tabs.sendMessage(t.id, { type: "USER_BASE_UPDATED" }).catch(() => {});
    }
  } catch {}
}
