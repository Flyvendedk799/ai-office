const { makeCandidate } = require('../helpers');

function classifyGeneric(proc, context) {
  const lower = (proc.command || '').toLowerCase().split(/\s+/).slice(0, 4).join(' ');
  const hasGenericAgentName = /\b(?:ai|llm|gpt|code|coding)[-_ ]?agent\b/i.test(lower)
    || /\bagent[-_ ]?(?:ai|llm|gpt|code|coding)\b/i.test(lower)
    || /\bai[-_ ]?assistant\b/i.test(lower);
  const launchedFromTerminal = context.hasTerminalAncestor(proc);

  if (!launchedFromTerminal || !hasGenericAgentName) {
    return null;
  }

  return makeCandidate(proc, {
    toolKey: 'unknown-agent',
    toolName: 'Unknown AI Agent',
    icon: '?',
    color: 'magenta',
    confidence: 0.45,
    source: 'generic-detector',
    fallbackPrefix: 'agent',
    idSeed: `unknown:${proc.pid}`,
  });
}

module.exports = {
  classifyGeneric,
};
