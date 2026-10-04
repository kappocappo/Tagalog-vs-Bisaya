/* Tagalog vs Bisaya — Snake (PWA / mobile edition)
 * Single-player only. Swipe or arrow keys to steer.
 */
"use strict";

const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");

// roundRect polyfill for older Android WebViews
if (typeof CanvasRenderingContext2D !== "undefined" && !CanvasRenderingContext2D.prototype.roundRect) {
  CanvasRenderingContext2D.prototype.roundRect = function (x, y, w, h, r) {
    const rr = typeof r === "number" ? r : 8;
    this.moveTo(x + rr, y);
    this.arcTo(x + w, y, x + w, y + h, rr);
    this.arcTo(x + w, y + h, x, y + h, rr);
    this.arcTo(x, y + h, x, y, rr);
    this.arcTo(x, y, x + w, y, rr);
    this.closePath();
    return this;
  };
}

const COL = {
  bg: "#0c0d14", bg2: "#16182a", grid: "rgba(255,255,255,0.055)",
  gridBold: "rgba(255,255,255,0.1)", white: "#f2f3fa",
  green: "#3fe07f", head: "#8dffab", blue: "#5aa8ff",
  red: "#ff5d5d", yellow: "#ffd246", gray: "#9aa0b4",
};
const START_FPS = 8;
const HUD_TOP = 52; // px reserved for HUD pill overlay

// ── Assets ────────────────────────────────────────────────────────────────
const IMGS_TAGALOG = {}, IMGS_BISAYA = {};
let IMGS = IMGS_TAGALOG; // sprites of the selected snake (used by drawSnake)
const SOUNDS = {};
let foodImg = null;
let playerSnake = "tagalog"; // "tagalog" | "bisaya"
const music = new Audio("assets/audio/bg_music_lobby.mp3");
music.loop = true;
music.volume = 0.5;

function loadImage(src) {
  return new Promise((res) => {
    const img = new Image();
    img.onload = () => res(img);
    img.onerror = () => res(null);
    img.src = src;
  });
}

const SNAKE_ANIM_FPS = 8;
const FOOD_ANIM_FPS = 6;
let foodFrames = [];
function animFrame(frames, fps) {
  if (!frames || !frames.length) return null;
  if (frames.length === 1) return frames[0];
  return frames[(performance.now() / (1000 / fps) | 0) % frames.length];
}
async function loadFrames(base, part, maxN = 16) {
  // supports `<part>.png` (static) AND `<part>_0.png`, `<part>_1.png`, …
  const frames = [];
  const first = await loadImage(`${base}/${part}.png`);
  if (first) frames.push(first);
  for (let i = 0; i < maxN; i++) {
    const f = await loadImage(`${base}/${part}_${i}.png`);
    if (!f) break;
    frames.push(f);
  }
  return frames;
}

async function loadAssets() {
  const parts = ["head", "body", "corner", "tail"];
  for (const p of parts) {
    IMGS_TAGALOG[p] = await loadFrames("assets/p1", p);
    IMGS_BISAYA[p] = await loadFrames("assets/p2", p);
  }
  // food: every PNG in assets/food becomes a frame; keep legacy single file too
  foodFrames = [];
  const knownFood = await loadImage(
    "assets/food/785058659_1053053574250803_8373239390610118887_n.png"
  );
  if (knownFood) foodFrames.push(knownFood);
  for (let i = 0; i < 16; i++) {
    const f = await loadImage(`assets/food/food_${i}.png`);
    if (!f) break;
    foodFrames.push(f);
  }
  const genericFood = await loadImage("assets/food/food.png");
  if (genericFood && !foodFrames.length) foodFrames.push(genericFood);
  foodImg = foodFrames[0] || null;
  for (const n of ["tagalog_eat", "tagalog_death", "tagalog_win",
                   "bisaya_eat", "bisaya_death", "bisaya_win"]) {
    const a = new Audio(`assets/audio/${n}.mp3`);
    a.volume = 0.5;
    SOUNDS[n] = a;
  }
}
function play(name) {
  const s = SOUNDS[name];
  if (s) { s.currentTime = 0; s.play().catch(() => {}); }
}

