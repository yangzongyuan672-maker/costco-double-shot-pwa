const DB_NAME = "costco-double-shot-db";
const DB_VERSION = 1;
const STORE = "kv";
const STATE_KEY = "state";
const CARD_W = 414;
const CARD_H = 553;
const GRID_W = 1242;
const GRID_H = 1660;
const GRID_GAP = 0;
const GRID_PAD = 0;
const WATERMARK_H = 0;

const initialState = {
  taskName: "",
  storeName: "Markham",
  createdAt: "",
  items: [],
  grids: [],
  draft: {
    productBlob: null,
    priceBlob: null,
    cardBlob: null,
    note: ""
  },
  view: "home"
};

let db;
let state = structuredClone(initialState);
let objectUrls = new Set();
let toastTimer;
let cameraStream = null;

const $ = (selector) => document.querySelector(selector);

async function openDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      request.result.createObjectStore(STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function dbGet(key) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readonly");
    const request = tx.objectStore(STORE).get(key);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function dbSet(key, value) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function loadState() {
  db = await openDb();
  const saved = await dbGet(STATE_KEY);
  if (saved) {
    state = {
      ...structuredClone(initialState),
      ...saved,
      draft: { ...structuredClone(initialState).draft, ...(saved.draft || {}) }
    };
  }
  if (!state.taskName) {
    state.storeName = state.storeName || "Markham";
    state.taskName = defaultTaskName(state.storeName);
  }
}

async function saveState() {
  await dbSet(STATE_KEY, state);
}

function defaultTaskName(store) {
  const date = localDateKey(new Date());
  const safeStore = (store || "Store").trim().replace(/\s+/g, "_");
  return `Costco_${date}_${safeStore}`;
}

function localDateKey(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function urlFor(blob) {
  if (!blob) return "";
  const url = URL.createObjectURL(blob);
  objectUrls.add(url);
  return url;
}

function clearObjectUrls() {
  objectUrls.forEach((url) => URL.revokeObjectURL(url));
  objectUrls = new Set();
}

function showToast(message) {
  clearTimeout(toastTimer);
  const existing = $(".toast");
  if (existing) existing.remove();
  const node = document.createElement("div");
  node.className = "toast";
  node.textContent = message;
  document.body.appendChild(node);
  toastTimer = setTimeout(() => node.remove(), 2600);
}

function todayItemCount() {
  const today = localDateKey(new Date());
  return state.items.filter((item) => localDateKey(new Date(item.createdAt)) === today).length;
}

function currentGroupItems() {
  const completedGroups = state.grids.filter((grid) => !grid.manual).length;
  const start = completedGroups * 9;
  return state.items.slice(start, start + 9);
}

function currentGroupNumber() {
  return Math.floor(state.items.length / 9) + 1;
}

function currentPositionInGroup() {
  return (state.items.length % 9) + 1;
}

function render() {
  clearObjectUrls();
  if (state.view === "capture") renderCapture();
  else renderHome();
}

function renderHome() {
  const latestGrid = state.grids.at(-1);
  $("#app").innerHTML = `
    <main class="app-shell">
      <header class="topbar">
        <div class="brand">
          <h1>Costco 双拍采集器</h1>
          <p>商品图 + 价格牌，自动合成九宫格</p>
        </div>
        <div class="pill">本地保存</div>
      </header>

      <section class="stack">
        <div class="panel stack">
          <div class="field">
            <label for="storeName">门店</label>
            <input id="storeName" class="input" value="${escapeHtml(state.storeName)}" placeholder="Markham" />
          </div>
          <div class="field">
            <label for="taskName">任务名称</label>
            <input id="taskName" class="input" value="${escapeHtml(state.taskName)}" />
          </div>
          <div class="actions">
            <button class="btn primary" id="startCapture">开始 / 继续采集</button>
            <button class="btn ghost" id="newTask">新建今天任务</button>
          </div>
        </div>

        <div class="stats-grid">
          <div class="stat"><strong>${state.items.length}</strong><span>已采商品</span></div>
          <div class="stat"><strong>${state.grids.length}</strong><span>九宫格</span></div>
          <div class="stat"><strong>${todayItemCount()}</strong><span>今天采集</span></div>
        </div>

        <div class="panel actions">
          <button class="btn dark" id="exportZip" ${state.items.length ? "" : "disabled"}>导出全部 ZIP</button>
          <button class="btn ghost" id="downloadLatest" ${latestGrid ? "" : "disabled"}>下载最新九宫格</button>
          <button class="btn danger" id="clearTask" ${state.items.length || state.grids.length ? "" : "disabled"}>清空当前任务</button>
        </div>

        ${renderGridGallery()}
      </section>
    </main>
  `;

  $("#storeName").addEventListener("input", async (event) => {
    state.storeName = event.target.value;
    if (!state.createdAt && state.taskName.startsWith("Costco_")) {
      state.taskName = defaultTaskName(state.storeName);
      $("#taskName").value = state.taskName;
    }
    await saveState();
  });
  $("#taskName").addEventListener("input", async (event) => {
    state.taskName = event.target.value;
    await saveState();
  });
  $("#startCapture").addEventListener("click", async () => {
    state.createdAt ||= new Date().toISOString();
    state.view = "capture";
    await saveState();
    render();
  });
  $("#newTask").addEventListener("click", newTask);
  $("#clearTask").addEventListener("click", clearTask);
  $("#exportZip").addEventListener("click", exportZip);
  $("#downloadLatest").addEventListener("click", () => latestGrid && downloadBlob(latestGrid.blob, latestGrid.fileName));
  document.querySelectorAll("[data-download-grid]").forEach((button) => {
    button.addEventListener("click", () => {
      const grid = state.grids.find((item) => item.id === button.dataset.downloadGrid);
      if (grid) downloadBlob(grid.blob, grid.fileName);
    });
  });
  document.querySelectorAll("[data-ai-grid]").forEach((button) => {
    button.addEventListener("click", () => generateTitlesForGroup(Number(button.dataset.aiGrid), button));
  });
}

function renderGridGallery() {
  if (!state.grids.length) {
    return `<div class="notice">还没有九宫格。拍满 9 个商品会自动生成，也可以在采集页提前生成当前组。</div>`;
  }
  return `
    <div class="panel stack">
      <div class="line">
        <strong>已生成九宫格</strong>
      </div>
      <div class="gallery">
        ${state.grids.map((grid) => `
          <div class="thumb">
            <img src="${urlFor(grid.blob)}" alt="${escapeHtml(grid.fileName)}">
            <div class="caption">
              <span>第 ${grid.groupNo} 组</span>
              <button data-ai-grid="${grid.groupNo}">AI中文名</button>
              <button data-download-grid="${grid.id}">下载</button>
            </div>
          </div>
        `).join("")}
      </div>
    </div>
  `;
}

function renderCapture() {
  const draft = state.draft;
  const productUrl = urlFor(draft.productBlob);
  const priceUrl = urlFor(draft.priceBlob);
  const cardUrl = urlFor(draft.cardBlob);
  const progress = Math.round(((state.items.length % 9) / 9) * 100);

  $("#app").innerHTML = `
    <main class="app-shell">
      <header class="capture-header">
        <div class="line">
          <button class="btn ghost" id="backHome">返回</button>
          <div>
            <h2>第 ${currentPositionInGroup()} / 9 个商品</h2>
            <div class="mini">总计 ${state.items.length} 个 · 当前第 ${currentGroupNumber()} 组</div>
          </div>
        </div>
        <div class="progress"><span style="width:${progress}%"></span></div>
      </header>

      <section class="stack">
        <div class="preview-grid">
          <div class="preview">${productUrl ? `<img src="${productUrl}" alt="商品图">` : "等待商品图"}</div>
          <div class="preview">${priceUrl ? `<img src="${priceUrl}" alt="价格标签图">` : "等待价格标签"}</div>
        </div>

        ${cardUrl ? `<div class="card-preview"><img src="${cardUrl}" alt="单商品卡"></div>` : ""}

        <div class="panel actions">
          <div class="capture-action-row">
            <button class="btn primary" id="productShot">${draft.productBlob ? "重拍商品图" : "拍商品图"}</button>
            <button class="btn primary" id="priceShot" ${draft.productBlob ? "" : "disabled"}>${draft.priceBlob ? "重拍价格牌" : "拍价格牌"}</button>
            <button class="btn dark" id="saveNext" ${draft.cardBlob ? "" : "disabled"}>保存并下一个</button>
          </div>
          <div class="field">
            <label for="note">备注</label>
            <textarea id="note" class="textarea" placeholder="可选，例如 .97、星号、限购等">${escapeHtml(draft.note)}</textarea>
          </div>
          <div class="action-row">
            <button class="btn warn" id="makePartial" ${currentGroupItems().length ? "" : "disabled"}>提前生成九宫格</button>
            <button class="btn danger" id="deleteDraft">删除当前商品</button>
          </div>
        </div>

        <input id="productInput" class="hidden-input" type="file" accept="image/*" capture="environment" />
        <input id="priceInput" class="hidden-input" type="file" accept="image/*" capture="environment" />
      </section>
    </main>
  `;

  $("#backHome").addEventListener("click", async () => {
    state.view = "home";
    await saveState();
    render();
  });
  $("#productShot").addEventListener("click", () => startCameraCapture("productBlob"));
  $("#priceShot").addEventListener("click", () => startCameraCapture("priceBlob"));
  $("#productInput").addEventListener("change", (event) => handlePhoto("productBlob", event.target.files[0]));
  $("#priceInput").addEventListener("change", (event) => handlePhoto("priceBlob", event.target.files[0]));
  $("#note").addEventListener("input", async (event) => {
    state.draft.note = event.target.value;
    await saveState();
  });
  $("#saveNext").addEventListener("click", saveCurrentItem);
  $("#deleteDraft").addEventListener("click", deleteDraft);
  $("#makePartial").addEventListener("click", () => makeGridFromCurrentGroup(true));
}

async function handlePhoto(slot, file) {
  if (!file) return;
  const normalized = await normalizeImage(file, slot === "productBlob" ? 1200 : 1000);
  await setPhotoSlot(slot, normalized, true);
}

async function setPhotoSlot(slot, blob, autoNext) {
  state.draft[slot] = blob;
  if (slot === "productBlob") {
    state.draft.priceBlob = null;
    state.draft.cardBlob = null;
    await saveState();
    render();
    if (autoNext) setTimeout(() => startCameraCapture("priceBlob"), 180);
    return;
  }
  await regenerateDraftCard();
  await saveState();
  render();
}

async function startCameraCapture(slot) {
  if (!navigator.mediaDevices?.getUserMedia) {
    showToast("当前浏览器不支持网页相机，已打开系统相机");
    $(slot === "productBlob" ? "#productInput" : "#priceInput")?.click();
    return;
  }

  stopCameraStream();
  const isPrice = slot === "priceBlob";
  const modal = document.createElement("div");
  modal.className = "camera-modal";
  modal.innerHTML = `
    <div class="camera-stage ${isPrice ? "price-mode" : "product-mode"}">
      <video id="cameraVideo" autoplay playsinline muted></video>
      <div class="camera-mask"></div>
      <div class="camera-frame">
        <span>${isPrice ? "把价格牌、英文名和价格放进框内" : "把商品主体放进框内"}</span>
      </div>
    </div>
    <div class="camera-zoom">
      <button class="zoom-pill active" data-zoom="1" type="button">1x</button>
      <button class="zoom-pill" data-zoom="1.5" type="button">1.5x</button>
      <button class="zoom-pill" data-zoom="2" type="button">2x</button>
      <button class="zoom-pill" data-zoom="3" type="button">3x</button>
    </div>
    <div class="camera-controls">
      <button class="btn ghost" id="closeCamera" type="button">取消</button>
      <button class="btn primary" id="snapCamera" type="button">拍摄</button>
      <button class="btn ghost" id="fallbackCamera" type="button">系统相机备用</button>
    </div>
  `;
  document.body.appendChild(modal);

  const video = modal.querySelector("#cameraVideo");
  try {
    cameraStream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: { ideal: "environment" },
        width: { ideal: 1920 },
        height: { ideal: 1080 }
      },
      audio: false
    });
    video.srcObject = cameraStream;
    await video.play();
  } catch (error) {
    closeCameraModal(modal);
    showToast("网页相机打不开，已打开系统相机备用");
    $(isPrice ? "#priceInput" : "#productInput")?.click();
    return;
  }

  modal.querySelector("#closeCamera").addEventListener("click", () => closeCameraModal(modal));
  modal.querySelectorAll("[data-zoom]").forEach((button) => {
    button.addEventListener("click", () => {
      const zoom = Number(button.dataset.zoom || 1);
      setCameraZoom(video, zoom);
      modal.querySelectorAll("[data-zoom]").forEach((item) => item.classList.toggle("active", item === button));
    });
  });
  modal.querySelector("#fallbackCamera").addEventListener("click", () => {
    closeCameraModal(modal);
    $(isPrice ? "#priceInput" : "#productInput")?.click();
  });
  modal.querySelector("#snapCamera").addEventListener("click", async () => {
    try {
      const blob = await captureFrameFromVideo(video, modal.querySelector(".camera-frame"), isPrice ? 1000 : 1200);
      closeCameraModal(modal);
      await setPhotoSlot(slot, blob, true);
    } catch (error) {
      alert(error.message || "拍摄失败，请重试");
    }
  });
}

