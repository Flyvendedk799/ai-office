function buildProcessContext(processes) {
  const byPid = new Map();
  const childrenByPpid = new Map();

  for (const proc of processes) {
    byPid.set(proc.pid, proc);
    if (!childrenByPpid.has(proc.ppid)) {
      childrenByPpid.set(proc.ppid, []);
    }
    childrenByPpid.get(proc.ppid).push(proc);
  }

  function parentOf(proc) {
    return byPid.get(proc.ppid);
  }

  function parentChain(proc, limit = 8) {
    const chain = [];
    let current = proc;
    for (let index = 0; index < limit; index += 1) {
      const parent = parentOf(current);
      if (!parent) {
        break;
      }
      chain.push(parent);
      current = parent;
    }
    return chain;
  }

  function childrenOf(pid) {
    return childrenByPpid.get(pid) || [];
  }

  function findAncestor(proc, predicate) {
    return parentChain(proc, 12).find(predicate);
  }

  function hasTerminalAncestor(proc) {
    return parentChain(proc, 12).some(isTerminalHost);
  }

  return {
    byPid,
    childrenByPpid,
    isTerminalHost,
    childrenOf,
    findAncestor,
    hasTerminalAncestor,
    parentChain,
    parentOf,
    processes,
  };
}

// Shells and terminal emulators across macOS, Linux, and Windows. An agent with
// one of these in its parent chain was launched from a terminal.
const TERMINAL_HOSTS = [
  'zsh', 'bash', 'fish', 'sh', 'nu', 'xonsh',
  'tmux', 'screen', 'zellij',
  'terminal', 'iterm2', 'warp', 'alacritty', 'kitty', 'wezterm', 'ghostty',
  'gnome-terminal', 'konsole', 'xterm', 'foot', 'rio', 'tilix',
  'powershell', 'pwsh', 'cmd', 'conhost', 'windowsterminal', 'wt', 'mintty', 'openconsole',
];

function isTerminalHost(proc) {
  // Login shells report as "-zsh" / "-bash".
  const name = (proc.lowerName || '').replace(/^-/, '');
  const command = proc.lowerCommand || '';
  return TERMINAL_HOSTS.some((needle) => (
    // Short names ("sh", "wt", "cmd") match exactly so "ssh-agent" or
    // "cmdlet-host" never count as terminals; longer names match loosely.
    needle.length <= 4
      ? name === needle || name === `${needle}.exe` || command === needle || command === `-${needle}`
      : name.includes(needle) || command.includes(needle)
  ));
}

module.exports = {
  buildProcessContext,
  isTerminalHost,
};

