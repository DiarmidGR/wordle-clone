// Verify the share modal shows a text preview of what gets copied, plus the
// copy button, all inside the .modal card.
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
function enter() { window.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Enter", cancelable: true })); }

let pass = 0, fail = 0;
const check = (n, c) => { console.log(`  ${c ? "PASS" : "FAIL"}  ${n}`); c ? pass++ : fail++; };

// Play a quick win.
typeWord(dailyAnswer); enter(); await sleep(2000);

// Open the stats modal, then click Share.
document.getElementById("stats-modal").classList.remove("hidden");
document.getElementById("share-btn").dispatchEvent(new window.Event("click"));
await sleep(50);

const overlay = document.querySelector(".modal-overlay:not(.hidden) .share-preview")
  ?.closest(".modal-overlay");
const modal = overlay ? overlay.querySelector(".modal") : null;
const preview = modal ? modal.querySelector(".share-preview") : null;
const btn = modal ? modal.querySelector(".share-btn") : null;

console.log("\n=== Share modal structure ===");
console.log("  overlay exists:", !!overlay);
console.log("  modal exists:", !!modal);
console.log("  share-preview inside modal:", !!preview);
console.log("  copy button inside modal:", !!btn);
console.log("  grid siblings inside overlay (should be 0):", overlay ? overlay.children.length - 1 : -1);

check("overlay exists", !!overlay);
check("modal card exists", !!modal);
check("share-preview is inside the modal card", !!preview);
check("copy-to-clipboard button is inside the modal card", !!btn);
check("no stray siblings floating beside the modal", overlay ? overlay.children.length === 1 : false);

// Sanity: the preview shows the header line and one line of emoji tiles per guess.
if (preview) {
  const content = preview.textContent;
  console.log("  preview content:\n" + content.split("\n").map((l) => "    " + l).join("\n"));
  check("preview starts with the Wordle header", content.startsWith(`Wordle 1/6`));
  check("preview contains emoji tiles", /🟩/.test(content));
}

console.log(`\n==== ${pass} passed, ${fail} failed ====`);
process.exit(fail === 0 ? 0 : 1);