function setCameraZoom(video, zoom) {
  video.style.transform = `scale(${zoom})`;
}

function closeCameraModal(modal) {
  stopCameraStream();
  modal?.remove();
}

function stopCameraStream() {
  cameraStream?.getTracks().forEach((track) => track.stop());
  cameraStream = null;
}

async function captureFrameFromVideo(video, frame, maxSide) {
  if (!video.videoWidth || !video.videoHeight) throw new Error("相机还没准备好，请再点一次拍摄");

  const videoRect = video.getBoundingClientRect();
  const frameRect = frame.getBoundingClientRect();
  const scale = Math.max(videoRect.width / video.videoWidth, videoRect.height / video.videoHeight);
  const visibleW = videoRect.width / scale;
  const visibleH = videoRect.height / scale;
  const visibleX = (video.videoWidth - visibleW) / 2;
  const visibleY = (video.videoHeight - visibleH) / 2;
  const sx = visibleX + (frameRect.left - videoRect.left) / scale;
  const sy = visibleY + (frameRect.top - videoRect.top) / scale;
  const sw = frameRect.width / scale;
  const sh = frameRect.height / scale;
  const outputScale = Math.min(1, maxSide / Math.max(sw, sh));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(sw * outputScale);
  canvas.height = Math.round(sh * outputScale);
  const ctx = canvas.getContext("2d", { alpha: false });
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(video, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
  return canvasToBlob(canvas, 0.9);
}

async function regenerateDraftCard() {
  if (!state.draft.productBlob || !state.draft.priceBlob) {
    state.draft.cardBlob = null;
    return;
  }
  state.draft.cardBlob = await makeProductCard(state.draft.productBlob, state.draft.priceBlob);
}

async function saveCurrentItem() {
  if (!state.draft.cardBlob || !state.draft.productBlob || !state.draft.priceBlob) return;
  const index = state.items.length + 1;
  const groupNo = Math.floor((index - 1) / 9) + 1;
  const padded = String(index).padStart(3, "0");
  state.items.push({
    id: crypto.randomUUID(),
    index,
    groupNo,
    productFileName: `${padded}_product.jpg`,
    priceFileName: `${padded}_price.jpg`,
    cardFileName: `${padded}_card.jpg`,
    productBlob: state.draft.productBlob,
    priceBlob: state.draft.priceBlob,
    cardBlob: state.draft.cardBlob,
    note: state.draft.note || "",
    gridFileName: "",
    createdAt: new Date().toISOString()
  });
  state.draft = structuredClone(initialState.draft);

  if (state.items.length % 9 === 0) {
    await makeGridForGroup(groupNo, false);
    showToast(`已完成第 ${groupNo} 组九宫格`);
  } else {
    showToast(`已保存第 ${index} 个商品`);
  }
  await saveState();
  render();
}

async function makeGridFromCurrentGroup(manual) {
  const items = currentGroupItems();
  if (!items.length) return;
  const groupNo = items[0].groupNo;
  await makeGridForGroup(groupNo, manual);
  await saveState();
  render();
  showToast(`已生成第 ${groupNo} 组九宫格`);
}

async function makeGridForGroup(groupNo, manual) {
  const items = state.items.filter((item) => item.groupNo === groupNo).slice(0, 9);
  if (!items.length) return;
  const blob = await makeGrid(items);
  const fileName = `costco_group_${String(groupNo).padStart(2, "0")}.jpg`;
  const existingIndex = state.grids.findIndex((grid) => grid.groupNo === groupNo);
  const grid = {
    id: existingIndex >= 0 ? state.grids[existingIndex].id : crypto.randomUUID(),
    groupNo,
    fileName,
    blob,
    manual,
    createdAt: new Date().toISOString()
  };
  if (existingIndex >= 0) state.grids[existingIndex] = grid;
  else state.grids.push(grid);
  items.forEach((item) => {
    item.gridFileName = fileName;
  });
}

function getStoredTitles() {
  try {
    return JSON.parse(localStorage.getItem("costco_title_queue") || "[]");
  } catch {
    return [];
  }
}

function setStoredTitles(titles) {
  localStorage.setItem("costco_title_queue", JSON.stringify(titles));
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(reader.error || new Error("图片读取失败"));
    reader.readAsDataURL(blob);
  });
}

