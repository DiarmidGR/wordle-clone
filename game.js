// Wordle clone — core game logic.
// Faithful recreation of NYT Wordle mechanics:
//  - 6 tries to guess a 5-letter word
//  - Green = right letter, right spot; Yellow = right letter, wrong spot; Gray = absent
//  - Duplicate-letter rule: mark exact matches first, then yellow only while unconsumed copies remain
//  - Daily word from the curated answer list; guesses from the full legal list
//  - Hard mode, high-contrast/colorblind mode, dark theme, stats, share, localStorage persistence

import { ANSWERS, GUESSES, ANSWER_SET, GUESS_SET } from "./wordlists.js";

const ROWS = 6;
const COLS = 5;
const STORAGE_KEY = "wordle-clone-state-v1";

// ---------- State ----------
const defaultState = () => ({
  answerIndex: pickDailyIndex(),
  guess: "",
  row: 0,
  guesses: [],        // array of 5-letter strings
  won: false,
  lost: false,
  busy: false,
  stats: {
    played: 0,
    wins: 0,
    currentStreak: Number(localStorage.getItem("wordle-streak") || 0) || 0,
    maxStreak: Number(localStorage.getItem("wordle-maxstreak") || 0) || 0,
    dist: [0, 0, 0, 0, 0, 0],
  },
  settings: {
    hard: false,
    highContrast: false,
    dark: false,
    sound: true,
  },
});

let state = loadState();

// ---------- Utilities ----------
function dayOfYear() {
  const now = new Date();
  const start = new Date(now.getFullYear(), 0, 0);
  const diff = now - start;
  return Math.floor(diff / 86400000);
}

function pickDailyIndex() {
  // Deterministic daily selection based on the answer list length and today's date.
  const n = ANSWERS.length;
  return dayOfYear() % n;
}

function answerForIndex(i) {
  return ANSWERS[i % ANSWERS.length];
}

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const saved = JSON.parse(raw);
      // Validate the daily answer still matches today's; if the list changed, reset.
      if (saved.answerIndex != null && answerForIndex(saved.answerIndex) === answerForIndex(pickDailyIndex())) {
        return { ...defaultState(), ...saved, stats: { ...defaultState().stats, ...saved.stats } };
      }
    }
  } catch (e) { /* ignore */ }
  return defaultState();
}

function saveState() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    localStorage.setItem("wordle-streak", String(state.stats.currentStreak));
    localStorage.setItem("wordle-maxstreak", String(state.stats.maxStreak));
  } catch (e) { /* ignore */ }
}

// ---------- Scoring (the subtle duplicate-letter rule) ----------
// Returns an array of "correct" | "present" | "absent" for each position.
function scoreGuess(guess) {
  const answer = answerForIndex(state.answerIndex);
  const result = new Array(COLS).fill("absent");
  const ansArr = answer.split("");
  const guessArr = guess.split("");

  // First pass: exact matches consume answer copies.
  const remaining = arrCopy(ansArr);
  for (let i = 0; i < COLS; i++) {
    if (guessArr[i] === answer[i]) {
      result[i] = "correct";
      remaining[i] = null;
    }
  }
  // Second pass: left-to-right, mark yellow only while unconsumed copies remain.
  for (let i = 0; i < COLS; i++) {
    if (result[i] === "correct") continue;
    const idx = remaining.indexOf(guessArr[i]);
    if (idx !== -1) {
      result[i] = "present";
      remaining[idx] = null;
    }
  }
  return result;
}

function arrCopy(a) { return a.slice(); }

// ---------- DOM ----------
const board = document.getElementById("board");
const keyboard = document.getElementById("keyboard");
const toast = document.getElementById("toast");
const KEYBOARD_LAYOUT = [
  "QWERTYUIOP".split(""),
  "ASDFGHJKL".split(""),
  ["ENTER", ..."ZXCVBNM".split(""), "BACK"],
];

// Build the board grid.
function buildBoard() {
  board.innerHTML = "";
  for (let r = 0; r < ROWS; r++) {
    const rowEl = document.createElement("div");
    rowEl.className = "row";
    rowEl.dataset.row = r;
    for (let c = 0; c < COLS; c++) {
      const tile = document.createElement("div");
      tile.className = "tile";
      tile.dataset.col = c;
      rowEl.appendChild(tile);
    }
    board.appendChild(rowEl);
  }
}

