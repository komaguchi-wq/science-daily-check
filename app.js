// ==============================
// 理科デイリーチェック
// ==============================

// --- 状態管理 ---
let currentUser = null;       // "さと" | "ぱぱ"
let unitsList = [];           // units.json の中身
let currentUnit = null;       // 選択中の単元 { id, title, subject }
let quizData = null;          // 単元の quiz-data.json
let activePages = [];         // フィルタ後のページリスト
let currentPageIndex = 0;
let currentRegionIndex = 0;
let sessionResults = {};      // このセッションの正誤 regionKey -> "correct"|"wrong"
let answerRevealed = false;
let imageCache = {};
let currentMode = "all";      // 現在の学習モード

// Google Sheets バックアップ用（後で設定）
const SHEETS_API_URL = localStorage.getItem("sheets-api-url") || "";

// --- トラッキングデータ ---
// LocalStorage: `tracking-${user}` -> { "630-01": { "5-0": { attempts: 3, correct: 2 }, ... } }
function getTracking() {
  const key = `tracking-${currentUser}`;
  try {
    return JSON.parse(localStorage.getItem(key)) || {};
  } catch { return {}; }
}

function setTracking(data) {
  localStorage.setItem(`tracking-${currentUser}`, JSON.stringify(data));
}

function getRegionTracking(unitId, pageId, regionIdx) {
  const tracking = getTracking();
  const unitData = tracking[unitId] || {};
  return unitData[`${pageId}-${regionIdx}`] || { attempts: 0, correct: 0 };
}

function recordAnswer(unitId, pageId, regionIdx, isCorrect) {
  const tracking = getTracking();
  if (!tracking[unitId]) tracking[unitId] = {};
  const key = `${pageId}-${regionIdx}`;
  if (!tracking[unitId][key]) tracking[unitId][key] = { attempts: 0, correct: 0 };
  tracking[unitId][key].attempts++;
  if (isCorrect) tracking[unitId][key].correct++;
  setTracking(tracking);
  backupToSheets();
}

function getAccuracy(unitId, pageId, regionIdx) {
  const t = getRegionTracking(unitId, pageId, regionIdx);
  if (t.attempts === 0) return null;
  return t.correct / t.attempts;
}

function getUnitStats(unitId) {
  const tracking = getTracking();
  const unitData = tracking[unitId] || {};
  let totalAttempts = 0, totalCorrect = 0, totalQuestions = 0;
  for (const key in unitData) {
    totalQuestions++;
    totalAttempts += unitData[key].attempts;
    totalCorrect += unitData[key].correct;
  }
  return { totalQuestions, totalAttempts, totalCorrect };
}

// --- Google Sheets バックアップ ---
async function backupToSheets() {
  if (!SHEETS_API_URL) return;
  try {
    const tracking = getTracking();
    await fetch(SHEETS_API_URL, {
      method: "POST",
      mode: "no-cors",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        user: currentUser,
        timestamp: new Date().toISOString(),
        data: tracking
      })
    });
  } catch (e) {
    console.warn("Sheets backup failed:", e);
  }
}

// --- 画面切り替え ---
function showScreen(id) {
  document.querySelectorAll(".screen").forEach(s => s.classList.remove("active"));
  document.getElementById(id).classList.add("active");
}

// ==============================
// ユーザー選択
// ==============================
function selectUser(user) {
  currentUser = user;
  sessionStorage.setItem("current-user", user);
  document.getElementById("header-user-name").textContent = user;
  loadUnits();
}

// ==============================
// 単元一覧
// ==============================
async function loadUnits() {
  const res = await fetch("units.json");
  unitsList = await res.json();
  renderUnits();
  showScreen("screen-units");
}

