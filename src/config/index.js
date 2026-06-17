const fs = require('fs');
const path = require('path');
const { DEFAULT_CONFIG, defaultConfigPath } = require('./defaults');
const { expandHome } = require('../util/text');

function cloneConfig(value) {
  return JSON.parse(JSON.stringify(value));
}

function mergeConfig(base, override) {
  const merged = cloneConfig(base);
  if (!override || typeof override !== 'object') {
    return merged;
  }

  for (const [key, value] of Object.entries(override)) {
    if (Array.isArray(value)) {
      merged[key] = value.slice();
    } else if (value && typeof value === 'object' && !Array.isArray(value)) {
      merged[key] = {
        ...(merged[key] && typeof merged[key] === 'object' ? merged[key] : {}),
        ...value,
      };
    } else {
      merged[key] = value;
    }
  }

  return normalizeConfig(merged);
}

function normalizeConfig(config) {
  const normalized = {
    ...config,
    scanIntervalMs: numberOr(config.scanIntervalMs, DEFAULT_CONFIG.scanIntervalMs),
    stoppedGraceMs: numberOr(config.stoppedGraceMs, DEFAULT_CONFIG.stoppedGraceMs),
    enableWindowTitleScan: config.enableWindowTitleScan !== false,
    enableAppWindowTitleScan: Boolean(config.enableAppWindowTitleScan),
    enableSessionMetadataScan: config.enableSessionMetadataScan !== false,
    enableHistory: config.enableHistory !== false,
    historyPath: typeof config.historyPath === 'string' && config.historyPath.trim()
      ? expandHome(config.historyPath.trim())
      : undefined,
    bellOnFinish: config.bellOnFinish !== false,
    idleAlertMs: numberOr(config.idleAlertMs, DEFAULT_CONFIG.idleAlertMs),
    defaultView: config.defaultView === 'dashboard' ? 'dashboard' : 'office',
    sessionFolderPaths: asStringArray(config.sessionFolderPaths).map(expandHome),
    excludePatterns: asStringArray(config.excludePatterns),
    terminalAgentKeywords: asStringArray(config.terminalAgentKeywords),
    customTools: Array.isArray(config.customTools) ? config.customTools : [],
  };

  normalized.customTools = normalized.customTools
    .filter((tool) => tool && typeof tool === 'object')
    .map((tool) => ({
      key: String(tool.key || tool.name || 'custom-tool').toLowerCase().replace(/[^a-z0-9_-]+/g, '-'),
      name: String(tool.name || tool.key || 'Custom Tool'),
      processNames: asStringArray(tool.processNames),
      commandPatterns: asStringArray(tool.commandPatterns),
      windowTitlePatterns: asStringArray(tool.windowTitlePatterns),
      sessionFolderPaths: asStringArray(tool.sessionFolderPaths).map(expandHome),
      color: tool.color || 'magenta',
      icon: String(tool.icon || '?').slice(0, 1),
    }));

  return normalized;
}

function asStringArray(value) {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((item) => typeof item === 'string' && item.trim()).map((item) => item.trim());
}

function numberOr(value, fallback) {
  return Number.isFinite(Number(value)) ? Number(value) : fallback;
}

function loadConfig(configPath) {
  const resolved = expandHome(configPath || defaultConfigPath());
  if (!fs.existsSync(resolved)) {
    return normalizeConfig(cloneConfig(DEFAULT_CONFIG));
  }

  try {
    const parsed = JSON.parse(fs.readFileSync(resolved, 'utf8'));
    const config = mergeConfig(DEFAULT_CONFIG, parsed);
    config.loadedConfigPath = path.resolve(resolved);
    return config;
  } catch (error) {
    throw new Error(`Failed to load config ${resolved}: ${error.message}`);
  }
}

module.exports = {
  DEFAULT_CONFIG,
  defaultConfigPath,
  loadConfig,
  mergeConfig,
  normalizeConfig,
};
