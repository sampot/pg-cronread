/**
 * Minimal 5/6-field cron explainer + next-fire estimator (local timezone).
 * Not a full Quartz/AWS cron port — common Unix-style fields only.
 */

const MONTHS = ["一月","二月","三月","四月","五月","六月","七月","八月","九月","十月","十一月","十二月"];
const DOWS = ["日","一","二","三","四","五","六"];

/**
 * @param {string} field
 * @param {number} min
 * @param {number} max
 * @returns {{ ok: true; values: number[] } | { ok: false; error: string }}
 */
export function expandField(field, min, max) {
  const raw = field.trim();
  if (!raw) return { ok: false, error: "欄位為空" };
  /** @type {Set<number>} */
  const set = new Set();

  const addRange = (a, b, step) => {
    if (a > b || a < min || b > max || step < 1) return false;
    for (let i = a; i <= b; i += step) set.add(i);
    return true;
  };

  for (const part of raw.split(",")) {
    const p = part.trim();
    if (!p) return { ok: false, error: `無效片段：${part}` };
    if (p === "*") {
      addRange(min, max, 1);
      continue;
    }
    if (p.includes("/")) {
      const [base, stepStr] = p.split("/");
      const step = Number(stepStr);
      if (!Number.isInteger(step) || step < 1) return { ok: false, error: `步進無效：${p}` };
      if (base === "*") {
        addRange(min, max, step);
      } else if (base.includes("-")) {
        const [a, b] = base.split("-").map(Number);
        if (!addRange(a, b, step)) return { ok: false, error: `範圍無效：${p}` };
      } else {
        const a = Number(base);
        if (!addRange(a, max, step)) return { ok: false, error: `範圍無效：${p}` };
      }
      continue;
    }
    if (p.includes("-")) {
      const [a, b] = p.split("-").map(Number);
      if (!addRange(a, b, 1)) return { ok: false, error: `範圍無效：${p}` };
      continue;
    }
    const n = Number(p);
    if (!Number.isInteger(n) || n < min || n > max) {
      return { ok: false, error: `數值超出 ${min}–${max}：${p}` };
    }
    set.add(n);
  }
  return { ok: true, values: [...set].sort((a, b) => a - b) };
}

/**
 * @typedef {{
 *   ok: true;
 *   fields: { second?: number[]; minute: number[]; hour: number[]; dom: number[]; month: number[]; dow: number[] };
 *   hasSeconds: boolean;
 *   human: string[];
 * } | { ok: false; error: string }} CronParse
 */

/**
 * @param {string} expr
 * @returns {CronParse}
 */
export function parseCron(expr) {
  const parts = expr.trim().split(/\s+/u).filter(Boolean);
  if (parts.length !== 5 && parts.length !== 6) {
    return { ok: false, error: "請輸入 5 欄（分 時 日 月 週）或 6 欄（秒 分 時 日 月 週）。" };
  }
  const hasSeconds = parts.length === 6;
  const [secF, minF, hourF, domF, monF, dowF] = hasSeconds
    ? parts
    : [null, parts[0], parts[1], parts[2], parts[3], parts[4]];

  const second = hasSeconds ? expandField(secF, 0, 59) : { ok: true, values: [0] };
  const minute = expandField(minF, 0, 59);
  const hour = expandField(hourF, 0, 23);
  const dom = expandField(domF, 1, 31);
  const month = expandField(monF, 1, 12);
  const dow = expandField(dowF, 0, 7);
  for (const x of [second, minute, hour, dom, month, dow]) {
    if (!x.ok) return x;
  }
  // normalize 7 → 0 for Sunday
  const dowVals = [...new Set(dow.values.map((d) => (d === 7 ? 0 : d)))].sort(
    (a, b) => a - b
  );

  const describeList = (vals, allMin, allMax, mapFn) => {
    if (vals.length === allMax - allMin + 1) return "全部";
    if (vals.length > 12) return `${vals.length} 個值`;
    return vals.map((v) => (mapFn ? mapFn(v) : String(v))).join("、");
  };

  /** @type {string[]} */
  const human = [];
  if (hasSeconds) {
    human.push(
      second.values.length === 60
        ? "每一秒"
        : `秒：${describeList(second.values, 0, 59)}`
    );
  }
  human.push(
    minute.values.length === 60 ? "每一分" : `分：${describeList(minute.values, 0, 59)}`
  );
  human.push(
    hour.values.length === 24 ? "每一時" : `時：${describeList(hour.values, 0, 23)}`
  );
  human.push(
    dom.values.length === 31
      ? "每日"
      : `日：${describeList(dom.values, 1, 31)}`
  );
  human.push(
    month.values.length === 12
      ? "每月"
      : `月：${describeList(month.values, 1, 12, (m) => MONTHS[m - 1])}`
  );
  human.push(
    dowVals.length === 7
      ? "每週各日"
      : `週：${dowVals.map((d) => `週${DOWS[d]}`).join("、")}`
  );

  return {
    ok: true,
    hasSeconds,
    fields: {
      ...(hasSeconds ? { second: second.values } : {}),
      minute: minute.values,
      hour: hour.values,
      dom: dom.values,
      month: month.values,
      dow: dowVals,
    },
    human,
  };
}

/**
 * @param {Extract<CronParse, { ok: true }>} parsed
 * @param {Date} from
 * @param {number} count
 * @returns {Date[]}
 */
export function nextFires(parsed, from, count = 5) {
  const { minute, hour, dom, month, dow } = parsed.fields;
  const seconds = parsed.fields.second ?? [0];
  /** @type {Date[]} */
  const out = [];
  const cursor = new Date(from.getTime());
  cursor.setMilliseconds(0);
  if (parsed.hasSeconds) {
    cursor.setSeconds(cursor.getSeconds() + 1);
  } else {
    cursor.setSeconds(0);
    cursor.setMinutes(cursor.getMinutes() + 1);
  }

  // Cap search (~2 years of minutes, or seconds for 6-field)
  const maxSteps = parsed.hasSeconds ? 366 * 24 * 60 * 60 : 366 * 24 * 60;
  for (let i = 0; i < maxSteps && out.length < count; i++) {
    const m = cursor.getMonth() + 1;
    const d = cursor.getDate();
    const h = cursor.getHours();
    const mi = cursor.getMinutes();
    const s = cursor.getSeconds();
    const w = cursor.getDay();
    if (
      month.includes(m) &&
      dom.includes(d) &&
      dow.includes(w) &&
      hour.includes(h) &&
      minute.includes(mi) &&
      seconds.includes(s)
    ) {
      out.push(new Date(cursor.getTime()));
      if (!parsed.hasSeconds) {
        cursor.setMinutes(cursor.getMinutes() + 1);
        cursor.setSeconds(0);
        continue;
      }
    }
    if (parsed.hasSeconds) {
      cursor.setSeconds(cursor.getSeconds() + 1);
    } else {
      cursor.setMinutes(cursor.getMinutes() + 1);
      cursor.setSeconds(0);
    }
  }
  return out;
}