// Build the keyboard.
function buildKeyboard() {
  keyboard.innerHTML = "";
  for (const row of KEYBOARD_LAYOUT) {
    const rowEl = document.createElement("div");
    rowEl.className = "kb-row";
    for (const key of row) {
      const k = document.createElement("button");
      k.className = "key";
      k.textContent = key === "BACK" ? "⌫" : key;
      k.dataset.key = key;
      if (key === "ENTER" || key === "BACK") k.classList.add("wide");
      k.addEventListener("click", () => onKey(key));
      rowEl.appendChild(k);
    }
    keyboard.appendChild(rowEl);
  }
}

function currentRowEl() {
  return board.querySelector(`.row[data-row="${state.row}"]`);
}
function tilesInRow(r) {
  const rowEl = board.querySelector(`.row[data-row="${r}"]`);
  return rowEl ? Array.from(rowEl.querySelectorAll(".tile")) : [];
}

// ---------- Input handling ----------
function onKey(key) {
  if (state.busy || state.won || state.lost) return;
  if (key === "ENTER") submitGuess();
  else if (key === "BACK") deleteLetter();
  else if (/^[A-Z]$/.test(key)) addLetter(key);
}

function addLetter(letter) {
  const tiles = tilesInRow(state.row);
  const col = state.guess.length;
  if (col >= COLS) return;
  state.guess += letter;
  tiles[col].textContent = letter;
  tiles[col].classList.add("filled");
  flashTile(tiles[col]);
  playSound("pop");
}

function deleteLetter() {
  const tiles = tilesInRow(state.row);
  const col = state.guess.length - 1;
  if (col < 0) return;
  state.guess = state.guess.slice(0, -1);
  tiles[col].textContent = "";
  tiles[col].classList.remove("filled");
}

function flashTile(tile) {
  tile.animate(
    [{ transform: "scale(1)" }, { transform: "scale(1.15)" }, { transform: "scale(1)" }],
    { duration: 120 }
  );
}

function submitGuess() {
  if (state.guess.length !== COLS) {
    shakeRow();
    showToast("Not enough letters");
    return;
  }
  const guess = state.guess;
  if (!GUESS_SET.has(guess)) {
    shakeRow();
    showToast("Not in word list");
    return;
  }
  // Hard mode: must use all known greens and yellows.
  if (state.settings.hard) {
    if (!matchesHardMode(guess)) {
      shakeRow();
      showToast("Must use revealed hints");
      return;
    }
  }

  state.busy = true;
  const result = scoreGuess(guess);
  state.guesses.push(guess);
  state.guess = "";
  revealRow(result, guess);
}

// Compute the current hint state (which letters are correct/present) for hard mode.
// Returns { correctPositions: {letter: Set<index>}, present: Set<letter>, absent: {letter: Set<index>} }
function getHints() {
  const correctPositions = {};
  const present = {};
  const absent = {};
  for (const g of state.guesses) {
    const res = scoreGuess(g);
    for (let i = 0; i < COLS; i++) {
      const l = g[i];
      if (res[i] === "correct") {
        if (!correctPositions[l]) correctPositions[l] = new Set();
        correctPositions[l].add(i);
        present[l] = true;
      } else if (res[i] === "present") {
        present[l] = true;
      } else if (res[i] === "absent") {
        if (!absent[l]) absent[l] = new Set();
        absent[l].add(i);
      }
    }
  }
  return { correctPositions, present, absent };
}

// Hard mode: every revealed green/yellow letter must be used, greens must stay in
// their confirmed position, and no letter may be placed in a position known to be absent.
function matchesHardMode(guess) {
  const { correctPositions, present, absent } = getHints();

  // Build the set of positions locked to a confirmed green letter (position -> letter).
  // A duplicate letter may still appear at other positions, so we lock positions,
  // not letters.
  const fixed = {};
  for (const letter in correctPositions) {
    for (const pos of correctPositions[letter]) {
      fixed[pos] = letter;
    }
  }

  // Every revealed hint (green or yellow) must appear somewhere in this guess.
  for (const letter of Object.keys(present)) {
    if (!guess.includes(letter)) return false;
  }

  for (let i = 0; i < COLS; i++) {
    const l = guess[i];
    // A confirmed-green position must keep that exact letter (duplicate copies are
    // free to appear elsewhere).
    if (fixed[i] !== undefined && fixed[i] !== l) return false;
    // No letter may be placed in a proven-absent spot.
    if (absent[l] && absent[l].has(i)) return false;
  }
  return true;
}

