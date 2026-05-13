import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL(".", import.meta.url));
const port = Number(process.env.PORT || 4173);
const apiKey = process.env.OPENAI_API_KEY;
const model = process.env.OPENAI_MODEL || "gpt-5.4-mini";
const maxBodyBytes = 8 * 1024 * 1024;

const types = {
  ".html": "text/html;charset=utf-8",
  ".js": "text/javascript;charset=utf-8",
  ".css": "text/css;charset=utf-8",
  ".svg": "image/svg+xml",
  ".webmanifest": "application/manifest+json"
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
    if (size > maxBodyBytes) throw new Error("图片太大，请重拍或压缩后再识别");
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
    .replace(/["“”]/g, "")
    .replace(/^中文商品名[:：]\s*/i, "")
    .trim()
    .split(/\r?\n/)[0]
    .replace(/[。.,，;；]+$/g, "")
    .slice(0, 20);
}

function titlePrompt() {
  return [
    "你是加拿大 Costco 价格标签识别助手。",
    "请读取图片里的英文商品名称，只输出适合小红书图片标题的中文商品名。",
    "规则：不要品牌名，不要型号，不要商品编号，不要价格；可以保留几件装、容量、口味、规格；如果看不清，输出空字符串。",
    "只输出中文商品名本身，最多 12 个中文字符。"
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
    const message = data.error?.message || "AI 识别失败";
    const error = new Error(message);
    error.status = response.status;
    throw error;
  }
  return data;
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
    sendJson(res, 500, { error: "Railway 还没有设置 OPENAI_API_KEY" });
    return;
  }

  try {
    const body = await readJson(req);
    const image = String(body.image || "");
    if (!image.startsWith("data:image/")) {
      sendJson(res, 400, { error: "请先拍价格标签图" });
      return;
    }

    const data = await callOpenAI([
      { type: "input_text", text: titlePrompt() },
      { type: "input_image", image_url: image, detail: "high" }
    ], 80);

    sendJson(res, 200, { title: cleanTitle(extractOutputText(data)), model });
  } catch (error) {
    sendJson(res, error.status || 500, { error: error.message || "AI 识别失败" });
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
    sendJson(res, 500, { error: "Railway 还没有设置 OPENAI_API_KEY" });
    return;
  }

  try {
    const body = await readJson(req);
    const images = Array.isArray(body.images) ? body.images.slice(0, 9).map(String) : [];
    if (!images.length || images.some((image) => !image.startsWith("data:image/"))) {
      sendJson(res, 400, { error: "请先提供本组价格标签图" });
      return;
    }

    const content = [
      {
        type: "input_text",
        text: [
          "你是加拿大 Costco 价格标签识别助手。",
          "下面是同一组商品的价格标签图。请分别读取英文商品名称，并翻译成适合小红书九宫格黄色标题条的中文商品名。",
          "规则：不要品牌名，不要型号，不要商品编号，不要价格；可以保留几件装、容量、口味、规格；看不清就输出空字符串。",
          `请严格输出 JSON 数组，长度必须是 ${images.length}，数组元素只放中文商品名，每个最多 12 个中文字符。`
        ].join("\n")
      },
      ...images.map((image) => ({ type: "input_image", image_url: image, detail: "high" }))
    ];

    const data = await callOpenAI(content, 220);
    const text = extractOutputText(data).replace(/```json|```/g, "").trim();
    let titles;
    try {
      titles = JSON.parse(text);
    } catch {
      titles = text.split(/\r?\n/).map((line) => line.replace(/^\s*\d+[.、)\-]\s*/, ""));
    }
    titles = Array.from({ length: images.length }, (_, index) => cleanTitle(titles[index] || ""));
    sendJson(res, 200, { titles, model });
  } catch (error) {
    sendJson(res, error.status || 500, { error: error.message || "AI 批量识别失败" });
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
