function renderHelp() {
  return [
    '{bold}ai-office — Help{/bold}',
    '',
    '{bold}Navigation{/bold}',
    '  q / Ctrl-C   Quit             r   Rescan now',
    '  tab / ↓ →    Select next      ← ↑ Select previous',
    '  o / d / e    Office / Dashboard / Activity',
    '  h            Toggle this help  esc Close / clear filter',
    '',
    '{bold}Dashboard{/bold}',
    '  s            Cycle sort (cpu · mem · runtime · tool · status · name)',
    '  /            Filter text or PID (enter apply · esc cancel)',
    '  ↑ ↓          Scroll the activity feed (newest first)',
    '',
    '{bold}Agent actions{/bold}',
    '  k            Signal selected agent (SIGTERM / SIGINT / SIGKILL)',
    '  c            Show a "cd <project>" hint for the selected agent',
    '  p            Pause / resume animation; discovery stays live',
    '  m            Toggle reduced motion (static scenery)',
    '',
    'Local-only and best-effort: reads process + session metadata only.',
    'Scan health appears below every view; r retries a failed scan.',
  ].join('\n');
}

module.exports = {
  renderHelp,
};
