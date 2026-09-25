const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const targetDir = path.join(root, "www");

fs.mkdirSync(targetDir, { recursive: true });
fs.copyFileSync(path.join(root, "index.html"), path.join(targetDir, "index.html"));

console.log("Web-App vorbereitet.");