// ---------- Reveal animation ----------
function revealRow(result, guess) {
  const placedRow = state.row;
  const tiles = tilesInRow(placedRow);
  const rowEl = currentRowEl();

  // Flip each tile in sequence.
  for (let i = 0; i < COLS; i++) {
    setTimeout(() => {
      const t = tiles[i];
      t.classList.add("reveal");
      setTimeout(() => {
        t.classList.add(result[i]);
        playSound("flip");
        updateKeyColor(guess[i], result[i]);
      }, 250);
    }, i * 300);
  }

  const total = COLS * 300;
  setTimeout(() => {
    const won = guess === answerForIndex(state.answerIndex);
    state.row = state.guesses.length; // advance to next row after reveal
    if (won) {
      onWin(placedRow);
    } else if (state.row === ROWS) {
      // Last attempt exhausted -> loss.
      lose();
    }
    state.busy = false;
    saveState();
  }, total + 100);
}

function onWin(placedRow) {
  state.won = true;
  state.stats.played++;
  state.stats.wins++;
  state.stats.currentStreak++;
  state.stats.maxStreak = Math.max(state.stats.maxStreak, state.stats.currentStreak);
  state.stats.dist[placedRow]++;
  saveState();
  // Bounce animation on each tile staggered.
  const tiles = tilesInRow(placedRow);
  tiles.forEach((t, i) => setTimeout(() => t.classList.add("bounce"), i * 100));
  playSound("win");
  setTimeout(() => openStats(), 1400);
}

function lose() {
  state.lost = true;
  state.stats.played++;
  state.stats.currentStreak = 0;
  saveState();
  setTimeout(() => openStats(), 700);
}

function updateKeyColor(letter, status) {
  const key = keyboard.querySelector(`.key[data-key="${letter}"]`);
  if (!key) return;
  const priority = { correct: 3, present: 2, absent: 1 };
  const current = key.className.match(/(correct|present|absent)/);
  const curVal = current ? priority[current[0]] : 0;
  if (priority[status] > curVal) {
    key.classList.remove("correct", "present", "absent");
    key.classList.add(status);
  }
}

// ---------- Row shake ----------
function shakeRow() {
  const rowEl = currentRowEl();
  rowEl.classList.add("shake");
  playSound("wrong");
  setTimeout(() => rowEl.classList.remove("shake"), 500);
}

// ---------- Toast ----------
let toastTimer;
function showToast(msg) {
  toast.textContent = msg;
  toast.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove("show"), 1800);
}

// ---------- Stats / share modal ----------
const statsModal = document.getElementById("stats-modal");
const guessDist = document.getElementById("guess-dist");

function openStats() {
  const s = state.stats;
  document.getElementById("stat-played").textContent = s.played;
  document.getElementById("stat-winstreak").textContent = s.currentStreak;
  document.getElementById("stat-maxstreak").textContent = s.maxStreak;
  // Win rate across played games.
  document.getElementById("stat-pct").textContent = s.played ? Math.round((s.wins / s.played) * 100) : 0;

  renderDist();
  statsModal.classList.remove("hidden");
}

function renderDist() {
  guessDist.innerHTML = "";
  const max = Math.max(1, ...state.stats.dist);
  for (let i = 0; i < ROWS; i++) {
    const col = document.createElement("div");
    col.className = "bar-col" + (i === state.guesses.length - 1 && state.won ? " win" : "");
    const fill = document.createElement("div");
    fill.className = "bar-fill";
    const count = state.stats.dist[i];
    fill.style.height = `${(count / max) * 100}%`;
    fill.textContent = count;
    if (count === 0) fill.style.height = "20px";
    col.appendChild(fill);
    const num = document.createElement("div");
    num.className = "bar-num";
    num.textContent = i + 1;
    col.appendChild(num);
    guessDist.appendChild(col);
  }
}

function shareResults() {
  const answer = answerForIndex(state.answerIndex);
  const lines = [];
  lines.push(`Wordle ${state.guesses.length}/${ROWS}`);
  if (state.lost) lines.push(answer);
  state.guesses.forEach((g) => {
    const res = scoreGuess(g);
    lines.push(res.map((r) => (r === "correct" ? "🟩" : r === "present" ? "🟨" : "⬛")).join(""));
  });
  const text = lines.join("\n");

  // Show the modal as a preview of exactly what gets copied to the clipboard.
  const shareModal = document.createElement("div");
  shareModal.className = "modal-overlay";
  shareModal.innerHTML = `<div class="modal"><button class="modal-close" data-close>&times;</button>
    <pre class="share-preview"></pre></div>`;
  const m = shareModal.querySelector(".modal");
  m.querySelector(".modal-close").addEventListener("click", () => shareModal.remove());
  m.querySelector(".share-preview").textContent = text;
  const btn = document.createElement("button");
  btn.className = "share-btn";
  btn.textContent = "Copy to clipboard";
  btn.style.marginTop = "12px";
  btn.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(text);
      showToast("Copied to clipboard");
    } catch {
      showToast("Copy failed");
    }
    shareModal.remove();
  });
  m.appendChild(btn);
  document.body.appendChild(shareModal);
  shareModal.addEventListener("click", (e) => { if (e.target === shareModal) shareModal.remove(); });
}

