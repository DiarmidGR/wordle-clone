// Verification harness for the fixes.
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
function enter() { window.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Enter" })); }
function keyClass(letter) {
  const k = document.querySelector(`.key[data-key="${letter}"]`);
  return k ? (k.className.match(/(correct|present|absent)/) || ["none"])[0] : "(no key)";
}
function isDark() { return document.body.classList.contains("dark"); }

let pass = 0, fail = 0;
function check(name, cond) { console.log(`  ${cond ? "PASS" : "FAIL"}  ${name}`); cond ? pass++ : fail++; }

// ---------- Fix 1: dark mode absent keys distinguishable ----------
console.log("\n=== Fix 1: dark-mode absent key color ===");
// jsdom doesn't apply CSS, so verify the stylesheet itself gives absent keys a
// color distinct from the default key in dark mode.
const css = readFileSync(new URL("./styles.css", import.meta.url), "utf8");
const darkBlock = css.substring(css.indexOf(".dark {"), css.indexOf("}", css.indexOf(".dark {")));
const keyBgMatch = darkBlock.match(/--key-bg:\s*#([0-9a-fA-F]{6})/);
const grayMatch = darkBlock.match(/--gray:\s*#([0-9a-fA-F]{6})/);
const keyBg = keyBgMatch ? keyBgMatch[1].toUpperCase() : "(none)";
const gray = grayMatch ? grayMatch[1].toUpperCase() : "(none)";
console.log(`  dark --key-bg: ${keyBg} | dark --gray: ${gray}`);
check("dark --gray differs from --key-bg (absent visible)", keyBg !== gray);

document.getElementById("theme-btn").dispatchEvent(new window.Event("click")); // enable dark
await sleep(10);
console.log("  dark enabled:", isDark());
typeWord("CRANE"); enter(); await sleep(2300);
check("absent key is grayed (absent)", keyClass("E") === "absent");
check("correct key marked correct", keyClass("R") === "correct");
check("absent keys C/A/N also grayed", ["C","A","N"].every(l => keyClass(l) === "absent"));

// ---------- Fix 2: bounce on the winning row (first-try win) ----------
console.log("\n=== Fix 2: bounce on winning row ===");
document.getElementById("play-again-btn").dispatchEvent(new window.Event("click"));
await sleep(150);
typeWord(dailyAnswer); enter(); await sleep(3000);
const row0Bounce = document.querySelectorAll('.row[data-row="0"] .tile.bounce').length;
const otherRows = [];
document.querySelectorAll(".row").forEach((r) => {
  if (r.dataset.row !== "0") {
    const n = r.querySelectorAll(".tile.bounce").length;
    if (n) otherRows.push(`row${r.dataset.row}(${n})`);
  }
});
check("row 0 has 5 bounce tiles", row0Bounce === 5);
check("no bounce on other rows", otherRows.length === 0);

// ---------- Fix 3: dark mode persists through Play Again ----------
console.log("\n=== Fix 3: dark mode + settings persist through Play Again ===");
document.getElementById("play-again-btn").dispatchEvent(new window.Event("click"));
await sleep(150);
check("dark still on after Play Again", isDark());
// enable hard mode, then play again, verify it persists
document.getElementById("set-hard").checked = true; // flip switch before change event
document.getElementById("set-hard").dispatchEvent(new window.Event("change"));
await sleep(50);
const hardBefore = document.getElementById("set-hard").checked;
document.getElementById("play-again-btn").dispatchEvent(new window.Event("click"));
await sleep(150);
const hardAfter = document.getElementById("set-hard").checked;
check("hard mode persisted through Play Again", hardBefore && hardAfter);

console.log(`\n==== ${pass} passed, ${fail} failed ====`);
process.exit(fail === 0 ? 0 : 1);