function renderUnits() {
  const list = document.getElementById("unit-list");
  list.innerHTML = "";

  unitsList.forEach(unit => {
    const card = document.createElement("div");
    card.className = "unit-card";

    const stats = getUnitStats(unit.id);
    const accuracy = stats.totalAttempts > 0
      ? Math.round((stats.totalCorrect / stats.totalAttempts) * 100) + "%"
      : "---";

    card.innerHTML = `
      <div class="unit-card-info">
        <div class="unit-card-title">${unit.id} ${unit.title}</div>
        <div class="unit-card-subtitle">${unit.subject}</div>
      </div>
      <div class="unit-card-stats">
        <div class="unit-card-accuracy">${accuracy}</div>
        <div class="unit-card-detail">${stats.totalCorrect}/${stats.totalAttempts}</div>
      </div>
    `;

    card.addEventListener("click", () => openUnit(unit));
    list.appendChild(card);
  });
}

// ==============================
// 単元詳細
// ==============================
async function openUnit(unit) {
  currentUnit = unit;
  document.getElementById("unit-detail-title").textContent =
    `${unit.id} ${unit.title}`;

  const res = await fetch(`units/${unit.id}/quiz-data.json`);
  quizData = await res.json();

  renderUnitDetail();
  showScreen("screen-unit-detail");
}

function renderUnitDetail() {
  const list = document.getElementById("unit-page-list");
  list.innerHTML = "";

  quizData.pages.forEach((page, idx) => {
    if (page.regions.length === 0) return;

    const card = document.createElement("div");
    card.className = "page-card";

    const regionCount = page.regions.length;
    let attempted = 0, correctCount = 0;
    page.regions.forEach((_, ri) => {
      const t = getRegionTracking(currentUnit.id, page.id, ri);
      if (t.attempts > 0) {
        attempted++;
        if (t.correct / t.attempts >= 1) correctCount++;
      }
    });

    let badge = "";
    if (attempted === 0) {
      badge = `<span class="badge badge-new">未回答</span>`;
    } else if (correctCount === regionCount) {
      badge = `<span class="badge badge-perfect">全問正解</span>`;
    } else {
      const pct = Math.round((correctCount / regionCount) * 100);
      badge = `<span class="badge badge-in-progress">${pct}%</span>`;
    }

    const pageLabel = getPageLabel(page);

    card.innerHTML = `
      <div class="page-card-thumb">
        <img src="units/${currentUnit.id}/images/${page.mask}" loading="lazy" alt="${pageLabel}">
      </div>
      <div class="page-card-title">${pageLabel}</div>
      <div class="page-card-info">${regionCount}問</div>
      ${badge}
    `;

    card.addEventListener("click", () => {
      currentMode = "all";
      activePages = quizData.pages.filter(p => p.regions.length > 0);
      const activeIdx = activePages.indexOf(page);
      startQuiz(activeIdx);
    });

    list.appendChild(card);
  });

  // 問題別正答率テーブル
  renderAccuracyTable();

  // モードボタンの有効/無効
  updateModeButtons();
}

function renderAccuracyTable() {
  const wrapper = document.getElementById("accuracy-table-wrapper");
  const allPages = quizData.pages.filter(p => p.regions.length > 0);

  let rows = "";
  let qNum = 0;
  allPages.forEach(page => {
    page.regions.forEach((_, ri) => {
      qNum++;
      const t = getRegionTracking(currentUnit.id, page.id, ri);
      let accText, accClass;
      if (t.attempts === 0) {
        accText = "未回答";
        accClass = "acc-none";
      } else {
        const pct = Math.round((t.correct / t.attempts) * 100);
        accText = `${t.correct}/${t.attempts} (${pct}%)`;
        if (pct === 100) accClass = "acc-perfect";
        else if (pct >= 67) accClass = "acc-good";
        else if (pct > 0) accClass = "acc-bad";
        else accClass = "acc-zero";
      }
      rows += `<tr>
        <td>${qNum}</td>
        <td>${getPageLabel(page)}</td>
        <td class="${accClass}">${accText}</td>
      </tr>`;
    });
  });

  wrapper.innerHTML = `
    <table class="accuracy-table">
      <thead><tr><th>#</th><th>ページ</th><th>正答率</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
  `;
}

