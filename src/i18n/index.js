// 文案查找：t(key, vars)。缺的 key 先退回简体中文，再退回 key 本身。
// 后续加语言：在 locales 里加一项，并在 locales/ 下放对应文件（结构与 zh-CN.js 相同）。
import zhCN from "./zh-CN.js";

const locales = {
  "zh-CN": zhCN,
};

let current = "zh-CN";

export function setLocale(code) {
  if (locales[code]) current = code;
}

export function locale() {
  return current;
}

export const available = Object.keys(locales);

export function t(key, vars) {
  let text = locales[current]?.[key];
  if (text === undefined) text = zhCN[key];
  if (text === undefined) return key;
  if (vars) {
    text = text.replace(/\{(\w+)\}/g, (match, name) =>
      Object.prototype.hasOwnProperty.call(vars, name)
        ? String(vars[name])
        : match,
    );
  }
  return text;
}
