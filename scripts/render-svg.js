// Render the demo office/dashboard into animated SVGs for the README.
// Deterministic: frames are pure functions of a fixed timeline.
//
//   node scripts/render-svg.js
//
// writes assets/demo.svg (animated office) and assets/dashboard.svg (still).

const fs = require('fs');
const path = require('path');
const { renderOffice } = require('../src/tui/office');
const { renderDashboard } = require('../src/tui/dashboard');
const { DemoDiscovery } = require('../src/demo');

const COLS = 84;
const ROWS = 26;
const CHAR_W = 8.42;
const ROW_H = 17;
const FONT_SIZE = 14;
const PAD = 16;
const CHROME_H = 36;

// A GitHub-dark-friendly terminal palette.
const PALETTE = {
  red: '#ff7b72',
  green: '#7ee787',
  yellow: '#e3b341',
  blue: '#79c0ff',
  magenta: '#d2a8ff',
  cyan: '#76e3ea',
  white: '#e6edf3',
  gray: '#767f8b',
  grey: '#767f8b',
  black: '#21262d',
  default: '#adb6c2',
};

function esc(text) {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// Blessed-tagged line -> [{ text, color, bold }]
function parseLine(line) {
  const runs = [];
  let color;
  let bold = false;
  let buffer = '';
  const flush = () => {
    if (buffer) {
      runs.push({ text: buffer, color, bold });
      buffer = '';
    }
  };
  const pattern = /\{(\/|bold|\w+-fg|\w+-bg)\}/g;
  let last = 0;
  let match;
  while ((match = pattern.exec(line)) !== null) {
    buffer += line.slice(last, match.index);
    last = pattern.lastIndex;
    const tag = match[1];
    if (tag === '/') {
      flush();
      color = undefined;
      bold = false;
    } else if (tag === 'bold') {
      flush();
      bold = true;
    } else if (tag.endsWith('-fg')) {
      flush();
      color = tag.slice(0, -3);
    }
  }
  buffer += line.slice(last);
  flush();
  return runs;
}

function rowSvg(line) {
  const runs = parseLine(line);
  const spans = runs.map((run) => {
    const fill = PALETTE[run.color] || PALETTE.default;
    const weight = run.bold ? ' font-weight="600"' : '';
    return `<tspan fill="${fill}"${weight}>${esc(run.text)}</tspan>`;
  }).join('');
  const plain = line.replace(/\{[^}]*\}/g, '');
  const width = (plain.length * CHAR_W).toFixed(1);
  return `<text xml:space="preserve" textLength="${width}" lengthAdjust="spacingAndGlyphs">${spans}</text>`;
}

function buildSvg(frames, { durationS }) {
  const width = Math.round(COLS * CHAR_W + PAD * 2);
  const height = Math.round(ROWS * ROW_H + PAD * 2 + CHROME_H);

  // Identical rows repeat across frames (walls, furniture) — define each unique
  // row once and reference it, which keeps the SVG small.
  const defs = new Map();
  const frameGroups = frames.map((frame, frameIndex) => {
    const uses = frame.split('\n').slice(0, ROWS).map((line, rowIndex) => {
      const svg = rowSvg(line);
      if (!defs.has(svg)) {
        defs.set(svg, `r${defs.size}`);
      }
      const y = CHROME_H + PAD + (rowIndex + 1) * ROW_H - 4;
      return `<use href="#${defs.get(svg)}" x="${PAD}" y="${y}"/>`;
    }).join('');
    const delay = frames.length > 1 ? ` style="animation-delay:${(frameIndex * durationS / frames.length).toFixed(2)}s"` : '';
    const cls = frames.length > 1 ? ' class="fr"' : '';
    return `<g${cls}${delay}>${uses}</g>`;
  });

  const defEntries = [...defs.entries()]
    .map(([svg, id]) => svg.replace('<text ', `<text id="${id}" `))
    .join('\n    ');

  const animationCss = frames.length > 1 ? `
    .fr { visibility: hidden; animation: show ${durationS}s infinite step-end; }
    @keyframes show {
      0% { visibility: visible; }
      ${(100 / frames.length).toFixed(3)}% { visibility: hidden; }
    }` : '';

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" font-family="ui-monospace, 'Cascadia Code', 'JetBrains Mono', Menlo, Consolas, monospace" font-size="${FONT_SIZE}">
  <style>
    text { white-space: pre; }${animationCss}
  </style>
  <rect width="${width}" height="${height}" rx="10" fill="#0d1117" stroke="#30363d"/>
  <circle cx="22" cy="19" r="5.5" fill="#ff5f57"/>
  <circle cx="42" cy="19" r="5.5" fill="#febc2e"/>
  <circle cx="62" cy="19" r="5.5" fill="#28c840"/>
  <text x="${width / 2}" y="24" text-anchor="middle" fill="#767f8b" font-size="12">ai-office</text>
  <defs>
    ${defEntries}
  </defs>
  ${frameGroups.join('\n  ')}
</svg>
`;
}

async function main() {
  // A fixed weekday afternoon, so the wall clock reads 14:0x and the sun is up.
  const baseNow = new Date(2026, 7, 12, 14, 0, 0).getTime();
  const demo = new DemoDiscovery({ logger: null });
  demo.startedAt = baseNow;

  const frames = [];
  const frameCount = 36;
  const stepMs = 400;
  for (let index = 0; index < frameCount; index += 1) {
    const now = baseNow + 500 + index * stepMs;
    const agents = await demo.discover(now);
    frames.push(renderOffice({
      agents,
      width: COLS,
      height: ROWS,
      now,
      selectedId: 'demo-claude-terminal',
    }));
  }
  const outDir = path.join(__dirname, '..', 'assets');
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'demo.svg'), buildSvg(frames, { durationS: (frameCount * stepMs) / 1000 }));

  const dashNow = baseNow + 62000;
  const dashAgents = await demo.discover(dashNow);
  const dashboard = renderDashboard({
    agents: dashAgents,
    width: COLS,
    height: ROWS,
    now: dashNow,
    selectedId: 'demo-codex-terminal',
    sortKey: 'cpu',
    cpuHistory: [4, 9, 22, 48, 31, 62, 84, 41, 23, 12, 35, 58],
  });
  fs.writeFileSync(path.join(outDir, 'dashboard.svg'), buildSvg([dashboard], { durationS: 1 }));

  for (const file of ['demo.svg', 'dashboard.svg']) {
    const size = fs.statSync(path.join(outDir, file)).size;
    console.log(`${file}: ${(size / 1024).toFixed(0)} KB`);
  }
}

main();