function updateModeButtons() {
  const allPages = quizData.pages.filter(p => p.regions.length > 0);
  let totalAll = 0, countUnanswered = 0, countContinue = 0;
  let countBelow50 = 0, countBelow67 = 0, countBelow99 = 0;

  allPages.forEach(page => {
    page.regions.forEach((_, ri) => {
      totalAll++;
      const acc = getAccuracy(currentUnit.id, page.id, ri);
      if (acc === null) { countUnanswered++; countContinue++; }
      if (acc !== null && acc <= 0.5) countBelow50++;
      if (acc !== null && acc <= 0.67) countBelow67++;
      if (acc !== null && acc < 1.0) countBelow99++;
    });
  });

  const setBtn = (mode, count, total) => {
    const btn = document.querySelector(`[data-mode="${mode}"]`);
    const label = btn.textContent.replace(/\s*\(.*\)$/, "");
    const num = total !== undefined ? total : count;
    btn.textContent = `${label} (${num}問)`;
    btn.disabled = count === 0;
  };

  setBtn("continue", countContinue);
  setBtn("all", totalAll, totalAll);
  setBtn("below50", countBelow50);
  setBtn("below67", countBelow67);
  setBtn("below99", countBelow99);
  setBtn("unanswered", countUnanswered);
}

function getPageLabel(page) {
  const p = page.page;
  const h = page.half;
  if (p === 1) return h === "bottom" ? "表紙" : "確認問題";
  if (p === 3 || p === 4) return "ポイントチェック";
  if (p === 5) return "実験・器具";
  if (p === 6) return "植物";
  if (p >= 7 && p <= 9) {
    const stepBase = (p - 7) * 2 + 1;
    return h === "bottom" ? `ステップ ${stepBase}` : `ステップ ${stepBase + 1}`;
  }
  if (p === 10) return h === "bottom" ? "確認テスト" : "確認テスト(2)";
  return `p${p}`;
}

// ==============================
// モード選択 → クイズ開始
// ==============================
function isTargetRegion(pageId, regionIdx) {
  if (currentMode === "all") return true;
  const acc = getAccuracy(currentUnit.id, pageId, regionIdx);
  if (currentMode === "continue" || currentMode === "unanswered") return acc === null;
  if (currentMode === "below50") return acc !== null && acc <= 0.5;
  if (currentMode === "below67") return acc !== null && acc <= 0.67;
  if (currentMode === "below99") return acc !== null && acc < 1.0;
  return true;
}

function startWithMode(mode) {
  currentMode = mode;
  const allPages = quizData.pages.filter(p => p.regions.length > 0);

  if (mode === "all") {
    activePages = allPages;
    sessionResults = {};
    startQuiz(0);
  } else if (mode === "continue") {
    activePages = allPages;
    sessionResults = {};
    // 最初の未回答問題を見つける
    let foundPage = 0, foundRegion = 0, found = false;
    for (let pi = 0; pi < activePages.length && !found; pi++) {
      for (let ri = 0; ri < activePages[pi].regions.length; ri++) {
        const acc = getAccuracy(currentUnit.id, activePages[pi].id, ri);
        if (acc === null) {
          foundPage = pi;
          foundRegion = ri;
          found = true;
          break;
        }
      }
    }
    currentRegionIndex = foundRegion;
    startQuiz(foundPage);
  } else if (mode === "unanswered") {
    activePages = allPages.filter(page =>
      page.regions.some((_, ri) => {
        const acc = getAccuracy(currentUnit.id, page.id, ri);
        return acc === null;
      })
    );
    sessionResults = {};
    if (activePages.length > 0) startQuiz(0);
  } else {
    // 正答率フィルター
    const threshold = mode === "below50" ? 0.5 : mode === "below67" ? 0.67 : 0.99;
    activePages = allPages.filter(page =>
      page.regions.some((_, ri) => {
        const acc = getAccuracy(currentUnit.id, page.id, ri);
        return acc !== null && acc <= threshold;
      })
    );
    sessionResults = {};
    if (activePages.length > 0) startQuiz(0);
  }
}

