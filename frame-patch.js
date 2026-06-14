(() => {
  const originalToBlob = HTMLCanvasElement.prototype.toBlob;
  const TITLE_KEY = "costco_title_current";
  const TITLES_KEY = "costco_title_queue";
  const TITLE_YELLOW = "#facc15";
  const GRID_PINK = "#ff4fa3";
  const TEXT_DARK = "#111827";
  const TITLE_INSET_X = 25;
  const PRICE_RATIO = 0.35;
  let guidedCameraStream = null;

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
      reader.onerror = () => reject(reader.error || new Error("Image read failed"));
      reader.readAsDataURL(blob);
    });
  }

  async function priceImageDataUrl() {
    const previewImages = Array.from(document.querySelectorAll(".preview img"));
    const priceImage = previewImages[1];
    if (!priceImage?.src) throw new Error("Take the price tag photo first");
    const response = await fetch(priceImage.src);
    const blob = await response.blob();
    return imageBlobToDataUrl(blob);
  }

  async function productImageDataUrl() {
    const previewImages = Array.from(document.querySelectorAll(".preview img"));
    const productImage = previewImages[0];
    if (!productImage?.src) return "";
    const response = await fetch(productImage.src);
    const blob = await response.blob();
    return imageBlobToDataUrl(blob);
  }

  async function generateTitle(button) {
    const input = document.getElementById("titleZh");
    if (!input) return;
    const oldText = button.textContent;
    button.disabled = true;
    button.textContent = "AI...";
    try {
      const [image, productImage] = await Promise.all([priceImageDataUrl(), productImageDataUrl()]);
      const endpoint = window.COSTCO_AI_ENDPOINT || "/api/generate-title";
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ image, productImage })
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "AI title failed");
      input.value = data.title || "";
      localStorage.setItem(TITLE_KEY, input.value.trim());
    } catch (error) {
      alert(error.message || "AI title failed");
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

  function fileFromBlob(blob, slot) {
    return new File([blob], slot === "productBlob" ? "product_camera.jpg" : "price_camera.jpg", {
      type: "image/jpeg"
    });
  }

  function sendBlobToApp(slot, blob) {
    const input = document.getElementById(slot === "productBlob" ? "productInput" : "priceInput");
    if (!input || typeof DataTransfer === "undefined") {
      throw new Error("This browser cannot pass the web camera photo back. Use system camera backup.");
    }
    const transfer = new DataTransfer();
    transfer.items.add(fileFromBlob(blob, slot));
    input.files = transfer.files;
    input.dispatchEvent(new Event("change", { bubbles: true }));
  }

  function stopGuidedCamera() {
    guidedCameraStream?.getTracks().forEach((track) => track.stop());
    guidedCameraStream = null;
  }

  function closeGuidedCamera(modal) {
    if (modal?._syncGuidedFrame) {
      window.removeEventListener("resize", modal._syncGuidedFrame);
      window.removeEventListener("orientationchange", modal._syncGuidedFrame);
    }
    stopGuidedCamera();
    modal?.remove();
  }

  async function setGuidedZoom(video, zoom, status) {
    const track = guidedCameraStream?.getVideoTracks?.()[0];
    const requestedZoom = zoom;
    const targetZoom = calibratedGuidedZoom(zoom);
    let hardwareZoom = 1;
    let usedHardware = false;

    if (track?.getCapabilities && track.applyConstraints) {
      const capabilities = track.getCapabilities();
      if (typeof capabilities.zoom === "object") {
        const min = Number(capabilities.zoom.min || 1);
        const max = Number(capabilities.zoom.max || targetZoom);
        const step = Number(capabilities.zoom.step || 0.1);
        hardwareZoom = Math.max(min, Math.min(targetZoom, max));
        hardwareZoom = Math.round(hardwareZoom / step) * step;
        try {
          await track.applyConstraints({ advanced: [{ zoom: hardwareZoom }] });
          usedHardware = hardwareZoom > 1 || zoom === 1;
        } catch {
          hardwareZoom = 1;
        }
      }
    }

    video.style.transform = "none";

    if (!status) return;
    if (usedHardware) {
      status.textContent = `${requestedZoom}x 校准视角`;
    } else {
      status.textContent = "当前浏览器不支持相机变焦，保持1x原始画面";
    }
  }

  function calibratedGuidedZoom(zoom) {
    if (zoom <= 1) return 1;
    return 1 + (zoom - 1) * 0.5;
  }

  async function captureGuidedFrame(video, frame, maxSide) {
    if (!video.videoWidth || !video.videoHeight) throw new Error("Camera is not ready yet. Tap again.");

    const videoRect = renderedVideoRect(video);
    const frameRect = frameContentRect(frame);
    const cropRect = intersectRects(videoRect, frameRect);
    if (!cropRect) throw new Error("Frame is outside the camera image. Adjust and shoot again.");

    const sx = ((cropRect.left - videoRect.left) / videoRect.width) * video.videoWidth;
    const sy = ((cropRect.top - videoRect.top) / videoRect.height) * video.videoHeight;
    const sw = (cropRect.width / videoRect.width) * video.videoWidth;
    const sh = (cropRect.height / videoRect.height) * video.videoHeight;
    const outputScale = Math.min(1, maxSide / Math.max(sw, sh));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(sw * outputScale);
    canvas.height = Math.round(sh * outputScale);
    const ctx = canvas.getContext("2d", { alpha: false });
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(video, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
    return new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.94));
  }

  function renderedVideoRect(video) {
    const rect = video.getBoundingClientRect();
    const videoRatio = video.videoWidth / video.videoHeight;
    const boxRatio = rect.width / rect.height;
    if (boxRatio > videoRatio) {
      const height = rect.height;
      const width = height * videoRatio;
      return {
        left: rect.left + (rect.width - width) / 2,
        top: rect.top,
        width,
        height
      };
    }
    const width = rect.width;
    const height = width / videoRatio;
    return {
      left: rect.left,
      top: rect.top + (rect.height - height) / 2,
      width,
      height
    };
  }

  function intersectRects(a, b) {
    const left = Math.max(a.left, b.left);
    const top = Math.max(a.top, b.top);
    const right = Math.min(a.left + a.width, b.left + b.width);
    const bottom = Math.min(a.top + a.height, b.top + b.height);
    if (right <= left || bottom <= top) return null;
    return { left, top, width: right - left, height: bottom - top };
  }

  function frameContentRect(frame) {
    const rect = frame.getBoundingClientRect();
    const style = getComputedStyle(frame);
    const leftBorder = parseFloat(style.borderLeftWidth) || 0;
    const rightBorder = parseFloat(style.borderRightWidth) || 0;
    const topBorder = parseFloat(style.borderTopWidth) || 0;
    const bottomBorder = parseFloat(style.borderBottomWidth) || 0;
    return {
      left: rect.left + leftBorder,
      top: rect.top + topBorder,
      width: Math.max(1, rect.width - leftBorder - rightBorder),
      height: Math.max(1, rect.height - topBorder - bottomBorder)
    };
  }

  function syncGuidedFrame(video, modal, isPrice) {
    if (!video.videoWidth || !video.videoHeight) return;
    const frame = modal.querySelector(".camera-frame");
    const hint = modal.querySelector(".camera-hint");
    const stageRect = modal.querySelector(".camera-stage").getBoundingClientRect();
    const videoRect = renderedVideoRect(video);
    const ratio = isPrice ? 414 / 194 : 414 / 359;
    const maxWidth = isPrice ? Number.POSITIVE_INFINITY : 440;
    const widthFactor = isPrice ? 0.995 : 0.94;
    const width = Math.max(220, Math.min(maxWidth, videoRect.width * widthFactor, videoRect.height * 0.78 * ratio));
    const height = width / ratio;
    const centerX = videoRect.left - stageRect.left + videoRect.width / 2;
    const centerY = videoRect.top - stageRect.top + videoRect.height / 2;

    frame.style.width = `${width}px`;
    frame.style.height = `${height}px`;
    frame.style.left = `${centerX}px`;
    frame.style.top = `${centerY}px`;

    if (hint) {
      hint.style.left = `${centerX}px`;
      hint.style.top = `${Math.min(stageRect.height - 44, centerY + height / 2 + 10)}px`;
      hint.style.width = `${width}px`;
    }
  }

  async function openGuidedCamera(slot) {
    if (!navigator.mediaDevices?.getUserMedia) return false;

    stopGuidedCamera();
    const isPrice = slot === "priceBlob";
    const modal = document.createElement("div");
    modal.className = "camera-modal";
    modal.innerHTML = `
      <div class="camera-stage ${isPrice ? "price-mode" : "product-mode"}">
        <video id="cameraVideo" autoplay playsinline muted></video>
        <div class="camera-mask"></div>
        <div class="camera-frame"></div>
        <div class="camera-hint">${isPrice ? "把价格牌、英文名和价格放进框内" : "把商品主体放进框内"}</div>
      </div>
      <div class="camera-zoom">
        <button class="zoom-pill active" data-zoom="1" type="button">1x</button>
        <button class="zoom-pill" data-zoom="2" type="button">2x</button>
        <button class="zoom-pill" data-zoom="3" type="button">3x</button>
      </div>
      <div class="camera-zoom-status" id="cameraZoomStatus">1x 原始画面</div>
      <div class="camera-controls">
        <button class="btn ghost" id="closeCamera" type="button">取消</button>
        <button class="btn primary" id="snapCamera" type="button">拍摄</button>
        <button class="btn ghost" id="fallbackCamera" type="button">系统相机</button>
      </div>
    `;
    document.body.appendChild(modal);

    const video = modal.querySelector("#cameraVideo");
    try {
      guidedCameraStream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: "environment" },
          width: { ideal: 2560 },
          height: { ideal: 1440 }
        },
        audio: false
      });
      video.srcObject = guidedCameraStream;
      await video.play();
      syncGuidedFrame(video, modal, isPrice);
      modal._syncGuidedFrame = () => syncGuidedFrame(video, modal, isPrice);
      window.addEventListener("resize", modal._syncGuidedFrame);
      window.addEventListener("orientationchange", modal._syncGuidedFrame);
    } catch {
      closeGuidedCamera(modal);
      return false;
    }

    modal.querySelector("#closeCamera").addEventListener("click", () => closeGuidedCamera(modal));
    modal.querySelectorAll("[data-zoom]").forEach((button) => {
      button.addEventListener("click", async () => {
        const zoom = Number(button.dataset.zoom || 1);
        await setGuidedZoom(video, zoom, modal.querySelector("#cameraZoomStatus"));
        modal.querySelectorAll("[data-zoom]").forEach((item) => item.classList.toggle("active", item === button));
      });
    });
    modal.querySelector("#fallbackCamera").addEventListener("click", () => {
      closeGuidedCamera(modal);
      document.getElementById(isPrice ? "priceInput" : "productInput")?.click();
    });
    modal.querySelector("#snapCamera").addEventListener("click", async () => {
      try {
        const blob = await captureGuidedFrame(video, modal.querySelector(".camera-frame"), isPrice ? 1600 : 1800);
        closeGuidedCamera(modal);
        sendBlobToApp(slot, blob);
      } catch (error) {
        alert(error.message || "Shoot failed. Please try again.");
      }
    });
    return true;
  }

  document.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    if ((target.id === "productShot" || target.id === "priceShot") && !target.disabled) {
      const slot = target.id === "productShot" ? "productBlob" : "priceBlob";
      event.preventDefault();
      event.stopImmediatePropagation();
      openGuidedCamera(slot).then((opened) => {
        if (!opened) document.getElementById(slot === "productBlob" ? "productInput" : "priceInput")?.click();
      });
      return;
    }
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
    const splitY = Math.round(height * PRICE_RATIO);
    drawTitleBar(
      ctx,
      TITLE_INSET_X,
      splitY - Math.round(titleH / 3),
      width - TITLE_INSET_X * 2,
      titleH,
      currentTitle()
    );
  }

  function decorateGrid(ctx, width, height) {
    const titles = getTitles();
    const groupNo = Math.max(1, Math.ceil(titles.length / 9));
    const lineW = 5;

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

    const badgeText = `第${String(groupNo).padStart(2, "0")}组`;
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
