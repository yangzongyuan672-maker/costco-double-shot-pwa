(() => {
  const originalToBlob = HTMLCanvasElement.prototype.toBlob;
  const TITLE_KEY = "costco_title_current";
  const TITLES_KEY = "costco_title_queue";

  function getTitles() {
    try {
      return JSON.parse(localStorage.getItem(TITLES_KEY) || "[]");
    } catch {
      return [];
    }
  }

  function setTitles(titles) {
    localStorage.setItem(TITLES_KEY, JSON.stringify(titles));
  }

  function currentTitle() {
    return (localStorage.getItem(TITLE_KEY) || "").trim();
  }

  function imageBlobToDataUrl(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ""));
      reader.onerror = () => reject(reader.error || new Error("图片读取失败"));
      reader.readAsDataURL(blob);
    });
  }

  async function priceImageDataUrl() {
    const previewImages = Array.from(document.querySelectorAll(".preview img"));
    const priceImage = previewImages[1];
    if (!priceImage?.src) throw new Error("请先拍价格标签图");
    const response = await fetch(priceImage.src);
    const blob = await response.blob();
    return imageBlobToDataUrl(blob);
  }

  async function generateTitle(button) {
    const input = document.getElementById("titleZh");
    if (!input) return;
    const oldText = button.textContent;
    button.disabled = true;
    button.textContent = "识别中...";
    try {
      const image = await priceImageDataUrl();
      const endpoint = window.COSTCO_AI_ENDPOINT || "/api/generate-title";
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ image })
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "AI 识别失败");
      input.value = data.title || "";
      localStorage.setItem(TITLE_KEY, input.value.trim());
    } catch (error) {
      alert(error.message || "AI 识别失败");
    } finally {
      button.disabled = false;
      button.textContent = oldText;
    }
  }

  function fitText(ctx, text, maxWidth, maxSize, minSize) {
    let size = maxSize;
    while (size > minSize) {
      ctx.font = `800 ${size}px system-ui, sans-serif`;
      if (ctx.measureText(text).width <= maxWidth) return size;
      size -= 1;
    }
    return minSize;
  }

  function drawTitleBar(ctx, x, y, width, height, title) {
    if (!title) return;
    ctx.save();
    ctx.fillStyle = "#facc15";
    ctx.fillRect(x, y, width, height);
    ctx.fillStyle = "#111827";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    const fontSize = fitText(ctx, title, width - 14, Math.floor(height * 0.62), 18);
    ctx.font = `800 ${fontSize}px system-ui, sans-serif`;
    ctx.fillText(title, x + width / 2, y + height / 2 + 1);
    ctx.restore();
  }

  function installTitleField() {
    const existing = document.getElementById("titleZh");
    const note = document.getElementById("note");
    if (!note || existing) return;
    const field = document.createElement("div");
    field.className = "field";
    field.innerHTML = `
      <label for="titleZh">中文商品名</label>
      <input id="titleZh" class="input" placeholder="例如：三件装收纳盒" />
      <button id="aiTitleBtn" class="btn warn" type="button">AI生成中文名</button>
    `;
    note.closest(".field")?.before(field);
    const input = field.querySelector("input");
    input.value = currentTitle();
    input.addEventListener("input", () => {
      localStorage.setItem(TITLE_KEY, input.value.trim());
    });
    field.querySelector("#aiTitleBtn")?.addEventListener("click", (event) => {
      generateTitle(event.currentTarget);
    });
  }

  document.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    if (target.id === "saveNext" && !target.disabled) {
      const titles = getTitles();
      titles.push(currentTitle());
      setTitles(titles);
      setTimeout(() => {
        localStorage.setItem(TITLE_KEY, "");
        const input = document.getElementById("titleZh");
        if (input) input.value = "";
      }, 250);
    }
    if (target.id === "deleteDraft") {
      localStorage.setItem(TITLE_KEY, "");
    }
    if (target.id === "clearTask" || target.id === "newTask") {
      localStorage.removeItem(TITLES_KEY);
      localStorage.removeItem(TITLE_KEY);
    }
  }, true);

  new MutationObserver(installTitleField).observe(document.documentElement, {
    childList: true,
    subtree: true
  });
  document.addEventListener("DOMContentLoaded", installTitleField);

  function strokeCard(ctx, width, height) {
    const dividerY = Math.round(height * 0.72);
    const titleH = Math.round(height * 0.09);
    ctx.save();
    ctx.strokeStyle = "#4b5563";
    ctx.lineWidth = 3;
    ctx.strokeRect(1.5, 1.5, width - 3, height - 3);
    drawTitleBar(ctx, 3, dividerY - titleH, width - 6, titleH, currentTitle());
    ctx.restore();
  }

  function strokeGrid(ctx, width, height) {
    const oldPad = 24;
    const oldGap = 10;
    const oldWatermarkH = 54;
    const oldCellW = Math.floor((width - oldPad * 2 - oldGap * 2) / 3);
    const oldContentH = height - oldPad * 2 - oldWatermarkH;
    const oldCellH = Math.floor((oldContentH - oldGap * 2) / 3);
    const copy = document.createElement("canvas");
    copy.width = width;
    copy.height = height;
    copy.getContext("2d").drawImage(ctx.canvas, 0, 0);

    const pad = 0;
    const gap = 0;
    const cellW = Math.floor((width - pad * 2 - gap * 2) / 3);
    const cellH = Math.floor((height - pad * 2 - gap * 2) / 3);
    const titles = getTitles();
    const groupNo = Math.max(1, Math.ceil(titles.length / 9));
    const titleH = Math.round(cellH * 0.1);

    ctx.save();
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, width, height);
    for (let index = 0; index < 9; index += 1) {
      const col = index % 3;
      const row = Math.floor(index / 3);
      const oldX = oldPad + col * (oldCellW + oldGap);
      const oldY = oldPad + row * (oldCellH + oldGap);
      const x = pad + col * (cellW + gap);
      const y = pad + row * (cellH + gap);
      ctx.drawImage(copy, oldX + 6, oldY + 6, oldCellW - 12, oldCellH - 12, x, y, cellW, cellH);
      drawTitleBar(ctx, x + 2, y + Math.round(cellH * 0.72) - titleH, cellW - 4, titleH, titles[index]);
    }

    ctx.strokeStyle = "#4b5563";
    ctx.lineWidth = 4;
    ctx.strokeRect(2, 2, width - 4, height - 4);
    ctx.beginPath();
    ctx.moveTo(cellW, 0);
    ctx.lineTo(cellW, height);
    ctx.moveTo(cellW * 2, 0);
    ctx.lineTo(cellW * 2, height);
    ctx.moveTo(0, cellH);
    ctx.lineTo(width, cellH);
    ctx.moveTo(0, cellH * 2);
    ctx.lineTo(width, cellH * 2);
    ctx.stroke();

    const badgeText = `第${String(groupNo).padStart(2, "0")}组`;
    ctx.font = "20px system-ui, sans-serif";
    ctx.fillStyle = "rgba(17, 24, 39, 0.72)";
    ctx.textAlign = "right";
    ctx.textBaseline = "bottom";
    ctx.fillText(badgeText, width - 10, height - 8);

    ctx.restore();
  }

  HTMLCanvasElement.prototype.toBlob = function patchedToBlob(callback, type, quality) {
    try {
      const ctx = this.getContext("2d");
      if (ctx && this.width === 400 && (this.height === 560 || this.height === 600)) {
        strokeCard(ctx, this.width, this.height);
      }
      if (ctx && this.width === 1080 && this.height === 1440) {
        strokeGrid(ctx, this.width, this.height);
      }
    } catch {
      // Export should never fail just because the visual frame could not be drawn.
    }
    return originalToBlob.call(this, callback, type, quality);
  };
})();