// ==============================
// クイズ
// ==============================
function startQuiz(pageIdx) {
  currentPageIndex = pageIdx;
  if (currentRegionIndex === undefined || currentRegionIndex === 0) {
    currentRegionIndex = findFirstUnansweredInSession(activePages[pageIdx]);
  }
  answerRevealed = false;
  showScreen("screen-quiz");
  renderQuiz();
}

function findFirstUnansweredInSession(page) {
  for (let i = 0; i < page.regions.length; i++) {
    if (!sessionResults[`${page.id}-${i}`] && isTargetRegion(page.id, i)) return i;
  }
  return 0;
}

async function renderQuiz() {
  const page = activePages[currentPageIndex];
  const canvas = document.getElementById("quiz-canvas");
  const ctx = canvas.getContext("2d");

  document.getElementById("quiz-title").textContent = getPageLabel(page);
  document.getElementById("quiz-page-info").textContent =
    `${currentRegionIndex + 1} / ${page.regions.length}問`;

  document.getElementById("page-indicator").textContent =
    `p${currentPageIndex + 1} / ${activePages.length}ページ`;
  document.getElementById("btn-prev-page").disabled = currentPageIndex === 0;
  document.getElementById("btn-next-page").disabled = currentPageIndex === activePages.length - 1;

  // プログレス（対象問題のみカウント）
  const targetCount = page.regions.filter((_, i) => isTargetRegion(page.id, i)).length;
  const answeredCount = page.regions.filter((_, i) =>
    sessionResults[`${page.id}-${i}`] && isTargetRegion(page.id, i)).length;
  document.getElementById("progress-fill").style.width =
    targetCount > 0 ? `${(answeredCount / targetCount) * 100}%` : "0%";

  // 画像
  const origImg = await loadImage(`units/${currentUnit.id}/images/${page.orig}`);
  const maskImg = await loadImage(`units/${currentUnit.id}/images/${page.mask}`);

  // キャンバスサイズ
  const wrapper = document.getElementById("canvas-wrapper");
  const wrapperWidth = wrapper.clientWidth - 8;
  const wrapperHeight = wrapper.clientHeight - 8;
  const scaleW = wrapperWidth / page.width;
  const scaleH = wrapperHeight / page.height;
  const scale = Math.min(scaleW, scaleH);
  const displayW = Math.floor(page.width * scale);
  const displayH = Math.floor(page.height * scale);

  canvas.width = page.width;
  canvas.height = page.height;
  canvas.style.width = displayW + "px";
  canvas.style.height = displayH + "px";

  ctx.drawImage(maskImg, 0, 0);

  // 回答済み領域・非対象領域を元画像で上書き
  page.regions.forEach((region, i) => {
    const key = `${page.id}-${i}`;
    const target = isTargetRegion(page.id, i);
    if (sessionResults[key] || !target) {
      const pad = 4;
      const sx = Math.max(0, region.x - pad);
      const sy = Math.max(0, region.y - pad);
      const sw = Math.min(page.width - sx, region.w + pad * 2);
      const sh = Math.min(page.height - sy, region.h + pad * 2);
      ctx.drawImage(origImg, sx, sy, sw, sh, sx, sy, sw, sh);
      if (sessionResults[key]) {
        drawResultMark(ctx, region, sessionResults[key]);
      }
    }
  });

  // 現在の問題をハイライト
  if (currentRegionIndex < page.regions.length) {
    const region = page.regions[currentRegionIndex];
    const key = `${page.id}-${currentRegionIndex}`;
    if (!sessionResults[key]) {
      const pad = 6;
      ctx.strokeStyle = "#e8a040";
      ctx.lineWidth = 3;
      ctx.strokeRect(region.x - pad, region.y - pad, region.w + pad * 2, region.h + pad * 2);
    }
  }

  updateControlVisibility();
}

