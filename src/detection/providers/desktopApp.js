function findDesktopAppRoot(proc, context, isAppRoot) {
  const rootAncestor = context.parentChain(proc, 20).filter(isAppRoot).pop();
  if (rootAncestor) {
    return rootAncestor;
  }
  return isAppRoot(proc) ? proc : undefined;
}

module.exports = {
  findDesktopAppRoot,
};