async function generateTitlesForGroup(groupNo, button) {
  const items = state.items.filter((item) => item.groupNo === groupNo).slice(0, 9);
  if (!items.length) return;

  const oldText = button?.textContent || "";
  if (button) {
    button.disabled = true;
    button.textContent = "识别中...";
  }
  showToast(`正在识别第 ${groupNo} 组中文名...`);

  try {
    const images = await Promise.all(items.map((item) => blobToDataUrl(item.priceBlob)));
    const response = await fetch("/api/generate-titles", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ images })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || "AI 批量识别失败");

    const titles = getStoredTitles();
    for (const [index, item] of items.entries()) {
      const title = String(data.titles?.[index] || "").trim();
      titles[item.index - 1] = title;
      localStorage.setItem("costco_title_current", title);
      item.cardBlob = await makeProductCard(item.productBlob, item.priceBlob);
    }
    localStorage.setItem("costco_title_current", "");
    setStoredTitles(titles);

    const existingGrid = state.grids.find((grid) => grid.groupNo === groupNo);
    await makeGridForGroup(groupNo, existingGrid?.manual ?? false);
    await saveState();
    render();
    showToast(`第 ${groupNo} 组中文名已生成`);
  } catch (error) {
    alert(error.message || "AI 批量识别失败");
  } finally {
    if (button?.isConnected) {
      button.disabled = false;
      button.textContent = oldText;
    }
  }
}