function drawResultMark(ctx, region, result) {
  const pad = 4;
  ctx.strokeStyle = result === "correct"
    ? "rgba(52, 199, 89, 0.6)"
    : "rgba(255, 59, 48, 0.6)";
  ctx.lineWidth = 2;
  ctx.strokeRect(region.x - pad, region.y - pad, region.w + pad * 2, region.h + pad * 2);

  // 正答率テキスト
  const t = getRegionTracking(currentUnit.id,
    activePages[currentPageIndex].id, currentRegionIndex);
  // (小さすぎるので省略)
}

function updateControlVisibility() {
  const page = activePages[currentPageIndex];
  const key = `${page.id}-${currentRegionIndex}`;

  const revealRow = document.getElementById("reveal-row");
  const judgeRow = document.getElementById("judge-row");

  revealRow.classList.add("hidden");
  judgeRow.classList.add("hidden");

  if (!isTargetRegion(page.id, currentRegionIndex)) {
    // 非対象問題にいる場合は表示のみ（操作不要）
    revealRow.classList.remove("hidden");
  } else if (!sessionResults[key] && !answerRevealed) {
    revealRow.classList.remove("hidden");
  } else if (answerRevealed) {
    judgeRow.classList.remove("hidden");
  } else {
    revealRow.classList.remove("hidden");
  }
}

async function revealAnswer() {
  const page = activePages[currentPageIndex];
  const region = page.regions[currentRegionIndex];
  const canvas = document.getElementById("quiz-canvas");
  const ctx = canvas.getContext("2d");
  const origImg = await loadImage(`units/${currentUnit.id}/images/${page.orig}`);

  const pad = 4;
  const sx = Math.max(0, region.x - pad);
  const sy = Math.max(0, region.y - pad);
  const sw = Math.min(page.width - sx, region.w + pad * 2);
  const sh = Math.min(page.height - sy, region.h + pad * 2);
  ctx.drawImage(origImg, sx, sy, sw, sh, sx, sy, sw, sh);

  ctx.strokeStyle = "#e8a040";
  ctx.lineWidth = 3;
  ctx.strokeRect(sx - 2, sy - 2, sw + 4, sh + 4);

  answerRevealed = true;
  updateControlVisibility();
}

function judgeAnswer(isCorrect) {
  const page = activePages[currentPageIndex];
  const key = `${page.id}-${currentRegionIndex}`;
  sessionResults[key] = isCorrect ? "correct" : "wrong";

  // トラッキングに記録
  recordAnswer(currentUnit.id, page.id, currentRegionIndex, isCorrect);

  answerRevealed = false;

  const nextIdx = findNextUnansweredInSession(page, currentRegionIndex);
  if (nextIdx !== -1) {
    currentRegionIndex = nextIdx;
    renderQuiz();
  } else {
    // このページの対象問題を全て回答済み → 自動で次ページへ
    if (currentPageIndex < activePages.length - 1) {
      currentPageIndex++;
      currentRegionIndex = findFirstUnansweredInSession(activePages[currentPageIndex]);
      renderQuiz();
    } else {
      // 最終ページ → 結果表示
      showResults();
    }
  }
}

function findNextUnansweredInSession(page, fromIndex) {
  for (let i = fromIndex + 1; i < page.regions.length; i++) {
    if (!sessionResults[`${page.id}-${i}`] && isTargetRegion(page.id, i)) return i;
  }
  for (let i = 0; i < fromIndex; i++) {
    if (!sessionResults[`${page.id}-${i}`] && isTargetRegion(page.id, i)) return i;
  }
  return -1;
}

function showResults() {
  const page = activePages[currentPageIndex];
  let correct = 0, answered = 0;
  for (let i = 0; i < page.regions.length; i++) {
    if (!isTargetRegion(page.id, i)) continue;
    const key = `${page.id}-${i}`;
    if (sessionResults[key]) {
      answered++;
      if (sessionResults[key] === "correct") correct++;
    }
  }
  const percent = answered > 0 ? Math.round((correct / answered) * 100) : 0;

  document.getElementById("score-correct").textContent = correct;
  document.getElementById("score-total").textContent = answered;
  document.getElementById("score-percent").textContent = percent + "%";

  let emoji = "📚";
  if (percent === 100) emoji = "🎉";
  else if (percent >= 80) emoji = "👍";
  else if (percent >= 50) emoji = "💪";
  document.getElementById("score-emoji").textContent = emoji;

  const hasWrong = page.regions.some((_, i) =>
    sessionResults[`${page.id}-${i}`] === "wrong" && isTargetRegion(page.id, i));
  document.getElementById("btn-retry-wrong").disabled = !hasWrong;

  showScreen("screen-results");
}

