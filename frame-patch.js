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
    const fontSize = fitText(ctx, title, width - 16, Math.floor(height * 0.54), 16);
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
    `;
    note.closest(".field")?.before(field);
    const input = field.querySelector("input");
    input.value = currentTitle();
    input.addEventListener("input", () => {
      localStorage.setItem(TITLE_KEY, input.value.trim());
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
    ctx.save();
    ctx.strokeStyle = "#4b5563";
    ctx.lineWidth = 3;
    ctx.strokeRect(1.5, 1.5, width - 3, height - 3);
    drawTitleBar(ctx, 4, dividerY - 38, width - 8, 36, currentTitle());
    ctx.fillStyle = "#fff";
    ctx.fillRect(4, dividerY - 1, width - 8, 2);
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
      drawTitleBar(ctx, x + 4, y + Math.round(cellH * 0.72) - 34, cellW - 8, 32, titles[index]);
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
