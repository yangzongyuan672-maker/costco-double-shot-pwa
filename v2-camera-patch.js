(() => {
  const TITLE_TEXT = "Costco 双拍 V2";
  const SUBTITLE_TEXT = "系统相机采集，商品取底部方图，价格牌取顶部三分之一";

  function setTextIfNeeded(element, text) {
    if (element && element.textContent !== text) element.textContent = text;
  }

  function showV2Brand() {
    setTextIfNeeded(document.querySelector(".brand h1"), TITLE_TEXT);
    setTextIfNeeded(document.querySelector(".brand p"), SUBTITLE_TEXT);
  }

  new MutationObserver(showV2Brand).observe(document.documentElement, {
    childList: true,
    subtree: true
  });
  document.addEventListener("DOMContentLoaded", showV2Brand);
  showV2Brand();
})();
