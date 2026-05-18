// esbuild.js — bundles the extension for production
const esbuild = require("esbuild");
const fs = require("fs");
const path = require("path");

const production = process.argv.includes("--production");

async function main() {
  await esbuild.build({
    entryPoints: ["src/extension.ts"],
    bundle: true,
    platform: "node",
    target: "node18",
    format: "cjs",
    external: ["vscode"],
    outfile: "out/extension.js",
    minify: production,
    sourcemap: !production,
    logLevel: "info",
  });

  // Copy webview static assets into out/
  const src = path.join(__dirname, "src", "ui", "webview");
  const dst = path.join(__dirname, "out", "ui", "webview");
  fs.mkdirSync(dst, { recursive: true });
  for (const f of fs.readdirSync(src)) {
    fs.copyFileSync(path.join(src, f), path.join(dst, f));
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
