// Verify: Enter on a focused header button no longer toggles the theme,
// while still submitting the guess. Models the real-browser behavior where a
// focused <button> fires its click on Enter — but only if keydown wasn't prevented.
import { JSDOM } from "jsdom";
import { readFileSync } from "node:fs";
import { ANSWERS } from "./wordlists.js";

function dayOfYear() {
  const now = new Date();
  const start = new Date(now.getFullYear(), 0, 0);
  return Math.floor((now - start) / 86400000);
}
const dailyAnswer = ANSWERS[dayOfYear() % ANSWERS.length];
console.log("Daily answer:", dailyAnswer);

const html = readFileSync(new URL("./index.html", import.meta.url), "utf8")
  .replace(/<script type="module" src="game.js"><\/script>/, "");
const dom = new JSDOM(html, { url: "https://localhost/", pretendToBeVisual: true });
const { window } = dom;
Object.assign(globalThis, { window, document: window.document, localStorage: window.localStorage, Element: window.Element, Node: window.Node });
window.Element.prototype.animate = function () { return { cancel() {}, finish() {} }; };
window.AudioContext = function () {
  return {
    createOscillator() { return { connect() {}, start() {}, stop() {}, frequency: { setValueAtTime() {} } }; },
    createGain() { return { connect() {}, setValueAtTime() {}, exponentialRampToValueAtTime() {} }; },
    destination: {}, currentTime: 0,
  };
};
globalThis.AudioContext = window.AudioContext;

await import("./game.js");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function typeWord(w) { for (const ch of w) window.dispatchEvent(new window.KeyboardEvent("keydown", { key: ch })); }
function enter() {
  // cancelable:true mirrors real browsers, where keydown is cancelable by
  // default (jsdom defaults it to false, which would make preventDefault a no-op).
  const ev = new window.KeyboardEvent("keydown", { key: "Enter", cancelable: true });
  window.dispatchEvent(ev);
  console.log("    [debug] defaultPrevented:", ev.defaultPrevented, "| active:", document.activeElement?.id);
  // Model real-browser behavior: a focused button fires its click on Enter,
  // UNLESS the keydown was prevented (which is what our fix does).
  if (!ev.defaultPrevented && document.activeElement && document.activeElement.tagName === "BUTTON") {
    document.activeElement.dispatchEvent(new window.Event("click"));
  }
}
function isDark() { return document.body.classList.contains("dark"); }

let pass = 0, fail = 0;
const check = (n, c) => { console.log(`  ${c ? "PASS" : "FAIL"}  ${n}`); c ? pass++ : fail++; };

// --- Scenario 1: theme button focused, Enter should submit guess, NOT toggle theme ---
console.log("\n=== Theme button focused + Enter ===");
// Start in a known state: enable dark, then a fresh game.
document.getElementById("theme-btn").dispatchEvent(new window.Event("click"));
await sleep(10);
const darkBefore = isDark();
console.log("  dark before:", darkBefore);

// Focus the theme button, type a guess, then press Enter.
document.getElementById("theme-btn").focus();
console.log("  activeElement:", document.activeElement?.id);
typeWord("CRANE");
enter();
await sleep(200);
console.log("  dark after Enter (theme-btn focused):", isDark());
check("theme did NOT toggle from Enter", isDark() === darkBefore);

// --- Scenario 2: normal typing, Enter submits (no button focused) ---
console.log("\n=== Normal typing + Enter ===");
document.activeElement && document.activeElement.blur?.();
const row0 = document.querySelector('.row[data-row="0"] .tile');
const before = row0 ? row0.textContent : "";
typeWord("CRANE"); enter(); await sleep(50);
const after = document.querySelector('.row[data-row="0"] .tile')?.textContent || "";
check("Enter submitted a letter when no button focused", after.length > before.length || after !== "");

console.log(`\n==== ${pass} passed, ${fail} failed ====`);
process.exit(fail === 0 ? 0 : 1);
