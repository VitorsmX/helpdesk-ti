const fs = require("fs");
const path = require("path");
const babel = require("@babel/core");
const { minify } = require("terser");
const CleanCSS = require("clean-css");

const root = path.resolve(__dirname, "..");
const publicDir = path.join(root, "public");
const distDir = path.join(publicDir, "dist");
const legacyMode = process.argv.includes("--legacy") || process.env.BUILD_TARGET === "legacy";
const outputDir = legacyMode ? path.join(distDir, "legacy") : distDir;

const jsFiles = [
  "app-shell.js",
  "dashboard-charts.js",
  "dashboard-tabs.js",
  "hardware-modals.js",
  "notifications.js",
  "report-date-picker.js",
  "session-keeper.js",
  "sidebar-accordion.js",
  "tickets-new.js",
];

const cssFiles = ["app.css"];

async function buildJs(fileName) {
  const inputPath = path.join(publicDir, fileName);
  if (!fs.existsSync(inputPath)) return;

  const source = fs.readFileSync(inputPath, "utf8");
  const transpiled = babel.transformSync(source, {
    presets: [[
      "@babel/preset-env",
      {
        targets: legacyMode ? "defaults, ie 11" : ">0.5%, not dead",
        bugfixes: true,
      },
    ]],
    babelrc: false,
    configFile: false,
    comments: false,
  });
  const minified = await minify(transpiled.code, {
    compress: true,
    mangle: true,
    format: { comments: false },
  });

  const outName = fileName.replace(/\.js$/, ".min.js");
  fs.writeFileSync(path.join(outputDir, outName), minified.code || transpiled.code, "utf8");
  console.log(`built ${legacyMode ? "legacy/" : ""}${outName}`);
}

function buildCss(fileName) {
  const inputPath = path.join(publicDir, fileName);
  if (!fs.existsSync(inputPath)) return;

  const source = fs.readFileSync(inputPath, "utf8");
  const minified = new CleanCSS({ level: 2 }).minify(source);
  if (minified.errors.length) {
    throw new Error(minified.errors.join("\n"));
  }

  const outName = fileName.replace(/\.css$/, ".min.css");
  fs.writeFileSync(path.join(outputDir, outName), minified.styles, "utf8");
  console.log(`built ${legacyMode ? "legacy/" : ""}${outName}`);
}

async function main() {
  fs.mkdirSync(outputDir, { recursive: true });
  cssFiles.forEach(buildCss);
  for (const file of jsFiles) {
    await buildJs(file);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
