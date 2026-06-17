const { loadConfig, defaultConfigPath } = require('./config');
const { RealDiscovery } = require('./discovery');
const { DemoDiscovery } = require('./demo');
const { AgentStore } = require('./state/store');
const { startTui } = require('./tui/app');

module.exports = {
  AgentStore,
  DemoDiscovery,
  RealDiscovery,
  defaultConfigPath,
  loadConfig,
  startTui,
};

