const { classifyCustom } = require('./providers/custom');
const { classifyCodex } = require('./providers/codex');
const { classifyClaude } = require('./providers/claude');
const { classifyCursor } = require('./providers/cursor');
const { classifyTerminalAgent } = require('./providers/terminalAgent');
const { classifyGeneric } = require('./providers/generic');
const { matchesPattern } = require('../util/text');

const PROVIDERS = [
  classifyCustom,
  classifyCodex,
  classifyClaude,
  classifyCursor,
  classifyTerminalAgent,
  classifyGeneric,
];

function classifyProcesses(processes, context, config, logger) {
  const raw = [];
  for (const proc of processes) {
    if (isExcluded(proc, config)) {
      continue;
    }

    for (const provider of PROVIDERS) {
      const candidate = provider(proc, context, config);
      if (candidate) {
        raw.push(candidate);
        break;
      }
    }
  }

  const merged = mergeCandidates(raw);
  logger?.debug('classification summary', {
    raw: raw.length,
    merged: merged.length,
    tools: merged.map((agent) => agent.toolKey),
  });
  return merged;
}

function isExcluded(proc, config) {
  if (proc.pid === process.pid) {
    return true;
  }
  return (config.excludePatterns || []).some((pattern) => (
    matchesPattern(proc.command, pattern) || matchesPattern(proc.name, pattern)
  ));
}

function mergeCandidates(candidates) {
  const byId = new Map();
  for (const candidate of candidates) {
    const existing = byId.get(candidate.id);
    if (!existing) {
      byId.set(candidate.id, {
        ...candidate,
        pids: [...new Set(candidate.pids || [candidate.pid])],
        metricsByPid: { ...(candidate.metricsByPid || {}) },
      });
      continue;
    }

    existing.pids = [...new Set([...(existing.pids || []), ...(candidate.pids || [candidate.pid])])].sort((a, b) => a - b);
    existing.metricsByPid = { ...(existing.metricsByPid || {}), ...(candidate.metricsByPid || {}) };
    existing.startedAt = Math.min(existing.startedAt || candidate.startedAt, candidate.startedAt || existing.startedAt);
    existing.runtimeMs = Math.max(existing.runtimeMs || 0, candidate.runtimeMs || 0);
    const previousConfidence = existing.confidence || 0;
    existing.confidence = Math.max(previousConfidence, candidate.confidence || 0);
    if (candidate.statusHint === 'active') {
      existing.statusHint = 'active';
    }
    if (!existing.projectPath && candidate.projectPath) {
      existing.projectPath = candidate.projectPath;
      existing.projectLabel = candidate.projectLabel;
    }
    if ((!existing.sessionName || existing.sessionName === 'desktop-app') && candidate.sessionName) {
      existing.sessionName = candidate.sessionName;
    }
    if (!existing.surface && candidate.surface) {
      existing.surface = candidate.surface;
    }
    for (const field of ['title', 'currentTask', 'activity', 'toolCall', 'modelName', 'lastActivityAt', 'metadataSource', 'metadataPath']) {
      if (!existing[field] && candidate[field]) {
        existing[field] = candidate[field];
      }
    }
    if ((candidate.command || '').length < (existing.command || '').length || candidate.confidence > previousConfidence) {
      existing.command = candidate.command;
      existing.pid = candidate.pid;
      existing.parentPid = candidate.parentPid;
    }
  }

  return [...byId.values()].map(aggregateMetrics).sort((a, b) => {
    if (b.confidence !== a.confidence) {
      return b.confidence - a.confidence;
    }
    return a.toolName.localeCompare(b.toolName);
  });
}

function aggregateMetrics(candidate) {
  const entries = Object.values(candidate.metricsByPid || {});
  if (entries.length === 0) {
    return candidate;
  }
  let cpu = 0;
  let mem = 0;
  let rssKb = 0;
  let hasCpu = false;
  let hasMem = false;
  let hasRss = false;
  for (const entry of entries) {
    if (Number.isFinite(entry.cpu)) {
      cpu += entry.cpu;
      hasCpu = true;
    }
    if (Number.isFinite(entry.mem)) {
      mem += entry.mem;
      hasMem = true;
    }
    if (Number.isFinite(entry.rssKb)) {
      rssKb += entry.rssKb;
      hasRss = true;
    }
  }
  return {
    ...candidate,
    cpu: hasCpu ? Math.round(cpu * 10) / 10 : undefined,
    mem: hasMem ? Math.round(mem * 10) / 10 : undefined,
    rssKb: hasRss ? rssKb : undefined,
  };
}

module.exports = {
  classifyProcesses,
  isExcluded,
  mergeCandidates,
};
