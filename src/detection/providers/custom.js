const { makeCandidate, processMatchesCustomTool } = require('../helpers');

function classifyCustom(proc, context, config) {
  for (const tool of config.customTools || []) {
    if (!processMatchesCustomTool(proc, tool)) {
      continue;
    }

    return makeCandidate(proc, {
      toolKey: tool.key,
      toolName: tool.name,
      icon: tool.icon || '?',
      color: tool.color || 'magenta',
      confidence: 0.9,
      source: 'custom-config',
      fallbackPrefix: tool.key,
      idSeed: `${tool.key}:${proc.pid}`,
    }, context);
  }

  return null;
}

module.exports = {
  classifyCustom,
};

