const { commandInvokes, makeCandidate } = require('../helpers');
const { findDesktopAppRoot } = require('./desktopApp');

function classifyClaude(proc, context) {
  if (isClaudeDesktopProcess(proc)) {
    const root = findDesktopAppRoot(proc, context, isClaudeDesktopRoot);
    if (root) {
      return makeCandidate(proc, {
        id: `claude-desktop:${root.pid || 'app'}`,
        toolKey: 'claude-desktop',
        toolName: 'Claude Desktop',
        icon: 'C',
        color: 'yellow',
        confidence: 0.9,
        source: 'claude-detector',
        surface: 'desktop',
        fallbackPrefix: 'claude-app',
        idSeed: `claude-desktop:${root.pid || 'app'}`,
      }, context);
    }
  }

  if (!isClaudeCodeProcess(proc) || !context.hasTerminalAncestor(proc)) {
    return null;
  }

  const root = context.findAncestor(proc, isClaudeCodeProcess) || proc;
  return makeCandidate(proc, {
    id: `claude-code:${root.pid}`,
    toolKey: 'claude-code',
    toolName: 'Claude Code',
    icon: 'C',
    color: 'yellow',
    confidence: 0.9,
    source: 'claude-detector',
    surface: 'terminal',
    fallbackPrefix: 'claude',
    idSeed: `claude-code:${root.pid}`,
  }, context);
}

function isClaudeDesktopRoot(proc) {
  const command = proc.command || '';
  const lower = proc.lowerCommand || '';
  return /\/applications\/claude\.app\/contents\/macos\/claude(?:\s|$)/i.test(command)
    || /\/applications\/claude desktop\.app\/contents\/macos\//i.test(command)
    || lower.includes('com.anthropic.claude')
    // Windows (Microsoft Store / MSIX)
    || (/[\\/](windowsapps|packages)[\\/]claude_/i.test(command)
      && /claude\.exe/i.test(command)
      && !lower.includes('chrome-native-host'))
    // Windows (Standard Installer)
    || (/[\\/]Claude[\\/]Claude\.exe/i.test(command))
    // Generic check for claude.exe running as desktop app
    || (!proc.tty && /claude\.exe/i.test(proc.name));
}

function isClaudeDesktopProcess(proc) {
  const command = proc.command || '';
  const lower = proc.lowerCommand || '';
  const name = proc.lowerName || '';
  return /\/applications\/claude\.app\//i.test(command)
    || /\/applications\/claude desktop\.app\//i.test(command)
    || lower.includes('com.anthropic.claude')
    || name.startsWith('claude helper')
    || /[\\/](windowsapps|packages)[\\/]claude_/i.test(command)
    || /[\\/]Claude[\\/]/i.test(command)
    || /claude\.exe/i.test(name);
}

function isClaudeCodeProcess(proc) {
  const lower = proc.lowerCommand || '';
  return commandInvokes(proc, 'claude')
    || commandInvokes(proc, 'claude-code')
    || lower.includes('@anthropic-ai/claude-code')
    || lower.includes('claude-code');
}

module.exports = {
  classifyClaude,
  isClaudeCodeProcess,
  isClaudeDesktopRoot,
  isClaudeDesktopProcess,
};
