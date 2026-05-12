(() => {
  const originalToBlob = HTMLCanvasElement.prototype.toBlob;

  function strokeCard(ctx, width, height) {
    const dividerY = Math.round(height * 0.73);
    ctx.save();
    ctx.strokeStyle = "#111827";
    ctx.lineWidth = 8;
    ctx.strokeRect(8, 8, width - 16, height - 16);
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.moveTo(12, dividerY);
    ctx.lineTo(width - 12, dividerY);
    ctx.stroke();
    ctx.strokeStyle = "#cbd5e1";
    ctx.lineWidth = 3;
    ctx.strokeRect(16, dividerY + 12, width - 32, height - dividerY - 28);
    ctx.restore();
  }

  function strokeGrid(ctx, width, height) {
    const pad = 24;
    const gap = 10;
    const watermarkH = 54;
    const cellW = Math.floor((width - pad * 2 - gap * 2) / 3);
    const contentH = height - pad * 2 - watermarkH;
    const cellH = Math.floor((contentH - gap * 2) / 3);
    ctx.save();
    ctx.strokeStyle = "#111827";
    ctx.lineWidth = 6;
    for (let index = 0; index < 9; index += 1) {
      const col = index % 3;
      const row = Math.floor(index / 3);
      const x = pad + col * (cellW + gap);
      const y = pad + row * (cellH + gap);
      ctx.strokeRect(x + 3, y + 3, cellW - 6, cellH - 6);
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
