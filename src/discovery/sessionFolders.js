const fs = require('fs/promises');
const path = require('path');
const { expandHome } = require('../util/text');

async function collectSessionHints(config, logger) {
  const paths = [
    ...(config.sessionFolderPaths || []),
    ...(config.customTools || []).flatMap((tool) => tool.sessionFolderPaths || []),
  ];
  const uniquePaths = [...new Set(paths.map(expandHome).filter(Boolean))];
  const hints = [];

  for (const folder of uniquePaths) {
    try {
      const entries = await fs.readdir(folder, { withFileTypes: true });
      for (const entry of entries.slice(0, 80)) {
        const fullPath = path.join(folder, entry.name);
        let stat;
        try {
          stat = await fs.stat(fullPath);
        } catch {
          stat = undefined;
        }
        hints.push({
          folder,
          name: entry.name,
          path: fullPath,
          isDirectory: entry.isDirectory(),
          mtimeMs: stat?.mtimeMs,
        });
      }
      logger?.debug('session folder scanned', { folder, entries: entries.length });
    } catch (error) {
      logger?.debug('session folder unavailable', { folder, error: error.message });
    }
  }

  return hints;
}

module.exports = {
  collectSessionHints,
};