function deleteDraft() {
  state.draft = structuredClone(initialState.draft);
  saveState().then(() => {
    render();
    showToast("当前商品已清空");
  });
}

async function newTask() {
  if ((state.items.length || state.grids.length) && !confirm("新建任务会清空当前本地任务，确定继续？")) return;
  state = structuredClone(initialState);
  state.storeName = $("#storeName")?.value || "Markham";
  state.taskName = defaultTaskName(state.storeName);
  state.createdAt = new Date().toISOString();
  await saveState();
  render();
  showToast("已新建任务");
}

async function clearTask() {
  if (!confirm("确定清空当前任务？这个操作只影响本机浏览器里的当前数据。")) return;
  state = structuredClone(initialState);
  state.storeName = "Markham";
  state.taskName = defaultTaskName(state.storeName);
  await saveState();
  render();
  showToast("当前任务已清空");
}

async function normalizeImage(blob, maxSide) {
  const bitmap = await createImageBitmap(blob);
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  const width = Math.round(bitmap.width * scale);
  const height = Math.round(bitmap.height * scale);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d", { alpha: false });
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close?.();
  return canvasToBlob(canvas, 0.86);
}

async function makeProductCard(productBlob, priceBlob) {
  const [product, price] = await Promise.all([createImageBitmap(productBlob), createImageBitmap(priceBlob)]);
  const canvas = document.createElement("canvas");
  canvas.width = CARD_W;
  canvas.height = CARD_H;
  const ctx = canvas.getContext("2d", { alpha: false });

  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, CARD_W, CARD_H);

  const priceH = Math.round(CARD_H * 0.35);
  const productY = priceH;
  const productH = CARD_H - productY;

  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, CARD_W, priceH);
  ctx.clip();
  drawCover(ctx, price, 0, 0, CARD_W, priceH, 0.5, 0.66);
  ctx.restore();

  ctx.save();
  ctx.beginPath();
  ctx.rect(0, productY, CARD_W, productH);
  ctx.clip();
  drawCover(ctx, product, 0, productY, CARD_W, productH);
  ctx.restore();

  product.close?.();
  price.close?.();
  return canvasToBlob(canvas, 0.9);
}

