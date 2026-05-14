(() => {
  const originalToBlob = HTMLCanvasElement.prototype.toBlob;
  const TITLE_KEY = "costco_title_current";
  const TITLES_KEY = "costco_title_queue";
  const TITLE_YELLOW = "#facc15";
  const GRID_PINK = "#ff4fa3";
  const TEXT_DARK = "#111827";
  const TITLE_INSET_X = 8;
  const TITLE_INSET_Y = 6;

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
      reader.onerror = () => reject(reader.error || new Error("\u56fe\u7247\u8bfb\u53d6\u5931\u8d25"));
      reader.readAsDataURL(blob);
    });
  }

  async function priceImageDataUrl() {
    const previewImages = Array.from(document.querySelectorAll(".preview img"));
    const priceImage = previewImages[1];
    if (!priceImage?.src) throw new Error("\u8bf7\u5148\u62cd\u4ef7\u683c\u6807\u7b7e\u56fe");
    const response = await fetch(priceImage.src);
    const blob = await response.blob();
    return imageBlobToDataUrl(blob);
  }

  async function generateTitle(button) {
    const input = document.getElementById("titleZh");
    if (!input) return;
    const oldText = button.textContent;
    button.disabled = true;
    button.textContent = "\u8bc6\u522b\u4e2d...";
    try {
      const image = await priceImageDataUrl();
      const endpoint = window.COSTCO_AI_ENDPOINT || "/api/generate-title";
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ image })
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "AI \u8bc6\u522b\u5931\u8d25");
      input.value = data.title || "";
      localStorage.setItem(TITLE_KEY, input.value.trim());
    } catch (error) {
      alert(error.message || "AI \u8bc6\u522b\u5931\u8d25");
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
    ctx.fillStyle = TITLE_YELLOW;
    ctx.fillRect(x, y, width, height);
    ctx.fillStyle = TEXT_DARK;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    const fontSize = fitText(ctx, title, width - 24, Math.floor(height * 0.58), 20);
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
      <label for="titleZh">\u4e2d\u6587\u5546\u54c1\u540d</label>
      <input id="titleZh" class="input" placeholder="\u4f8b\u5982\uff1a\u4e09\u4ef6\u88c5\u6536\u7eb3\u76d2" />
      <button id="aiTitleBtn" class="btn warn" type="button">AI\u751f\u6210\u4e2d\u6587\u540d</button>
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

  function installCaptureActionRow() {
    const product = document.getElementById("productShot");
    const price = document.getElementById("priceShot");
    const save = document.getElementById("saveNext");
    if (!product || !price || !save) return;
    if (product.parentElement?.classList.contains("capture-action-row")) return;

    const row = document.createElement("div");
    row.className = "capture-action-row";
    product.before(row);
    row.append(product, price, save);
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

  function installCaptureEnhancements() {
    installTitleField();
    installCaptureActionRow();
  }

  new MutationObserver(installCaptureEnhancements).observe(document.documentElement, {
    childList: true,
    subtree: true
  });
  document.addEventListener("DOMContentLoaded", installCaptureEnhancements);

  function decorateCard(ctx, width, height) {
    const titleH = Math.round(height * 0.105);
    drawTitleBar(
      ctx,
      TITLE_INSET_X,
      TITLE_INSET_Y,
      width - TITLE_INSET_X * 2,
      titleH,
      currentTitle()
    );
  }

  function decorateGrid(ctx, width, height) {
    const titles = getTitles();
    const groupNo = Math.max(1, Math.ceil(titles.length / 9));
    const lineW = 4;

    ctx.save();
    ctx.strokeStyle = GRID_PINK;
    ctx.lineWidth = lineW;
    ctx.beginPath();
    for (let col = 0; col <= 3; col += 1) {
      const x = Math.round((width / 3) * col) + (col === 0 ? lineW / 2 : col === 3 ? -lineW / 2 : 0);
      ctx.moveTo(x, 0);
      ctx.lineTo(x, height);
    }
    for (let row = 0; row <= 3; row += 1) {
      const y = Math.round((height / 3) * row) + (row === 0 ? lineW / 2 : row === 3 ? -lineW / 2 : 0);
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
    }
    ctx.stroke();

    const badgeText = `\u7b2c${String(groupNo).padStart(2, "0")}\u7ec4`;
    ctx.font = "20px system-ui, sans-serif";
    ctx.fillStyle = "rgba(17, 24, 39, 0.78)";
    ctx.textAlign = "right";
    ctx.textBaseline = "bottom";
    ctx.fillText(badgeText, width - 10, height - 8);
    ctx.restore();
  }

  HTMLCanvasElement.prototype.toBlob = function patchedToBlob(callback, type, quality) {
    try {
      const ctx = this.getContext("2d");
      if (ctx && this.width === 414 && this.height === 553) {
        decorateCard(ctx, this.width, this.height);
      }
      if (ctx && this.width === 1242 && this.height === 1660) {
        decorateGrid(ctx, this.width, this.height);
      }
    } catch {
      // Export should never fail just because the visual decoration could not be drawn.
    }
    return originalToBlob.call(this, callback, type, quality);
  };
})();
