(() => {
  const originalToBlob = HTMLCanvasElement.prototype.toBlob;

  function strokeCard(ctx, width, height) {
    const dividerY = height === 600 ? 430 : Math.round(height * 0.73);
    ctx.save();
    ctx.strokeStyle = "#111827";
    ctx.lineWidth = 10;
    ctx.strokeRect(5, 5, width - 10, height - 10);
    ctx.fillStyle = "#fff";
    ctx.fillRect(10, dividerY, width - 20, 4);
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

    const pad = 10;
    const gap = 8;
    const cellW = Math.floor((width - pad * 2 - gap * 2) / 3);
    const cellH = Math.floor((height - pad * 2 - gap * 2) / 3);

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
      ctx.drawImage(copy, oldX, oldY, oldCellW, oldCellH, x, y, cellW, cellH);
    }

    ctx.strokeStyle = "#111827";
    ctx.lineWidth = 5;
    for (let index = 0; index < 9; index += 1) {
      const col = index % 3;
      const row = Math.floor(index / 3);
      const x = pad + col * (cellW + gap);
      const y = pad + row * (cellH + gap);
      ctx.strokeRect(x + 2, y + 2, cellW - 4, cellH - 4);
    }
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
