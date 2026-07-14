import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL(".", import.meta.url));
const port = Number(process.env.PORT || 4173);
const apiKey = process.env.OPENAI_API_KEY;
const model = process.env.OPENAI_MODEL || "gpt-4o-mini";
const maxBodyBytes = 18 * 1024 * 1024;

const types = {
  ".html": "text/html;charset=utf-8",
  ".js": "text/javascript;charset=utf-8",
  ".css": "text/css;charset=utf-8",
  ".svg": "image/svg+xml",
  ".webmanifest": "application/manifest+json"
};

const messages = {
  tooLarge: "\u56fe\u7247\u592a\u5927\uff0c\u8bf7\u91cd\u62cd\u6216\u538b\u7f29\u540e\u518d\u8bc6\u522b",
  noKey: "Railway \u8fd8\u6ca1\u6709\u8bbe\u7f6e OPENAI_API_KEY",
  noPrice: "\u8bf7\u5148\u62cd\u4ef7\u683c\u6807\u7b7e\u56fe",
  noGroupPrices: "\u8bf7\u5148\u63d0\u4f9b\u672c\u7ec4\u4ef7\u683c\u6807\u7b7e\u56fe",
  aiFailed: "AI \u8bc6\u522b\u5931\u8d25",
  batchFailed: "AI \u6279\u91cf\u8bc6\u522b\u5931\u8d25"
};

function sendJson(res, status, data) {
  res.writeHead(status, {
    "Content-Type": "application/json;charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS"
  });
  res.end(JSON.stringify(data));
}

async function readJson(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > maxBodyBytes) throw new Error(messages.tooLarge);
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
}

function extractOutputText(response) {
  if (typeof response.output_text === "string") return response.output_text;
  const parts = [];
  for (const item of response.output || []) {
    for (const content of item.content || []) {
      if (content.type === "output_text" && content.text) parts.push(content.text);
    }
  }
  return parts.join("\n");
}

function cleanTitle(value) {
  return String(value || "")
    .replace(/```json|```/g, "")
    .replace(/["\u201c\u201d]/g, "")
    .replace(/^\u4e2d\u6587\u5546\u54c1\u540d[:\uff1a]\s*/i, "")
    .trim()
    .split(/\r?\n/)[0]
    .replace(/[\u3002.,\uff0c;\uff1b]+$/g, "")
    .slice(0, 32);
}

function titlePrompt() {
  return [
    "You identify Costco Canada products from photos.",
    "You may receive one or two images: first the product photo, second the price tag. If only one image is provided, use that image.",
    "When both images are provided, cross-check the visible product/package text with the price tag product name.",
    "Return one short, simple Simplified Chinese product-category translation for a yellow image label.",
    "Do not include price, item number, discount, rating, or marketing claims.",
    "Do not include brand names, store brands, model names, or item numbers when the product type is clear.",
    "Do not include detailed specs unless they are necessary to distinguish the product type.",
    "Use very simple Chinese words, usually 2 to 8 Chinese characters.",
    "Include simple quantity words only when they are clearly important, such as 2\u74f6, 3\u4ef6, 45\u5305.",
    "If you cannot confidently determine the product type, return the original readable English product title from the price tag exactly as shown, without translating or adding words.",
    "If the price tag title is partly cut off, return only the readable visible title text.",
    "Examples: Dove Antiperspirant Spray 3 x 107g -> \u6b62\u6c57\u55b7\u96fe3\u4ef6; Samsung Galaxy Tab -> \u5e73\u677f\u7535\u8111; Q-TIPS Cotton Swabs 2000 -> \u68c9\u7b7e2000\u652f; KIRKLAND SIGNATURE LAUNDRY DETERGENT PACS -> \u6d17\u8863\u51dd\u73e0; unclear product with visible label WEBBER NATURALS SUPER SLEEP -> WEBBER NATURALS SUPER SLEEP.",
    "Return only the label text."
  ].join("\n");
}

async function callOpenAI(content, maxOutputTokens) {
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model,
      input: [{ role: "user", content }],
      max_output_tokens: maxOutputTokens,
      store: false
    })
  });
  const data = await response.json();
  if (!response.ok) {
    const message = data.error?.message || messages.aiFailed;
    const error = new Error(message);
    error.status = response.status;
    throw error;
  }
  return data;
}

