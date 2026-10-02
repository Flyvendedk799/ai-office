const os = require('os');
const path = require('path');
const unicode = require('blessed/lib/unicode');

function cleanText(value) {
  return String(value ?? '').replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '').replace(/[\x00-\x1f\x7f-\x9f{}]/g, ' ');
}

function textWidth(value) { return unicode.strWidth(cleanText(value)); }
function charWidth(value) { return unicode.charWidth(value); }

function truncate(value, width, marker = '~') {
  const text = cleanText(value);
  if (width <= 0) {
    return '';
  }
  if (textWidth(text) <= width) {
    return text;
  }
  let result = '';
  let used = 0;
  const budget = Math.max(0, width - textWidth(marker));
  for (const ch of text) {
    const size = charWidth(ch);
    if (used + size > budget) break;
    result += ch;
    used += size;
  }
  return result + marker;
}

function padRight(value, width, marker = '~') {
  const text = truncate(value, width, marker);
  return text + ' '.repeat(Math.max(0, width - textWidth(text)));
}

function expandHome(value) {
  if (!value || typeof value !== 'string') {
    return value;
  }
  if (value === '~') {
    return os.homedir();
  }
  if (value.startsWith('~/')) {
    return path.join(os.homedir(), value.slice(2));
  }
  return value;
}

function compactHome(value) {
  if (!value || typeof value !== 'string') {
    return '';
  }
  const home = os.homedir();
  return value.startsWith(home) ? `~${value.slice(home.length)}` : value;
}

function basenameFromCommand(command) {
  const first = splitCommand(command)[0] || command || '';
  const clean = first.replace(/^['"]|['"]$/g, '');
  return path.basename(clean).replace(/\.exe$/i, '');
}

function splitCommand(command) {
  const parts = [];
  const text = String(command || '');
  const pattern = /"([^"]*)"|'([^']*)'|(\S+)/g;
  let match;
  while ((match = pattern.exec(text)) !== null) {
    parts.push(match[1] ?? match[2] ?? match[3]);
  }
  return parts;
}

function stableHash(value) {
  const text = String(value || '');
  let hash = 5381;
  for (let index = 0; index < text.length; index += 1) {
    hash = ((hash << 5) + hash + text.charCodeAt(index)) >>> 0;
  }
  return hash.toString(36);
}

function matchesPattern(value, pattern) {
  const text = String(value || '');
  const raw = String(pattern || '').trim();
  if (!raw) {
    return false;
  }

  if (raw.startsWith('regex:')) {
    try {
      return new RegExp(raw.slice('regex:'.length), 'i').test(text);
    } catch {
      return false;
    }
  }

  return text.toLowerCase().includes(raw.toLowerCase());
}

function wordOrPathMatch(value, needle) {
  const escaped = escapeRegExp(String(needle || '').toLowerCase());
  if (!escaped) {
    return false;
  }
  return new RegExp(`(^|[\\s/\\\\._-])${escaped}($|[\\s/\\\\._-])`, 'i').test(String(value || ''));
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

module.exports = {
  textWidth,
  charWidth,
  cleanText,
  basenameFromCommand,
  compactHome,
  escapeRegExp,
  expandHome,
  matchesPattern,
  padRight,
  splitCommand,
  stableHash,
  truncate,
  wordOrPathMatch,
};