// ── Board / sizing ────────────────────────────────────────────────────────
let cols = 30, rows = 20, cell = 20, offX = 0, offY = 0;
let dpr = Math.max(1, window.devicePixelRatio || 1);

function resizeCanvas(recalcGrid) {
  dpr = Math.max(1, window.devicePixelRatio || 1);
  canvas.width = innerWidth * dpr;
  canvas.height = innerHeight * dpr;
  canvas.style.width = innerWidth + "px";
  canvas.style.height = innerHeight + "px";
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  if (recalcGrid) computeGrid();
  fitBoard();
}

function computeGrid() {
  const target = 26; // aim ~26 css px per cell
  cols = Math.min(60, Math.max(12, Math.round(innerWidth / target)));
  rows = Math.min(60, Math.max(12, Math.round((innerHeight - HUD_TOP) / target)));
}

function fitBoard() {
  cell = Math.floor(Math.min(innerWidth / cols, (innerHeight - HUD_TOP) / rows));
  offX = Math.floor((innerWidth - cols * cell) / 2);
  offY = HUD_TOP + Math.floor((innerHeight - HUD_TOP - rows * cell) / 2);
}
window.addEventListener("resize", () => resizeCanvas(state === "menu"));
window.addEventListener("orientationchange", () => resizeCanvas(state === "menu"));

// ── Scores (localStorage replaces scores.json) ────────────────────────────
function loadScores() {
  try { return JSON.parse(localStorage.getItem("snake_scores")) || []; }
  catch { return []; }
}
function addScore(name, score) {
  const scores = loadScores();
  scores.push({ name: (name || "Player").slice(0, 12), score });
  scores.sort((a, b) => b.score - a.score);
  localStorage.setItem("snake_scores", JSON.stringify(scores.slice(0, 10)));
}