async function makeGrid(items) {
  const canvas = document.createElement("canvas");
  canvas.width = GRID_W;
  canvas.height = GRID_H;
  const ctx = canvas.getContext("2d", { alpha: false });
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, GRID_W, GRID_H);

  for (let index = 0; index < 9; index += 1) {
    const col = index % 3;
    const row = Math.floor(index / 3);
    const x = Math.round((GRID_W / 3) * col);
    const y = Math.round((GRID_H / 3) * row);
    const nextX = Math.round((GRID_W / 3) * (col + 1));
    const nextY = Math.round((GRID_H / 3) * (row + 1));
    const cellW = nextX - x;
    const cellH = nextY - y;
    ctx.fillStyle = "#f8fafc";
    ctx.fillRect(x, y, cellW, cellH);
    const item = items[index];
    if (item) {
      const bitmap = await createImageBitmap(item.cardBlob);
      drawCover(ctx, bitmap, x, y, cellW, cellH);
      bitmap.close?.();
    }
  }

  return canvasToBlob(canvas, 0.92);
}

function drawCover(ctx, bitmap, x, y, width, height, focusX = 0.5, focusY = 0.5) {
  const scale = Math.max(width / bitmap.width, height / bitmap.height);
  const sourceW = width / scale;
  const sourceH = height / scale;
  const sourceX = Math.min(Math.max((bitmap.width - sourceW) * focusX, 0), bitmap.width - sourceW);
  const sourceY = Math.min(Math.max((bitmap.height - sourceH) * focusY, 0), bitmap.height - sourceH);
  ctx.drawImage(bitmap, sourceX, sourceY, sourceW, sourceH, x, y, width, height);
}

