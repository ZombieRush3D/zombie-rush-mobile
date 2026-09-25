const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const source = path.join(root, "index.html");
const targetDir = path.join(root, "www");
const target = path.join(targetDir, "index.html");

const apiUrl = String(process.env.ZOMBIE_RUSH_API_URL || "")
  .trim()
  .replace(/\/+$/, "");

fs.mkdirSync(targetDir, { recursive: true });

let html = fs.readFileSync(source, "utf8");

if (apiUrl) {
  const configScript = `<script>window.ZOMBIE_RUSH_API_URL = ${JSON.stringify(apiUrl)};</script>`;
  html = html.replace(/<head>/i, `<head>\n    ${configScript}`);
}

fs.writeFileSync(target, html);

console.log(`Web-App vorbereitet. API: ${apiUrl || "same-origin"}`);
