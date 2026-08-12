function renderHelp() {
  return [
    '{bold}ai-office — Help{/bold}',
    '',
    '{bold}Navigation{/bold}',
    '  q / Ctrl-C   Quit             r   Rescan now',
    '  tab / ↓ →    Select next      ← ↑ Select previous',
    '  d / o        Office ⇄ Dashboard view',
    '  h            Toggle this help  esc Close / clear filter',
    '',
    '{bold}Dashboard{/bold}',
    '  s            Cycle sort (cpu · mem · runtime · tool · status · name)',
    '  /            Filter sessions by text (enter apply · esc clear)',
    '',
    '{bold}Agent actions{/bold}',
    '  k            Signal selected agent (SIGTERM / SIGINT / SIGKILL)',
    '  c            Show a "cd <project>" hint for the selected agent',
    '  p            Pause animation',
    '',
    'Local-only and best-effort: reads process + session metadata only.',
    'No telemetry, network, clipboard, keylog, or file-content access.',
  ].join('\n');
}

module.exports = {
  renderHelp,
};