function drawContain(ctx, bitmap, x, y, width, height) {
  const scale = Math.min(width / bitmap.width, height / bitmap.height);
  const drawW = bitmap.width * scale;
  const drawH = bitmap.height * scale;
  const drawX = x + (width - drawW) / 2;
  const drawY = y + (height - drawH) / 2;
  ctx.drawImage(bitmap, drawX, drawY, drawW, drawH);
}

function roundRect(ctx, x, y, width, height, radius) {
  const r = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + width, y, x + width, y + height, r);
  ctx.arcTo(x + width, y + height, x, y + height, r);
  ctx.arcTo(x, y + height, x, y, r);
  ctx.arcTo(x, y, x + width, y, r);
  ctx.closePath();
}

function canvasToBlob(canvas, quality) {
  return new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
}

function downloadBlob(blob, fileName) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function exportZip() {
  if (!state.items.length) return;
  showToast("正在打包 ZIP...");
  const files = [];
  state.items.forEach((item) => {
    files.push({ name: `products/${item.productFileName}`, blob: item.productBlob });
    files.push({ name: `prices/${item.priceFileName}`, blob: item.priceBlob });
    files.push({ name: `cards/${item.cardFileName}`, blob: item.cardBlob });
  });
  state.grids.forEach((grid) => {
    files.push({ name: `grids/${grid.fileName}`, blob: grid.blob });
  });
  files.push({ name: "data.json", text: JSON.stringify(serializableData(), null, 2) });
  files.push({ name: "data.csv", text: makeCsv() });
  const zipBlob = await createZip(files);
  downloadBlob(zipBlob, `${safeFileName(state.taskName || "costco_capture")}.zip`);
  showToast("ZIP 已生成");
}