// ---------- Settings ----------
const settingsModal = document.getElementById("settings-modal");
function openSettings() {
  document.getElementById("set-hard").checked = state.settings.hard;
  document.getElementById("set-hc").checked = state.settings.highContrast;
  document.getElementById("set-dark").checked = state.settings.dark;
  document.getElementById("set-sound").checked = state.settings.sound;
  settingsModal.classList.remove("hidden");
}
function applySettings() {
  document.body.classList.toggle("dark", !!state.settings.dark);
  document.body.classList.toggle("high-contrast", !!state.settings.highContrast);
}

// ---------- Sound (Web Audio, no assets) ----------
let audioCtx;
function playSound(kind) {
  if (!state.settings.sound) return;
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    const t = audioCtx.currentTime;
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    const freqs = { pop: 220, flip: 440, win: 660, wrong: 140 };
    osc.type = "sine";
    osc.frequency.setValueAtTime(freqs[kind] || 300, t);
    gain.gain.setValueAtTime(0.15, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.15);
    osc.start(t);
    osc.stop(t + 0.15);
  } catch (e) { /* ignore */ }
}

// ---------- New game ----------
function newGame() {
  const { settings } = state;
  state = defaultState();
  state.settings = settings; // preserve user settings (dark mode, hard mode, sound, etc.)
  saveState();
  render();
}

// ---------- Render ----------
function render() {
  buildBoard();
  buildKeyboard();
  // Replay existing guesses if returning mid-game.
  for (let r = 0; r < state.guesses.length; r++) {
    const g = state.guesses[r];
    const res = scoreGuess(g);
    const rowEl = board.querySelector(`.row[data-row="${r}"]`);
    const tiles = rowEl.querySelectorAll(".tile");
    for (let c = 0; c < COLS; c++) {
      tiles[c].textContent = g[c];
      tiles[c].classList.add("filled", res[c]);
    }
    // Apply key colors.
    for (let c = 0; c < COLS; c++) updateKeyColor(g[c], res[c]);
  }
  state.row = state.guesses.length;
  applySettings();
}

// ---------- Keyboard events ----------
window.addEventListener("keydown", (e) => {
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  const k = e.key;
  if (k === "Enter") {
    // Cancel the default action so Enter doesn't also "click" a focused
    // header button (e.g. the theme toggle) and fire its handler twice.
    e.preventDefault();
    onKey("ENTER");
  } else if (k === "Backspace") {
    // Prevent the browser's default "go back" navigation on Backspace.
    e.preventDefault();
    onKey("BACK");
  } else if (/^[a-zA-Z]$/.test(k)) {
    onKey(k.toUpperCase());
  }
});

// ---------- Event wiring ----------
document.getElementById("help-btn").addEventListener("click", () => {
  document.getElementById("help-modal").classList.remove("hidden");
});
document.getElementById("stats-btn").addEventListener("click", () => openStats());
document.getElementById("settings-btn").addEventListener("click", openSettings);
document.getElementById("theme-btn").addEventListener("click", () => {
  state.settings.dark = !state.settings.dark;
  applySettings();
  saveState();
});
document.getElementById("share-btn").addEventListener("click", shareResults);
document.getElementById("play-again-btn").addEventListener("click", () => {
  statsModal.classList.add("hidden");
  newGame();
});

// Settings controls
document.getElementById("set-hard").addEventListener("change", (e) => {
  state.settings.hard = e.target.checked; saveState();
});
document.getElementById("set-hc").addEventListener("change", (e) => {
  state.settings.highContrast = e.target.checked; applySettings(); saveState();
});
document.getElementById("set-dark").addEventListener("change", (e) => {
  state.settings.dark = e.target.checked; applySettings(); saveState();
});
document.getElementById("set-sound").addEventListener("change", (e) => {
  state.settings.sound = e.target.checked; saveState();
});

// Close modals
document.querySelectorAll("[data-close]").forEach((el) =>
  el.addEventListener("click", (e) => e.target.closest(".modal-overlay").classList.add("hidden"))
);
document.querySelectorAll(".modal-overlay").forEach((overlay) =>
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) overlay.classList.add("hidden");
  })
);
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") document.querySelectorAll(".modal-overlay").forEach((m) => m.classList.add("hidden"));
});

// ---------- Init ----------
render();
