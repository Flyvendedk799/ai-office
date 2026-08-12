const { commandInvokes, makeCandidate } = require('../helpers');
const { findDesktopAppRoot } = require('./desktopApp');

function classifyCursor(proc, context) {
  if (!isCursorDesktopProcess(proc)) {
    return null;
  }

  const root = findDesktopAppRoot(proc, context, isCursorDesktopRoot);
  if (!root) {
    return null;
  }
  return makeCandidate(proc, {
    id: `cursor:desktop:${root.pid || 'app'}`,
    toolKey: 'cursor',
    toolName: 'Cursor',
    icon: 'X',
    color: 'magenta',
    confidence: 0.85,
    source: 'cursor-detector',
    surface: 'desktop',
    fallbackPrefix: 'cursor',
    idSeed: `cursor:desktop:${root.pid || 'app'}`,
  });
}

function isCursorDesktopRoot(proc) {
  const command = proc.command || '';
  const lower = proc.lowerCommand || '';
  const name = proc.lowerName || '';
  return /\/applications\/cursor\.app\/contents\/macos\/cursor(?:\s|$)/i.test(command)
    || lower.includes('com.todesktop.230313mzl4w4u92')
    || name === 'cursor';
}

function isCursorDesktopProcess(proc) {
  const command = proc.command || '';
  const lower = proc.lowerCommand || '';
  const name = proc.lowerName || '';
  return /\/applications\/cursor\.app\//i.test(command)
    || commandInvokes(proc, 'cursor')
    || lower.includes('com.todesktop.230313mzl4w4u92')
    || name.startsWith('cursor helper');
}

module.exports = {
  classifyCursor,
  isCursorDesktopRoot,
  isCursorDesktopProcess,
};
