// One palette for every surface, so an agent is the same color in the office,
// the dashboard, and the demo.

const VENDOR_COLORS = {
  claude: 'yellow',
  codex: 'cyan',
  cursor: 'magenta',
  gemini: 'blue',
  aider: 'green',
  goose: 'white',
  amp: 'magenta',
  qwen: 'blue',
  opencode: 'magenta',
};

const UI = {
  wall: 'gray',
  floor: 'gray',
  desk: 'gray',
  plant: 'green',
  coffee: 'yellow',
  couch: 'blue',
  skyDay: 'cyan',
  skyNight: 'blue',
  clock: 'white',
  frame: 'gray',
  muted: 'gray',
  fg: 'white',
  accent: 'cyan',
};

function inferVendor(agent) {
  const key = String(`${agent?.toolKey || ''} ${agent?.toolName || ''}`).toLowerCase();
  for (const vendor of Object.keys(VENDOR_COLORS)) {
    if (key.includes(vendor)) {
      return vendor;
    }
  }
  return 'ai';
}

function vendorColor(vendorOrAgent) {
  const vendor = typeof vendorOrAgent === 'string' ? vendorOrAgent : inferVendor(vendorOrAgent);
  return VENDOR_COLORS[vendor] || 'white';
}

module.exports = {
  UI,
  VENDOR_COLORS,
  inferVendor,
  vendorColor,
};
