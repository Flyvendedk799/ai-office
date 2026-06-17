const { makeCandidate } = require('../helpers');
const { commandInvokes } = require('../helpers');

const COLOR_BY_KEYWORD = {
  aider: 'yellow',
  amp: 'magenta',
  claude: 'yellow',
  'claude-code': 'yellow',
  gemini: 'cyan',
  goose: 'white',
  opencode: 'magenta',
  qwen: 'blue',
};

function classifyTerminalAgent(proc, context, config) {
  const keywords = config.terminalAgentKeywords || [];
  const inTerminal = context.hasTerminalAncestor(proc);
  if (!inTerminal) {
    return null;
  }

  const matched = keywords.find((keyword) => commandInvokes(proc, keyword));
  if (!matched) {
    return null;
  }

  const key = matched.toLowerCase().replace(/[^a-z0-9_-]+/g, '-');
  if (key === 'codex') {
    return null;
  }

  return makeCandidate(proc, {
    toolKey: key,
    toolName: displayName(matched),
    icon: key.slice(0, 1).toUpperCase(),
    color: COLOR_BY_KEYWORD[key] || 'yellow',
    confidence: inTerminal ? 0.8 : 0.65,
    source: 'terminal-agent-detector',
    fallbackPrefix: key,
    idSeed: `${key}:${proc.pid}`,
  });
}

function displayName(value) {
  return String(value)
    .split(/[-_]/)
    .map((part) => part.slice(0, 1).toUpperCase() + part.slice(1))
    .join(' ');
}

module.exports = {
  classifyTerminalAgent,
};
