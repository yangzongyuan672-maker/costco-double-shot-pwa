(() => {
  const MARK = "v2Processed";
  const TITLE_TEXT = "Costco 双拍 V2";
  const SUBTITLE_TEXT = "系统相机 1:1 采集，价格牌取上三分之一";

  function setTextIfNeeded(element, text) {
    if (element && element.textContent !== text) element.textContent = text;
  }

  function showV2Brand() {
    setTextIfNeeded(document.querySelector(".brand h1"), TITLE_TEXT);
    setTextIfNeeded(document.querySelector(".brand p"), SUBTITLE_TEXT);
  }

  function canvasToFile(canvas, name) {
    return new Promise((resolve, reject) => {
      canvas.toBlob((blob) => {
        if (!blob) {
          reject(new Error("照片处理失败，请重拍"));
          return;
        }
        resolve(new File([blob], name, { type: "image/jpeg" }));
      }, "image/jpeg", 0.94);
    });
  }

  async function cropForSlot(file, slot) {
    const bitmap = await createImageBitmap(file);
    const square = Math.min(bitmap.width, bitmap.height);
    const sx = Math.round((bitmap.width - square) / 2);
    const sy = Math.round((bitmap.height - square) / 2);
    const maxSide = slot === "productBlob" ? 1800 : 1600;
    const outW = Math.round(Math.min(maxSide, square));
    const outH = slot === "productBlob" ? outW : Math.round(outW / 3);
    const sourceH = slot === "productBlob" ? square : Math.round(square / 3);

    const canvas = document.createElement("canvas");
    canvas.width = outW;
    canvas.height = outH;
    const ctx = canvas.getContext("2d", { alpha: false });
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, outW, outH);
    ctx.drawImage(bitmap, sx, sy, square, sourceH, 0, 0, outW, outH);
    bitmap.close?.();
    return canvasToFile(canvas, slot === "productBlob" ? "product_square.jpg" : "price_top_third.jpg");
  }

  function replaceInputFile(input, file) {
    const transfer = new DataTransfer();
    transfer.items.add(file);
    input.files = transfer.files;
  }

  document.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    if ((target.id === "productShot" || target.id === "priceShot") && !target.disabled) {
      event.preventDefault();
      event.stopImmediatePropagation();
      const input = document.getElementById(target.id === "productShot" ? "productInput" : "priceInput");
      input?.click();
    }
  }, true);

  document.addEventListener("change", async (event) => {
    const input = event.target;
    if (!(input instanceof HTMLInputElement)) return;
    if (input.id !== "productInput" && input.id !== "priceInput") return;
    if (input.dataset[MARK] === "1") {
      delete input.dataset[MARK];
      return;
    }

    const file = input.files?.[0];
    if (!file) return;

    event.preventDefault();
    event.stopImmediatePropagation();
    try {
      const slot = input.id === "productInput" ? "productBlob" : "priceBlob";
      const cropped = await cropForSlot(file, slot);
      input.dataset[MARK] = "1";
      replaceInputFile(input, cropped);
      input.dispatchEvent(new Event("change", { bubbles: true }));
    } catch (error) {
      delete input.dataset[MARK];
      alert(error.message || "照片处理失败，请重拍");
    }
  }, true);

  new MutationObserver(showV2Brand).observe(document.documentElement, {
    childList: true,
    subtree: true
  });
  document.addEventListener("DOMContentLoaded", showV2Brand);
  showV2Brand();
})();