// --- 画像ユーティリティ ---
function loadImage(src) {
  if (imageCache[src]) return Promise.resolve(imageCache[src]);
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => { imageCache[src] = img; resolve(img); };
    img.onerror = reject;
    img.src = src;
  });
}

// ==============================
// イベントリスナー
// ==============================
function setupEventListeners() {
  // ユーザー選択
  document.querySelectorAll(".btn-user").forEach(btn => {
    btn.addEventListener("click", () => selectUser(btn.dataset.user));
  });

  // ユーザー切り替え
  document.getElementById("btn-switch-user").addEventListener("click", () => {
    currentUser = null;
    sessionStorage.removeItem("current-user");
    showScreen("screen-user");
  });

  // 単元詳細 → 戻る
  document.getElementById("btn-back-units").addEventListener("click", () => {
    renderUnits();
    showScreen("screen-units");
  });

  // モード選択
  document.querySelectorAll("[data-mode]").forEach(btn => {
    btn.addEventListener("click", () => startWithMode(btn.dataset.mode));
  });

  // クイズ画面
  document.getElementById("btn-reveal").addEventListener("click", revealAnswer);
  document.getElementById("btn-correct").addEventListener("click", () => judgeAnswer(true));
  document.getElementById("btn-incorrect").addEventListener("click", () => judgeAnswer(false));

  document.getElementById("btn-undo").addEventListener("click", () => {
    if (currentRegionIndex > 0) {
      currentRegionIndex--;
      answerRevealed = false;
      renderQuiz();
    }
  });

  document.getElementById("btn-prev-page").addEventListener("click", () => {
    if (currentPageIndex > 0) {
      currentPageIndex--;
      currentRegionIndex = findFirstUnansweredInSession(activePages[currentPageIndex]);
      answerRevealed = false;
      renderQuiz();
    }
  });

  document.getElementById("btn-next-page").addEventListener("click", () => {
    if (currentPageIndex < activePages.length - 1) {
      currentPageIndex++;
      currentRegionIndex = findFirstUnansweredInSession(activePages[currentPageIndex]);
      answerRevealed = false;
      renderQuiz();
    }
  });

  document.getElementById("btn-back-detail").addEventListener("click", () => {
    answerRevealed = false;
    renderUnitDetail();
    showScreen("screen-unit-detail");
  });

  // 結果画面
  document.getElementById("btn-results").addEventListener("click", showResults);

  document.getElementById("btn-retry-wrong").addEventListener("click", () => {
    const page = activePages[currentPageIndex];
    page.regions.forEach((_, i) => {
      const key = `${page.id}-${i}`;
      if (sessionResults[key] === "wrong") delete sessionResults[key];
    });
    currentRegionIndex = findFirstUnansweredInSession(page);
    answerRevealed = false;
    showScreen("screen-quiz");
    renderQuiz();
  });

  document.getElementById("btn-back-unit-detail").addEventListener("click", () => {
    renderUnitDetail();
    showScreen("screen-unit-detail");
  });

  document.getElementById("btn-back-from-results").addEventListener("click", () => {
    showScreen("screen-quiz");
    renderQuiz();
  });

  // キャンバスタップで答え表示
  document.getElementById("quiz-canvas").addEventListener("click", () => {
    const page = activePages[currentPageIndex];
    if (!answerRevealed && isTargetRegion(page.id, currentRegionIndex)) revealAnswer();
  });
}

// ==============================
// 起動
// ==============================
function init() {
  setupEventListeners();

  // セッション復元
  const savedUser = sessionStorage.getItem("current-user");
  if (savedUser) {
    selectUser(savedUser);
  }
}

init();