function serializableData() {
  return {
    taskName: state.taskName,
    storeName: state.storeName,
    createdAt: state.createdAt,
    itemCount: state.items.length,
    gridCount: state.grids.length,
    items: state.items.map(({ productBlob, priceBlob, cardBlob, ...item }) => item),
    grids: state.grids.map(({ blob, ...grid }) => grid)
  };
}

function makeCsv() {
  const rows = [["序号", "组号", "商品图文件名", "价格图文件名", "单商品卡文件名", "九宫格文件名", "备注"]];
  state.items.forEach((item) => {
    rows.push([item.index, item.groupNo, item.productFileName, item.priceFileName, item.cardFileName, item.gridFileName, item.note || ""]);
  });
  return rows.map((row) => row.map(csvCell).join(",")).join("\r\n");
}

function csvCell(value) {
  const text = String(value ?? "");
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function safeFileName(value) {
  return String(value || "costco_capture").replace(/[\\/:*?"<>|]+/g, "_");
}

async function createZip(files) {
  const chunks = [];
  const central = [];
  let offset = 0;

  for (const file of files) {
    const data = file.text != null
      ? new TextEncoder().encode(file.text)
      : new Uint8Array(await file.blob.arrayBuffer());
    const nameBytes = new TextEncoder().encode(file.name);
    const crc = crc32(data);
    const local = concatBytes([
      u32(0x04034b50), u16(20), u16(0), u16(0), u16(0), u16(0),
      u32(crc), u32(data.length), u32(data.length), u16(nameBytes.length), u16(0), nameBytes
    ]);
    chunks.push(local, data);
    central.push(concatBytes([
      u32(0x02014b50), u16(20), u16(20), u16(0), u16(0), u16(0), u16(0),
      u32(crc), u32(data.length), u32(data.length), u16(nameBytes.length), u16(0), u16(0),
      u16(0), u16(0), u32(0), u32(offset), nameBytes
    ]));
    offset += local.length + data.length;
  }

  const centralSize = central.reduce((sum, part) => sum + part.length, 0);
  const end = concatBytes([
    u32(0x06054b50), u16(0), u16(0), u16(files.length), u16(files.length),
    u32(centralSize), u32(offset), u16(0)
  ]);
  return new Blob([...chunks, ...central, end], { type: "application/zip" });
}

function concatBytes(parts) {
  const length = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(length);
  let cursor = 0;
  parts.forEach((part) => {
    out.set(part, cursor);
    cursor += part.length;
  });
  return out;
}

function u16(value) {
  const bytes = new Uint8Array(2);
  new DataView(bytes.buffer).setUint16(0, value, true);
  return bytes;
}

function u32(value) {
  const bytes = new Uint8Array(4);
  new DataView(bytes.buffer).setUint32(0, value >>> 0, true);
  return bytes;
}

function crc32(data) {
  let crc = -1;
  for (let i = 0; i < data.length; i += 1) {
    crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ data[i]) & 0xff];
  }
  return (crc ^ -1) >>> 0;
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let c = i;
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[i] = c >>> 0;
  }
  return table;
})();

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("./sw.js").catch(() => {});
}

loadState().then(render).catch((error) => {
  console.error(error);
  $("#app").innerHTML = `<main class="app-shell"><div class="notice">本地数据库初始化失败：${escapeHtml(error.message)}</div></main>`;
});
