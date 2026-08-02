import { nextFires, parseCron } from "./cron.js";

const inputEl = document.getElementById("input");
const humanEl = document.getElementById("human");
const nextEl = document.getElementById("next");
const statusEl = document.getElementById("status");
const errorEl = document.getElementById("error");
const btnClear = document.getElementById("btn-clear");
const samples = document.getElementById("samples");

function run() {
  errorEl.hidden = true;
  errorEl.textContent = "";
  const parsed = parseCron(inputEl.value);
  if (!parsed.ok) {
    humanEl.textContent = "";
    nextEl.textContent = "";
    if (!inputEl.value.trim()) {
      statusEl.textContent = "待命";
      statusEl.dataset.tone = "";
      return;
    }
    statusEl.textContent = "無法解析";
    statusEl.dataset.tone = "bad";
    errorEl.hidden = false;
    errorEl.textContent = parsed.error;
    return;
  }
  statusEl.textContent = parsed.hasSeconds ? "6 欄（含秒）" : "5 欄";
  statusEl.dataset.tone = "ok";
  humanEl.textContent = parsed.human.join("\n");
  const fires = nextFires(parsed, new Date(), 8);
  nextEl.textContent = fires.length
    ? fires.map((d, i) => `${i + 1}. ${d.toLocaleString()}（${d.toISOString()}）`).join("\n")
    : "（搜尋範圍內找不到下一次；請檢查日／週組合）";
}

inputEl.addEventListener("input", run);
btnClear.addEventListener("click", () => {
  inputEl.value = "";
  run();
});
samples.addEventListener("click", (ev) => {
  const t = ev.target;
  if (!(t instanceof HTMLElement)) return;
  const expr = t.dataset.cron;
  if (!expr) return;
  inputEl.value = expr;
  run();
});

run();
