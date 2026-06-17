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
    return parentChain(proc, 12).some((parent) => {
      const name = parent.lowerName || '';
      const command = parent.lowerCommand || '';
      return ['zsh', 'bash', 'fish', 'sh', 'tmux', 'screen', 'terminal', 'iterm2', 'warp'].some((needle) => (
        name.includes(needle) || command.includes(needle)
      ));
    });
  }

  return {
    byPid,
    childrenByPpid,
    childrenOf,
    findAncestor,
    hasTerminalAncestor,
    parentChain,
    parentOf,
    processes,
  };
}

module.exports = {
  buildProcessContext,
};

