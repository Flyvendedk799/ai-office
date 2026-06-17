const { scanProcesses } = require('./processScanner');
const { buildProcessContext } = require('./processContext');
const { collectSessionHints } = require('./sessionFolders');
const { collectSessionMetadata, enrichAgentsWithSessionMetadata } = require('./sessionMetadata');
const {
  applyAppWindowTitles,
  applyTerminalTitles,
  collectAppWindowTitles,
  collectTerminalTitles,
} = require('./terminalTitles');
const { classifyProcesses } = require('../detection');

class RealDiscovery {
  constructor({ config, logger }) {
    this.config = config;
    this.logger = logger;
    this.metadataCache = { expiresAt: 0, value: { sessions: [] } };
    this.titlesCache = { expiresAt: 0, value: new Map() };
    this.appTitlesCache = { expiresAt: 0, value: new Map() };
  }

  async discover() {
    const processes = await scanProcesses({ logger: this.logger });
    const context = buildProcessContext(processes);
    context.sessionHints = await collectSessionHints(this.config, this.logger);
    const metadata = await this.sessionMetadata();
    const [titles, appTitles] = await Promise.all([this.terminalTitles(), this.appWindowTitles()]);
    const agents = applyAppWindowTitles(
      applyTerminalTitles(
        enrichAgentsWithSessionMetadata(
          classifyProcesses(processes, context, this.config, this.logger),
          metadata,
        ),
        titles,
      ),
      appTitles,
    );
    this.logger?.debug('agent classification complete', { count: agents.length });
    return agents;
  }

  async terminalTitles(now = Date.now()) {
    if (this.config.enableWindowTitleScan === false) {
      return new Map();
    }
    if (now < this.titlesCache.expiresAt) {
      return this.titlesCache.value;
    }
    const value = await collectTerminalTitles({ enabled: true, logger: this.logger });
    this.titlesCache = { value, expiresAt: now + 3000 };
    return value;
  }

  async appWindowTitles(now = Date.now()) {
    if (!this.config.enableAppWindowTitleScan) {
      return new Map();
    }
    if (now < this.appTitlesCache.expiresAt) {
      return this.appTitlesCache.value;
    }
    const value = await collectAppWindowTitles({ enabled: true, logger: this.logger });
    this.appTitlesCache = { value, expiresAt: now + 3000 };
    return value;
  }

  async sessionMetadata(now = Date.now()) {
    if (now < this.metadataCache.expiresAt) {
      return this.metadataCache.value;
    }
    const value = await collectSessionMetadata(this.config, this.logger);
    this.metadataCache = {
      value,
      expiresAt: now + Math.max(5000, Math.min(15000, Number(this.config.scanIntervalMs || 2000) * 3)),
    };
    return value;
  }
}

module.exports = {
  RealDiscovery,
};
