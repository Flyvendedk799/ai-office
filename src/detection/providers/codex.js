const { commandInvokes, makeCandidate } = require('../helpers');
const { findDesktopAppRoot } = require('./desktopApp');

function classifyCodex(proc, context) {
  const desktop = isCodexDesktopProcess(proc);
  const cli = !desktop && isCodexCliProcess(proc);

  if (!desktop && !cli) {
    return null;
  }

  if (desktop) {
    const root = findDesktopAppRoot(proc, context, isCodexDesktopRoot);
    if (!root) {
      return null;
    }
    return makeCandidate(proc, {
      id: `codex-desktop:${root.pid || 'app'}`,
      toolKey: 'codex-desktop',
      toolName: 'Codex Desktop',
      icon: 'D',
      color: 'blue',
      confidence: 0.9,
      source: 'codex-detector',
      surface: 'desktop',
      fallbackPrefix: 'codex-app',
      idSeed: `codex-desktop:${root.pid || 'app'}`,
    });
  }

  const root = context.findAncestor(proc, isCodexCliProcess) || proc;

  return makeCandidate(proc, {
    id: `codex-cli:${root.pid}`,
    toolKey: 'codex-cli',
    toolName: 'Codex CLI',
    icon: 'C',
    color: 'cyan',
    confidence: 0.92,
    source: 'codex-detector',
    surface: 'terminal',
    fallbackPrefix: 'codex',
    idSeed: `codex-cli:${root.pid}`,
  });
}

function isCodexDesktopRoot(proc) {
  const command = proc.command || '';
  const lower = proc.lowerCommand || '';
  return /\/codex\.app\/contents\/macos\/codex(?:\s|$)/i.test(command)
    || /\/codex computer use\.app\/contents\/macos\//i.test(command)
    || lower.includes('com.openai.codex');
}

function isCodexDesktopProcess(proc) {
  const command = proc.command || '';
  const lower = proc.lowerCommand || '';
  const name = proc.lowerName || '';
  return /\/codex\.app\//i.test(command)
    || /\/codex computer use\.app\//i.test(command)
    || lower.includes('com.openai.codex')
    || name.startsWith('codex helper');
}

function isCodexCliProcess(proc) {
  const lower = proc.lowerCommand || '';
  return commandInvokes(proc, 'codex')
    || lower.includes('@openai/codex')
    || lower.includes('openai-codex');
}

module.exports = {
  classifyCodex,
  isCodexCliProcess,
  isCodexDesktopRoot,
  isCodexDesktopProcess,
};
