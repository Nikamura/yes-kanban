/**
 * Generates a modern HTML coverage report from bun's lcov.info output.
 * Zero dependencies — runs with `bun run scripts/coverage-html.ts`.
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";
import { join, dirname, basename } from "path";

interface FileCoverage {
  path: string;
  lines: Map<number, number>; // line number -> hit count
  totalLines: number;
  coveredLines: number;
  totalFunctions: number;
  coveredFunctions: number;
}

function parseLcov(lcovPath: string): FileCoverage[] {
  const content = readFileSync(lcovPath, "utf-8");
  const files: FileCoverage[] = [];
  let current: FileCoverage | null = null;

  for (const line of content.split("\n")) {
    if (line.startsWith("SF:")) {
      current = {
        path: line.slice(3),
        lines: new Map(),
        totalLines: 0,
        coveredLines: 0,
        totalFunctions: 0,
        coveredFunctions: 0,
      };
    } else if (line.startsWith("DA:") && current) {
      const [lineNo, hits] = line.slice(3).split(",").map(Number);
      current.lines.set(lineNo, hits);
    } else if (line.startsWith("LF:") && current) {
      current.totalLines = parseInt(line.slice(3));
    } else if (line.startsWith("LH:") && current) {
      current.coveredLines = parseInt(line.slice(3));
    } else if (line.startsWith("FNF:") && current) {
      current.totalFunctions = parseInt(line.slice(4));
    } else if (line.startsWith("FNH:") && current) {
      current.coveredFunctions = parseInt(line.slice(4));
    } else if (line === "end_of_record" && current) {
      files.push(current);
      current = null;
    }
  }
  return files;
}

function pct(covered: number, total: number): number {
  return total === 0 ? 100 : Math.round((covered / total) * 1000) / 10;
}

function coverageColor(pct: number): string {
  if (pct >= 80) return "var(--green)";
  if (pct >= 50) return "var(--yellow)";
  return "var(--red)";
}

function generateFileHtml(file: FileCoverage, sourcePath: string): string {
  const linePct = pct(file.coveredLines, file.totalLines);
  let sourceLines: string[];
  try {
    sourceLines = readFileSync(sourcePath, "utf-8").split("\n");
  } catch {
    return "";
  }

  const codeLines = sourceLines
    .map((line, i) => {
      const lineNo = i + 1;
      const hits = file.lines.get(lineNo);
      let cls = "neutral";
      let badge = "";
      if (hits !== undefined) {
        cls = hits > 0 ? "covered" : "uncovered";
        badge = `<span class="hits">${hits > 0 ? hits + "×" : "!"}</span>`;
      }
      const escaped = line
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
      return `<tr class="${cls}"><td class="line-no">${lineNo}</td><td class="hit-col">${badge}</td><td class="code"><pre>${escaped}</pre></td></tr>`;
    })
    .join("\n");

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${file.path} — Coverage</title>
<style>${css}
.code-table { width: 100%; border-collapse: collapse; font-size: 13px; }
.code-table td { padding: 0 8px; vertical-align: top; white-space: pre; }
.code-table pre { margin: 0; font-family: 'SF Mono', 'Fira Code', monospace; }
.line-no { color: var(--muted); text-align: right; user-select: none; width: 1%; padding-right: 12px; border-right: 1px solid var(--border); }
.hit-col { width: 40px; text-align: center; font-size: 11px; font-weight: 600; }
tr.covered .hit-col { color: var(--green); }
tr.uncovered .hit-col { color: var(--red); }
tr.covered { background: rgba(46, 160, 67, 0.08); }
tr.uncovered { background: rgba(248, 81, 73, 0.1); }
</style>
</head>
<body>
<div class="container">
  <div style="margin-bottom: 16px">
    <a href="index.html" style="color: var(--accent); text-decoration: none; font-size: 14px">← Back</a>
  </div>
  <h1>${file.path}</h1>
  <div class="summary-row" style="margin-bottom: 24px">
    <div class="stat-card">
      <div class="stat-value" style="color: ${coverageColor(linePct)}">${linePct}%</div>
      <div class="stat-label">Lines ${file.coveredLines}/${file.totalLines}</div>
    </div>
  </div>
  <table class="code-table">${codeLines}</table>
</div>
</body></html>`;
}

const css = `
:root {
  --bg: #0d1117; --surface: #161b22; --border: #30363d;
  --text: #e6edf3; --muted: #7d8590; --accent: #58a6ff;
  --green: #3fb950; --yellow: #d29922; --red: #f85149;
}
* { box-sizing: border-box; margin: 0; padding: 0; }
body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: var(--bg); color: var(--text); }
.container { max-width: 960px; margin: 0 auto; padding: 32px 16px; }
h1 { font-size: 22px; font-weight: 600; margin-bottom: 24px; }
.summary-row { display: flex; gap: 16px; flex-wrap: wrap; }
.stat-card { background: var(--surface); border: 1px solid var(--border); border-radius: 12px; padding: 20px 24px; min-width: 140px; }
.stat-value { font-size: 28px; font-weight: 700; }
.stat-label { font-size: 13px; color: var(--muted); margin-top: 4px; }
.tree { margin-top: 24px; }
details { border: 1px solid var(--border); border-radius: 8px; margin-bottom: 8px; background: var(--surface); }
details[open] { background: var(--bg); }
summary { cursor: pointer; padding: 12px 16px; display: flex; align-items: center; gap: 12px; font-size: 14px; font-weight: 600; list-style: none; user-select: none; }
summary::-webkit-details-marker { display: none; }
summary::before { content: '▸'; color: var(--muted); font-size: 12px; transition: transform 0.15s; }
details[open] > summary::before { transform: rotate(90deg); }
summary:hover { background: var(--surface); }
.dir-meta { margin-left: auto; display: flex; align-items: center; gap: 12px; font-weight: 400; }
.file-list { padding: 0; }
.file-row { display: flex; align-items: center; gap: 12px; padding: 8px 16px 8px 40px; border-top: 1px solid var(--border); font-size: 14px; }
.file-row:hover { background: var(--surface); }
.file-row a { color: var(--accent); text-decoration: none; flex: 1; }
.file-row a:hover { text-decoration: underline; }
.bar { height: 6px; border-radius: 3px; background: var(--border); overflow: hidden; width: 100px; }
.bar-fill { height: 100%; border-radius: 3px; }
.pct { font-variant-numeric: tabular-nums; font-weight: 500; min-width: 50px; text-align: right; }
.lines { color: var(--muted); font-size: 13px; min-width: 60px; text-align: right; }
`;

// --- Main ---
const repoRoot = join(import.meta.dir, "..");
const lcovPath = join(repoRoot, "coverage", "lcov.info");
const outDir = join(repoRoot, "coverage", "html");

if (!existsSync(lcovPath)) {
  console.error("No coverage/lcov.info found. Run `bun run test:coverage` first.");
  process.exit(1);
}

const files = parseLcov(lcovPath);
mkdirSync(outDir, { recursive: true });

// Generate per-file pages
for (const file of files) {
  const sourcePath = join(repoRoot, file.path);
  const html = generateFileHtml(file, sourcePath);
  if (!html) continue;
  const safeFileName = file.path.replace(/\//g, "-") + ".html";
  writeFileSync(join(outDir, safeFileName), html);
}

// Totals
const totalLines = files.reduce((s, f) => s + f.totalLines, 0);
const coveredLines = files.reduce((s, f) => s + f.coveredLines, 0);
const totalFns = files.reduce((s, f) => s + f.totalFunctions, 0);
const coveredFns = files.reduce((s, f) => s + f.coveredFunctions, 0);
const linePct = pct(coveredLines, totalLines);
const fnPct = pct(coveredFns, totalFns);

// Group files by directory
const groups = new Map<string, FileCoverage[]>();
for (const f of files) {
  const dir = dirname(f.path);
  if (!groups.has(dir)) groups.set(dir, []);
  groups.get(dir)!.push(f);
}

let treeSections = "";
for (const [dir, dirFiles] of [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
  const dirTotalLines = dirFiles.reduce((s, f) => s + f.totalLines, 0);
  const dirCoveredLines = dirFiles.reduce((s, f) => s + f.coveredLines, 0);
  const dirPct = pct(dirCoveredLines, dirTotalLines);

  let fileItems = "";
  for (const f of dirFiles.sort((a, b) => a.path.localeCompare(b.path))) {
    const lp = pct(f.coveredLines, f.totalLines);
    const safeFileName = f.path.replace(/\//g, "-") + ".html";
    fileItems += `<div class="file-row">
      <a href="${safeFileName}">${basename(f.path)}</a>
      <span class="pct" style="color:${coverageColor(lp)}">${lp}%</span>
      <div class="bar"><div class="bar-fill" style="width:${lp}%;background:${coverageColor(lp)}"></div></div>
      <span class="lines">${f.coveredLines}/${f.totalLines}</span>
    </div>`;
  }

  treeSections += `<details>
    <summary>
      <span>${dir}/</span>
      <div class="dir-meta">
        <span class="pct" style="color:${coverageColor(dirPct)}">${dirPct}%</span>
        <div class="bar"><div class="bar-fill" style="width:${dirPct}%;background:${coverageColor(dirPct)}"></div></div>
        <span class="lines">${dirCoveredLines}/${dirTotalLines}</span>
      </div>
    </summary>
    <div class="file-list">${fileItems}</div>
  </details>`;
}

const indexHtml = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Coverage Report</title>
<style>${css}</style>
</head>
<body>
<div class="container">
  <h1>Coverage Report</h1>
  <div class="summary-row">
    <div class="stat-card">
      <div class="stat-value" style="color: ${coverageColor(linePct)}">${linePct}%</div>
      <div class="stat-label">Line coverage</div>
    </div>
    <div class="stat-card">
      <div class="stat-value" style="color: ${coverageColor(fnPct)}">${fnPct}%</div>
      <div class="stat-label">Function coverage</div>
    </div>
    <div class="stat-card">
      <div class="stat-value">${files.length}</div>
      <div class="stat-label">Files</div>
    </div>
    <div class="stat-card">
      <div class="stat-value">${coveredLines}<span style="font-size:16px;color:var(--muted)">/${totalLines}</span></div>
      <div class="stat-label">Lines covered</div>
    </div>
  </div>
  <div class="tree">${treeSections}</div>
</div>
</body></html>`;

writeFileSync(join(outDir, "index.html"), indexHtml);
console.log(`Coverage report generated: coverage/html/index.html`);
console.log(`  Lines: ${linePct}% (${coveredLines}/${totalLines})`);
console.log(`  Functions: ${fnPct}% (${coveredFns}/${totalFns})`);
console.log(`  Files: ${files.length}`);
