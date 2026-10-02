const { formatDuration } = require('../util/time');
const { filterAgents } = require('./dashboard');
const { padRight } = require('../util/text');

function eventText(event) {
  if (event.type === 'error') return `scan failed: ${event.message}`;
  if (event.type === 'stopped') return `exited · ran ${formatDuration(event.runtimeMs)}`;
  if (event.type === 'started') return 'arrived';
  return `${event.previousStatus || '?'} → ${event.status}`;
}

function renderActivity({ events = [], width = 80, height = 24, filter = '', offset = 0 } = {}) {
  const w = Math.max(1, width);
  const h = Math.max(1, height);
  const rows = [];
  const line = (text) => padRight(text, w);
  const matches = events.filter((event) => filterAgents([event], filter).length || (event.type === 'error' && !filter));
  rows.push(line('ai-office · activity'));
  rows.push(line(`${matches.length} events this run · newest first${filter ? ` · filter: ${filter}` : ''}`));
  const count = Math.max(0, h - 3);
  const first = Math.min(offset, Math.max(0, matches.length - count));
  for (const event of matches.slice(first, first + count)) {
    const time = new Date(event.at).toLocaleTimeString('en-GB');
    const name = event.title || event.sessionName || event.toolName || 'discovery';
    rows.push(line(`${time}  ${event.toolName || 'system'} · ${name} · ${eventText(event)}${event.projectLabel ? ` [${event.projectLabel}]` : ''}`));
  }
  if (!matches.length && h > 3) rows.push(line(filter ? 'No events match this filter. Esc clears it.' : 'Agent arrivals, status changes and exits will appear here.'));
  while (rows.length < h - 1) rows.push(line(''));
  if (h > 1) rows.push(line('q quit  ↑↓ scroll  / filter  o office  d dashboard  h help'));
  return rows.slice(0, h).join('\n');
}

module.exports = { renderActivity, eventText };