// ── Snake drawing with rotated assets ─────────────────────────────────────
const TURN_ANGLE = {
  right: { "1,0": 0, "0,-1": -Math.PI / 2, "-1,0": Math.PI, "0,1": Math.PI / 2 },
  left:  { "1,0": 0, "0,1": -Math.PI / 2, "-1,0": Math.PI, "0,-1": Math.PI / 2 },
};
function swayFor(dirArr, index, total) {
  // visual-only slither: head locked, tail waves, ~20% cell max
  if (total <= 1 || index === 0) return [0, 0];
  const [dx, dy] = dirArr;
  const px = -dy, py = dx;
  const amp = cell * 0.20 * (index / (total - 1));
  const s = Math.sin(performance.now() / 150 - index * 0.5) * amp;
  return [px * s, py * s];
}
function drawPart(img, gridPos, angle, glow, ox = 0, oy = 0) {
  const x = offX + gridPos[0] * cell + ox;
  const y = offY + gridPos[1] * cell + oy;
  ctx.save();
  ctx.translate(x + cell / 2, y + cell / 2);
  ctx.rotate(angle);
  if (glow) { ctx.shadowColor = glow; ctx.shadowBlur = 10; }
  const s = cell * 1.04;
  ctx.drawImage(img, -s / 2, -s / 2, s, s);
  ctx.restore();
}
function dirAngle(d) {
  return d === "1,0" ? 0 : d === "0,-1" ? -Math.PI / 2 : d === "-1,0" ? Math.PI : Math.PI / 2;
}
function partImg(set, part) {
  const v = set[part];
  if (Array.isArray(v)) return animFrame(v, SNAKE_ANIM_FPS);
  return v || null; // backward compat if something stored a single Image
}
function drawSnake(snake) {
  const n = snake.length;
  if (n === 0) return;
  const base = snakeColor();
  const glow = playerSnake === "bisaya" ? "rgba(90,168,255,0.9)" : "rgba(63,224,127,0.9)";
  // tail: direction from tail toward the rest of the body (authored facing-left png)
  if (n >= 2) {
    const d = [snake[n - 2][0] - snake[n - 1][0], snake[n - 2][1] - snake[n - 1][1]];
    const [ox, oy] = swayFor(d, n - 1, n);
    const tailImg = partImg(IMGS, "tail");
    if (tailImg) drawPart(tailImg, snake[n - 1], dirAngle(d.join(",")), glow, ox, oy);
    else fallback(snake[n - 1], base, false, ox, oy);
  }
  // body
  for (let i = 1; i < n - 1; i++) {
    const incArr = [snake[i][0] - snake[i - 1][0], snake[i][1] - snake[i - 1][1]];
    const inc = incArr.join(",");
    const out = [snake[i + 1][0] - snake[i][0], snake[i + 1][1] - snake[i][1]].join(",");
    const incD = inc.split(",").map(Number), outD = out.split(",").map(Number);
    const isCorner = incD[0] !== outD[0] || incD[1] !== outD[1];
    let [ox, oy] = swayFor(incArr, i, n);
    if (isCorner) { ox *= 0.5; oy *= 0.5; }
    const cornerImg = partImg(IMGS, "corner");
    const bodyImg = partImg(IMGS, "body");
    if (isCorner && cornerImg) {
      const rightMap = { "1,0": "0,1", "0,1": "-1,0", "-1,0": "0,-1", "0,-1": "1,0" };
      const kind = rightMap[inc] === out ? "right" : "left";
      drawPart(cornerImg, snake[i], TURN_ANGLE[kind][inc] || 0, glow, ox, oy);
    } else if (bodyImg) {
      drawPart(bodyImg, snake[i], dirAngle(inc), glow, ox, oy);
    } else fallback(snake[i], base, false, ox, oy);
  }
  // head stays grid-locked so aiming/eating feels precise
  const hd = n >= 2
    ? [snake[0][0] - snake[1][0], snake[0][1] - snake[1][1]].join(",")
    : "1,0";
  const headImg = partImg(IMGS, "head");
  if (headImg) drawPart(headImg, snake[0], dirAngle(hd), glow);
  else fallback(snake[0], "#c8ffe0", true);
}
function snakeColor() {
  return playerSnake === "bisaya" ? COL.blue : COL.green;
}
function fallback(pos, color, isHead, ox = 0, oy = 0) {
  const x = offX + pos[0] * cell + ox, y = offY + pos[1] * cell + oy;
  const pad = Math.max(1.5, cell * 0.08);
  const r = Math.min(cell * 0.32, 8);
  ctx.save();
  ctx.shadowColor = color;
  ctx.shadowBlur = isHead ? 14 : 8;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.roundRect(x + pad, y + pad, cell - pad * 2, cell - pad * 2, r);
  ctx.fill();
  ctx.shadowBlur = 0;
  // glossy highlight
  ctx.fillStyle = "rgba(255,255,255,0.28)";
  ctx.beginPath();
  ctx.roundRect(x + pad + 1, y + pad + 1, cell - pad * 2, (cell - pad * 2) * 0.38, [r, r, 0, 0]);
  ctx.fill();
  ctx.restore();
}
const MOTES = [];
function initMotes() {
  MOTES.length = 0;
  const tints = ["63,224,127", "90,168,255", "255,210,70"];
  for (let i = 0; i < 42; i++) {
    MOTES.push({
      x0: Math.random(), y0: Math.random(),
      vx: -0.008 + Math.random() * 0.02, vy: -0.010 + Math.random() * 0.014,
      r: 1.5 + Math.random() * 2.8, ph: Math.random() * 6.28,
      c: tints[i % tints.length],
    });
  }
}
function drawMotes(now) {
  const t = now / 1000;
  for (const m of MOTES) {
    const x = ((m.x0 + m.vx * t) % 1 + 1) % 1 * innerWidth;
    const y = ((m.y0 + m.vy * t) % 1 + 1) % 1 * innerHeight;
    const tw = 0.5 + 0.5 * Math.sin(t * 1.6 + m.ph);
    ctx.save();
    ctx.globalAlpha = 0.10 + 0.22 * tw;
    ctx.fillStyle = `rgb(${m.c})`;
    ctx.shadowColor = `rgba(${m.c},0.9)`;
    ctx.shadowBlur = 8;
    ctx.beginPath();
    ctx.arc(x, y, m.r * (0.8 + 0.4 * tw), 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
}
function drawBoard() {
  const now = performance.now();
  // soft arena gradient (no harsh grid)
  const g = ctx.createLinearGradient(0, 0, 0, innerHeight);
  g.addColorStop(0, "#1a1e35");
  g.addColorStop(0.45, COL.bg2);
  g.addColorStop(1, COL.bg);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, innerWidth, innerHeight);
  // soft center glow
  const rg = ctx.createRadialGradient(
    innerWidth / 2, innerHeight / 2, 10,
    innerWidth / 2, innerHeight / 2, Math.max(innerWidth, innerHeight) * 0.65);
  rg.addColorStop(0, "rgba(90,140,255,0.07)");
  rg.addColorStop(0.5, "rgba(63,224,127,0.05)");
  rg.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = rg;
  ctx.fillRect(0, 0, innerWidth, innerHeight);

  const bw = cols * cell, bh = rows * cell;
  // board panel
  ctx.save();
  ctx.shadowColor = "rgba(0,0,0,0.6)";
  ctx.shadowBlur = 30;
  ctx.shadowOffsetY = 10;
  ctx.fillStyle = "rgba(10,11,20,0.72)";
  ctx.beginPath();
  ctx.roundRect(offX - 8, offY - 8, bw + 16, bh + 16, 14);
  ctx.fill();
  ctx.restore();

  ctx.save();
  ctx.beginPath();
  ctx.roundRect(offX, offY, bw, bh, 8);
  ctx.clip();
  // faint dot lattice every 2 cells (calm, no lines)
  ctx.fillStyle = "rgba(255,255,255,0.07)";
  for (let y = 0; y <= rows; y += 2) {
    for (let x = 0; x <= cols; x += 2) {
      ctx.beginPath();
      ctx.arc(offX + x * cell, offY + y * cell, 1.6, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.restore();
  drawMotes(now);
  // vignette over everything
  const vg = ctx.createRadialGradient(
    innerWidth / 2, innerHeight / 2, Math.min(innerWidth, innerHeight) * 0.35,
    innerWidth / 2, innerHeight / 2, Math.max(innerWidth, innerHeight) * 0.75);
  vg.addColorStop(0, "rgba(0,0,0,0)");
  vg.addColorStop(1, "rgba(0,0,0,0.42)");
  ctx.fillStyle = vg;
  ctx.fillRect(0, 0, innerWidth, innerHeight);
  // crisp arena border with snake-tinted glow
  ctx.save();
  ctx.strokeStyle = playerSnake === "bisaya" ? "rgba(90,168,255,0.45)" : "rgba(63,224,127,0.45)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.roundRect(offX - 1, offY - 1, bw + 2, bh + 2, 9);
  ctx.stroke();
  ctx.restore();
}
function drawFood(food) {
  if (!food) return;
  const cx = offX + food[0] * cell + cell / 2;
  const cy = offY + food[1] * cell + cell / 2;
  const pulse = 1 + Math.sin(performance.now() / 280) * 0.07;
  const frame = animFrame(foodFrames, FOOD_ANIM_FPS) || foodImg;
  if (frame) {
    const s = cell * 1.06 * pulse;
    ctx.save();
    ctx.shadowColor = "rgba(255,90,90,0.8)";
    ctx.shadowBlur = 16;
    ctx.drawImage(frame, cx - s / 2, cy - s / 2, s, s);
    ctx.restore();
    return;
  }
  ctx.save();
  ctx.shadowColor = COL.red;
  ctx.shadowBlur = 16;
  ctx.fillStyle = COL.red;
  ctx.beginPath();
  ctx.arc(cx, cy, (cell / 2 - 2) * pulse, 0, Math.PI * 2);
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.fillStyle = "rgba(255,255,255,0.55)";
  ctx.beginPath();
  ctx.arc(cx - cell * 0.12, cy - cell * 0.14, cell * 0.11, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

// ── Game state ────────────────────────────────────────────────────────────
let state = "menu"; // menu | name | playing | over | leaderboard
let snake, dir, nextDir, food, score, stepMs, lastStep, playerName;

function randomFood() {
  const free = [];
  const occupied = new Set(snake.map(([x, y]) => x + "," + y));
  for (let x = 0; x < cols; x++) for (let y = 0; y < rows; y++)
    if (!occupied.has(x + "," + y)) free.push([x, y]);
  return free.length ? free[(Math.random() * free.length) | 0] : null;
}

function startGame() {
  computeGrid(); fitBoard();
  const cx = cols >> 1, cy = rows >> 1;
  snake = [[cx, cy], [cx - 1, cy], [cx - 2, cy]];
  dir = [1, 0]; nextDir = dir;
  score = 0;
  stepMs = 1000 / START_FPS;
  food = randomFood();
  state = "playing";
  document.getElementById("hud-player").textContent = playerName;
  document.getElementById("hud-score").textContent = "Score: 0";
  show(null, ["hud"]);
  music.pause();
}

function step() {
  dir = nextDir;
  const [hx, hy] = snake[0];
  const nx = hx + dir[0], ny = hy + dir[1];
  const hitWall = nx < 0 || nx >= cols || ny < 0 || ny >= rows;
  const willEat = food && nx === food[0] && ny === food[1];
  const body = willEat ? snake : snake.slice(0, -1);
  const hitSelf = body.some(([x, y]) => x === nx && y === ny);
  if (hitWall || hitSelf) {
    play(playerSnake + "_death");
    endGame();
    return;
  }
  snake.unshift([nx, ny]);
  if (willEat) {
    play(playerSnake + "_eat");
    spawnPopup(nx, ny);
    score += 10;
    stepMs = Math.max(1000 / 25, 1000 / (START_FPS + Math.floor(score / 50)));
    document.getElementById("hud-score").textContent = "Score: " + score;
    food = randomFood();
    if (food === null) { endGame(); return; }
  } else {
    snake.pop();
  }
}

function endGame() {
  state = "over";
  if (score > 0) addScore(playerName, score);
  document.getElementById("final-score").textContent = "Score: " + score;
  show("game-over", ["hud"]);
  music.play().catch(() => {});
}

const POPUP_WORDS = ["SARAP!", "LAMI!", "YUMMY!", "NOM NOM!", "TAMIS!", "LAMON!", "+10", "SHEESH!"];
const POPUP_COLORS = ["#ffd246", "#3fe07f", "#ffffff", "#ff9d9d", "#a8d4ff"];
const popups = [];
function spawnPopup(gx, gy) {
  popups.push({
    gx, gy,
    text: POPUP_WORDS[(Math.random() * POPUP_WORDS.length) | 0],
    color: POPUP_COLORS[(Math.random() * POPUP_COLORS.length) | 0],
    born: performance.now(), life: 950,
  });
}
function drawPopups() {
  const now = performance.now();
  for (let i = popups.length - 1; i >= 0; i--) {
    const p = popups[i];
    const age = now - p.born;
    if (age >= p.life) { popups.splice(i, 1); continue; }
    const t = age / p.life;
    const rise = cell * 1.8 * t;
    const scale = 1 + 0.6 * Math.exp(-age / 130);
    const alpha = t < 0.6 ? 1 : 1 - (t - 0.6) / 0.4;
    const cx = offX + p.gx * cell + cell / 2;
    const cy = offY + p.gy * cell - rise;
    const size = Math.max(15, cell * 0.85) * scale;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.font = `900 ${size}px system-ui, Arial, sans-serif`;
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.lineWidth = Math.max(2, size * 0.12);
    ctx.strokeStyle = "rgba(0,0,0,0.85)";
    ctx.strokeText(p.text, cx, cy);
    ctx.fillStyle = p.color;
    ctx.shadowColor = p.color; ctx.shadowBlur = 12;
    ctx.fillText(p.text, cx, cy);
    ctx.restore();
  }
}

let rafId = null;
function loop(t) {
  rafId = requestAnimationFrame(loop);
  if (state !== "playing") return;
  if (t - lastStep >= stepMs) {
    lastStep = t;
    step();
  }
  drawBoard();
  drawFood(food);
  drawSnake(snake);
  drawPopups();
}

// ── Input ─────────────────────────────────────────────────────────────────
function setDir(d) {
  const opposites = { up: [0, 1], down: [0, -1], left: [1, 0], right: [-1, 0] };
  const v = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] }[d];
  const opp = opposites[d];
  if (dir[0] !== opp[0] || dir[1] !== opp[1]) nextDir = v;
}
window.addEventListener("keydown", (e) => {
  if (state !== "playing") return;
  const map = { ArrowUp: "up", w: "up", W: "up", ArrowDown: "down", s: "down", S: "down",
                ArrowLeft: "left", a: "left", A: "left", ArrowRight: "right", d: "right", D: "right" };
  if (map[e.key]) { setDir(map[e.key]); e.preventDefault(); }
  if (e.key === "Escape") { endGame(); }
});
let touchStart = null;
canvas.addEventListener("touchstart", (e) => {
  touchStart = [e.touches[0].clientX, e.touches[0].clientY];
}, { passive: true });
canvas.addEventListener("touchend", (e) => {
  if (!touchStart) return;
  const dx = e.changedTouches[0].clientX - touchStart[0];
  const dy = e.changedTouches[0].clientY - touchStart[1];
  touchStart = null;
  if (Math.abs(dx) < 20 && Math.abs(dy) < 20) return;
  setDir(Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? "right" : "left") : (dy > 0 ? "down" : "up"));
}, { passive: true });

// ── UI wiring ─────────────────────────────────────────────────────────────
const overlays = ["menu", "snake-select", "name-screen", "leaderboard", "game-over"];
function show(overlayId, alsoShow = []) {
  for (const id of overlays) document.getElementById(id).classList.add("hidden");
  document.getElementById("hud").classList.add("hidden");
  if (overlayId) document.getElementById(overlayId).classList.remove("hidden");
  for (const id of alsoShow) document.getElementById(id).classList.remove("hidden");
}
document.querySelectorAll("[data-action]").forEach((el) => {
  el.addEventListener("click", () => {
    const a = el.dataset.action;
    if (a === "play") { state = "snake-select"; show("snake-select"); }
    else if (a === "leaderboard") { renderScores(); state = "leaderboard"; show("leaderboard"); }
    else if (a === "back" || a === "menu") { state = "menu"; show("menu"); }
    else if (a === "back-to-snake") { state = "snake-select"; show("snake-select"); }
    else if (a === "quit") { show("menu"); }
  });
});
document.querySelectorAll("[data-snake]").forEach((el) => {
  el.addEventListener("click", () => {
    playerSnake = el.dataset.snake; // "tagalog" or "bisaya"
    IMGS = playerSnake === "bisaya" ? IMGS_BISAYA : IMGS_TAGALOG;
    state = "name";
    show("name-screen");
    document.getElementById("name-input").focus();
  });
});
document.getElementById("name-ok").addEventListener("click", () => {
  playerName = document.getElementById("name-input").value.trim() || "Player";
  lastStep = performance.now();
  startGame();
});
document.getElementById("name-input").addEventListener("keydown", (e) => {
  if (e.key === "Enter") document.getElementById("name-ok").click();
});
function renderScores() {
  const list = document.getElementById("scores-list");
  list.innerHTML = "";
  const scores = loadScores();
  if (!scores.length) list.innerHTML = "<li>No scores yet.</li>";
  scores.forEach((s, i) => {
    const li = document.createElement("li");
    li.innerHTML = `<span>${i + 1}. ${s.name}</span><span>${s.score}</span>`;
    list.appendChild(li);
  });
}

// ── Boot ──────────────────────────────────────────────────────────────────
(async function init() {
  await loadAssets();
  initMotes();
  resizeCanvas(true);
  show("menu");
  // Browsers require a user gesture before audio can play.
  document.addEventListener("pointerdown", () => {
    if (state === "menu" || state === "over") music.play().catch(() => {});
  }, { once: false });
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  }
  rafId = requestAnimationFrame(loop);
})();
