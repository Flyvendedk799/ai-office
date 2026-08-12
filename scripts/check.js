// Cross-platform syntax check: `node --check` every JS file in bin/src/test.
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const roots = ['bin', 'src', 'test', 'scripts'];
const files = [];

function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(fullPath);
    } else if (entry.name.endsWith('.js')) {
      files.push(fullPath);
    }
  }
}

for (const root of roots) {
  if (fs.existsSync(root)) {
    walk(root);
  }
}

let failed = 0;
for (const file of files) {
  try {
    execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' });
  } catch (error) {
    failed += 1;
    console.error(`✗ ${file}\n${error.stderr}`);
  }
}

console.log(`${files.length - failed}/${files.length} files pass syntax check`);
process.exit(failed ? 1 : 0);
