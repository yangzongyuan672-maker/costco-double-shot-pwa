(() => {
  const TITLE_TEXT = "Costco 双拍 V2";
  const SUBTITLE_TEXT = "系统相机采集，商品取底部方图，价格牌取顶部三分之一";
  const repair = {
    blob: null,
    url: "",
    selected: 1,
    text: ""
  };

  function setTextIfNeeded(element, text) {
    if (element && element.textContent !== text) element.textContent = text;
  }

  function showV2Brand() {
    setTextIfNeeded(document.querySelector(".brand h1"), TITLE_TEXT);
    setTextIfNeeded(document.querySelector(".brand p"), SUBTITLE_TEXT);
  }

  function installRepairStyles() {
    if (document.getElementById("repairGridStyles")) return;
    const style = document.createElement("style");
    style.id = "repairGridStyles";
    style.textContent = `
      .repair-preview{overflow:hidden;border:1px solid var(--line,#d7dee8);border-radius:8px;background:#f8fafc}
      .repair-preview img{display:block;width:100%;max-height:62vh;object-fit:contain}
      .repair-grid-picker{display:grid;grid-template-columns:repeat(3,1fr);gap:8px}
      .repair-grid-picker button{min-height:48px;border:1px solid var(--line,#d7dee8);border-radius:8px;background:#fff;color:var(--ink,#111827);font-size:18px;font-weight:850}
      .repair-grid-picker button.active{border-color:#facc15;background:#facc15}
    `;
    document.head.appendChild(style);
  }

  function installRepairButton() {
    if (document.getElementById("repairGrid")) return;
    const anchor = document.getElementById("downloadLatest") || document.getElementById("exportZip");
    const panel = anchor?.closest(".actions");
    if (!panel) return;
    const button = document.createElement("button");
    button.className = "btn ghost";
    button.id = "repairGrid";
    button.type = "button";
    button.textContent = "修正九宫格文字";
    button.addEventListener("click", renderRepairTool);
    anchor?.after(button);
  }

  function renderRepairTool() {
    installRepairStyles();
    const app = document.getElementById("app");
    if (!app) return;
    app.innerHTML = `
      <main class="app-shell">
        <header class="capture-header">
          <div class="line">
            <button class="btn ghost" id="repairBack" type="button">返回</button>
            <div>
              <h2>修正九宫格文字</h2>
              <div class="mini">上传成品图，选择格子，盖一个新的黄色标签</div>
            </div>
          </div>
        </header>
        <section class="stack">
          <div class="panel stack">
            <input id="repairInput" class="hidden-input" type="file" accept="image/*" />
            <button class="btn primary" id="chooseRepairImage" type="button">${repair.blob ? "重新上传九宫格" : "上传九宫格图片"}</button>
            ${repair.url ? `<div class="repair-preview"><img src="${repair.url}" alt="待修正九宫格"></div>` : `<div class="notice">请选择已经保存好的九宫格图片。</div>`}
          </div>
          <div class="panel stack">
            <div class="repair-grid-picker">
              ${Array.from({ length: 9 }, (_, index) => {
                const cell = index + 1;
                return `<button class="${repair.selected === cell ? "active" : ""}" data-repair-cell="${cell}" type="button">${cell}</button>`;
              }).join("")}
            </div>
            <div class="field">
              <label for="repairText">新的中文名</label>
              <input id="repairText" class="input" value="${escapeHtml(repair.text)}" placeholder="例如：洗衣凝珠" />
            </div>
            <button class="btn dark" id="downloadRepair" type="button" ${repair.blob && repair.text.trim() ? "" : "disabled"}>下载修正版</button>
          </div>
        </section>
      </main>
    `;

    document.getElementById("repairBack")?.addEventListener("click", () => window.location.reload());
    document.getElementById("chooseRepairImage")?.addEventListener("click", () => document.getElementById("repairInput")?.click());
    document.getElementById("repairInput")?.addEventListener("change", (event) => handleRepairFile(event.target.files?.[0]));
    document.getElementById("repairText")?.addEventListener("input", (event) => {
      repair.text = event.target.value;
      const download = document.getElementById("downloadRepair");
      if (download) download.disabled = !(repair.blob && repair.text.trim());
    });
    document.querySelectorAll("[data-repair-cell]").forEach((button) => {
      button.addEventListener("click", () => {
        repair.selected = Number(button.dataset.repairCell);
        renderRepairTool();
      });
    });
    document.getElementById("downloadRepair")?.addEventListener("click", downloadRepairedGrid);
  }

  function handleRepairFile(file) {
    if (!file) return;
    if (repair.url) URL.revokeObjectURL(repair.url);
    repair.blob = file;
    repair.url = URL.createObjectURL(file);
    renderRepairTool();
  }

  async function downloadRepairedGrid() {
    if (!repair.blob || !repair.text.trim()) return;
    const bitmap = await createImageBitmap(repair.blob);
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const ctx = canvas.getContext("2d", { alpha: false });
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(bitmap, 0, 0);
    bitmap.close?.();

    drawRepairTitle(ctx, canvas.width, canvas.height, repair.selected, repair.text.trim());
    const blob = await canvasToBlob(canvas, 0.96);
    downloadBlob(blob, `costco_grid_fixed_${String(repair.selected).padStart(2, "0")}.jpg`);
  }

  function drawRepairTitle(ctx, width, height, cellNo, title) {
    const col = (cellNo - 1) % 3;
    const row = Math.floor((cellNo - 1) / 3);
    const cellX = Math.round((width / 3) * col);
    const cellY = Math.round((height / 3) * row);
    const nextX = Math.round((width / 3) * (col + 1));
    const nextY = Math.round((height / 3) * (row + 1));
    const cellW = nextX - cellX;
    const cellH = nextY - cellY;
    const labelInset = Math.round(cellW * (64 / 600));
    const labelH = Math.round(cellH * 0.075);
    const labelY = Math.round(cellY + cellH / 3 - labelH * 0.15);
    const labelX = cellX + labelInset;
    const labelW = cellW - labelInset * 2;

    ctx.save();
    ctx.fillStyle = "#facc15";
    ctx.fillRect(labelX, labelY, labelW, labelH);
    ctx.fillStyle = "#111827";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    const fontSize = fitCanvasText(ctx, title, labelW - 24, Math.floor(labelH * 0.58), 12);
    ctx.font = `800 ${fontSize}px system-ui, sans-serif`;
    ctx.fillText(title, labelX + labelW / 2, labelY + labelH / 2 + 1);
    ctx.restore();
  }

  function fitCanvasText(ctx, text, maxWidth, maxSize, minSize) {
    let size = maxSize;
    while (size > minSize) {
      ctx.font = `800 ${size}px system-ui, sans-serif`;
      if (ctx.measureText(text).width <= maxWidth) return size;
      size -= 1;
    }
    return minSize;
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

  function escapeHtml(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;");
  }

  function installV2Extras() {
    showV2Brand();
    installRepairStyles();
    installRepairButton();
  }

  new MutationObserver(installV2Extras).observe(document.documentElement, {
    childList: true,
    subtree: true
  });
  document.addEventListener("DOMContentLoaded", installV2Extras);
  installV2Extras();
})();