async function recognizeOneTitle(image, productImage = "") {
  const content = [{ type: "input_text", text: titlePrompt() }];
  if (productImage) content.push({ type: "input_image", image_url: productImage, detail: "high" });
  if (image) content.push({ type: "input_image", image_url: image, detail: "high" });
  const data = await callOpenAI(content, 120);
  return cleanTitle(extractOutputText(data));
}

function normalizeTitleImagePair(value) {
  if (typeof value === "string") return { image: value, productImage: "" };
  if (!value || typeof value !== "object") return { image: "", productImage: "" };
  return {
    image: String(value.image || value.priceImage || ""),
    productImage: String(value.productImage || "")
  };
}

function isImageDataUrl(value) {
  return !value || value.startsWith("data:image/");
}

async function handleGenerateTitle(req, res) {
  if (req.method === "OPTIONS") {
    sendJson(res, 204, {});
    return;
  }
  if (req.method !== "POST") {
    sendJson(res, 405, { error: "Method not allowed" });
    return;
  }
  if (!apiKey) {
    sendJson(res, 500, { error: messages.noKey });
    return;
  }

  try {
    const body = await readJson(req);
    const image = String(body.image || "");
    const productImage = String(body.productImage || "");
    if (!image.startsWith("data:image/") || !isImageDataUrl(productImage)) {
      sendJson(res, 400, { error: messages.noPrice });
      return;
    }

    sendJson(res, 200, { title: await recognizeOneTitle(image, productImage), model });
  } catch (error) {
    sendJson(res, error.status || 500, { error: error.message || messages.aiFailed });
  }
}

async function handleGenerateTitles(req, res) {
  if (req.method === "OPTIONS") {
    sendJson(res, 204, {});
    return;
  }
  if (req.method !== "POST") {
    sendJson(res, 405, { error: "Method not allowed" });
    return;
  }
  if (!apiKey) {
    sendJson(res, 500, { error: messages.noKey });
    return;
  }

  try {
    const body = await readJson(req);
    const images = Array.isArray(body.images) ? body.images.slice(0, 9).map(normalizeTitleImagePair) : [];
    if (!images.length || images.some(({ image, productImage }) => !image.startsWith("data:image/") || !isImageDataUrl(productImage))) {
      sendJson(res, 400, { error: messages.noGroupPrices });
      return;
    }

    const titles = await Promise.all(images.map(({ image, productImage }) => recognizeOneTitle(image, productImage)));
    sendJson(res, 200, { titles, model });
  } catch (error) {
    sendJson(res, error.status || 500, { error: error.message || messages.batchFailed });
  }
}

async function handleStatic(req, res) {
  try {
    const url = new URL(req.url || "/", "http://localhost");
    const pathname = decodeURIComponent(url.pathname === "/" ? "/index.html" : url.pathname);
    const filePath = resolve(join(root, pathname));
    if (!filePath.startsWith(resolve(root))) {
      res.writeHead(403);
      res.end("Forbidden");
      return;
    }
    const body = await readFile(filePath);
    res.writeHead(200, {
      "Content-Type": types[extname(filePath)] || "application/octet-stream",
      "Cache-Control": "no-store"
    });
    res.end(body);
  } catch {
    res.writeHead(404);
    res.end("Not found");
  }
}

createServer(async (req, res) => {
  const url = new URL(req.url || "/", "http://localhost");
  if (url.pathname === "/api/generate-title") {
    await handleGenerateTitle(req, res);
    return;
  }
  if (url.pathname === "/api/generate-titles") {
    await handleGenerateTitles(req, res);
    return;
  }
  await handleStatic(req, res);
}).listen(port, "0.0.0.0", () => {
  console.log(`Costco double shot app listening on http://0.0.0.0:${port}`);
});
