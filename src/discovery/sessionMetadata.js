const fs = require('fs/promises');
const path = require('path');
const os = require('os');
const { compactHome, truncate } = require('../util/text');

const MAX_RECENT_FILES = 60;
const JSONL_TAIL_BYTES = 320 * 1024;
// An agent whose latest session activity is older than this is considered idle
// (it will wander to the break room in the office view).
const IDLE_AFTER_MS = 3 * 60 * 1000;

async function collectSessionMetadata(config = {}, logger) {
  if (config.enableSessionMetadataScan === false) {
    return { sessions: [] };
  }

  const settled = await Promise.allSettled([
    collectCodexSessions(logger),
    collectClaudeSessions(logger),
    collectCursorSessions(logger),
  ]);

  const sessions = [];
  for (const result of settled) {
    if (result.status === 'fulfilled') {
      sessions.push(...result.value);
    } else {
      logger?.debug('session metadata source failed', { error: result.reason?.message || String(result.reason) });
    }
  }

  return {
    sessions: sessions
      .filter(Boolean)
      .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
      .slice(0, 180),
  };
}

function enrichAgentsWithSessionMetadata(agents, metadata = {}, now = Date.now()) {
  const sessions = metadata.sessions || [];
  const used = new Set();
  const context = buildMatchContext(agents, sessions);
  const matches = new Map();

  for (const agent of agents) {
    const match = bestSessionForAgent(agent, sessions, used, context);
    if (match) {
      matches.set(agent, match);
      used.add(sessionKey(match.session));
    }
  }

  // Second pass: a running agent keeps its session file hot. If exactly one
  // fresh session of the same vendor+surface is left unclaimed, it belongs to
  // the one agent that matched nothing — common for resumed sessions, whose
  // file creation time predates the process.
  for (const agent of agents) {
    if (matches.has(agent)) {
      continue;
    }
    const vendor = vendorOf(agent);
    const surface = agent.surface || 'terminal';
    const fresh = sessions.filter((session) => !used.has(sessionKey(session))
      && session.vendor === vendor
      && (session.surface || 'terminal') === surface
      && now - (session.updatedAt || 0) < IDLE_AFTER_MS);
    if (fresh.length === 1) {
      matches.set(agent, { session: fresh[0], confidence: 0.5, reasons: ['live-leftover'] });
      used.add(sessionKey(fresh[0]));
    }
  }

  return agents.map((agent) => {
    const match = matches.get(agent);
    if (!match) {
      return agent;
    }
    const session = match.session;

    const projectPath = preferProjectPath(agent.projectPath, session.projectPath);
    const title = session.title || agent.title;
    const currentTask = session.currentTask || agent.currentTask || title;
    const sessionName = betterSessionName(
      agent.sessionName,
      title || session.sessionName || (projectPath ? path.basename(projectPath) : ''),
      agent,
    );
    const lastActivityAt = session.updatedAt || agent.lastActivityAt;
    // Only known-stale sessions are downgraded to idle; everything else stays at
    // its desk. We never upgrade to active here (the process is already active).
    const statusHint = Number.isFinite(lastActivityAt) && now - lastActivityAt > IDLE_AFTER_MS
      ? 'idle'
      : agent.statusHint;

    return {
      ...agent,
      sessionName,
      title,
      currentTask,
      activity: session.activity || agent.activity,
      toolCall: session.toolCall || agent.toolCall,
      modelName: session.modelName || agent.modelName,
      lastActivityAt,
      statusHint,
      projectPath,
      projectLabel: projectPath ? compactHome(projectPath) : agent.projectLabel,
      metadataConfidence: match.confidence,
      metadataReason: match.reasons.join(', '),
      metadataSource: session.source,
      metadataPath: session.sourcePath,
      detail: [agent.detail, session.detail].filter(Boolean).join(' · '),
    };
  });
}

function bestSessionForAgent(agent, sessions, used = new Set(), context = buildMatchContext([agent], sessions)) {
  const vendor = vendorOf(agent);
  const surface = agent.surface || 'terminal';
  let best;

  for (const session of sessions) {
    if (used.has(sessionKey(session))) {
      continue;
    }
    const match = sessionMatch(agent, session, vendor, surface, context);
    if (!match.accepted) {
      continue;
    }
    if (!best || match.score > best.score || (match.score === best.score && (session.updatedAt || 0) > (best.session.updatedAt || 0))) {
      best = { session, ...match };
    }
  }

  return best;
}

function sessionMatch(agent, session, vendor, surface, context) {
  let score = 0;
  const reasons = [];
  const projectMatch = samePath(agent.projectPath, session.projectPath) || samePath(agent.cwd, session.projectPath);
  if (session.surface && session.surface !== surface && !projectMatch) {
    return rejected(score, reasons);
  }
  if (session.vendor === vendor) {
    score += 35;
    reasons.push('vendor');
  }
  if (session.surface === surface) {
    score += 12;
    reasons.push('surface');
  }
  if (samePath(agent.projectPath, session.projectPath)) {
    score += 90;
    reasons.push('project');
  }
  if (samePath(agent.cwd, session.projectPath)) {
    score += 80;
    reasons.push('cwd');
  }
  if (agent.command && session.sessionId && agent.command.includes(session.sessionId)) {
    score += 95;
    reasons.push('session-id');
  }
  if (agent.sessionName && session.title && normalizeText(agent.sessionName) === normalizeText(session.title)) {
    score += 50;
    reasons.push('title');
  }
  if (agent.sessionName && session.projectPath && normalizeText(agent.sessionName) === normalizeText(path.basename(session.projectPath))) {
    score += 30;
    reasons.push('project-name');
  }
  // A session file created within moments of the process starting almost
  // certainly belongs to that process. This is the main disambiguator on
  // Windows, where there is no lsof to read an agent's cwd.
  if (Number.isFinite(agent.startedAt) && Number.isFinite(session.createdAt) && session.createdAt > 0) {
    const driftMs = Math.abs(agent.startedAt - session.createdAt);
    if (driftMs < 90 * 1000) {
      // Closer starts score higher, so overlapping windows resolve to the
      // nearest session deterministically.
      score += 88 - Math.min(20, Math.floor(driftMs / 5000));
      reasons.push('started-together');
    }
  }

  if (session.updatedAt) {
    const ageMs = Math.max(0, Date.now() - session.updatedAt);
    const recency = Math.max(0, 22 - Math.floor(ageMs / (60 * 60 * 1000)));
    score += recency;
    if (recency > 0) reasons.push('recent');
  }

  const strong = reasons.some((reason) => ['project', 'cwd', 'session-id', 'title', 'project-name', 'started-together'].includes(reason));
  const groupKey = `${vendor}:${surface}`;
  const uniqueWeakMatch = !strong
    && session.vendor === vendor
    && session.surface === surface
    && context.agentCounts.get(groupKey) === 1
    && context.sessionCounts.get(groupKey) === 1
    && score >= 58;
  const singleDesktopFallback = !strong
    && surface === 'desktop'
    && session.vendor === vendor
    && session.surface === surface
    && context.agentCounts.get(groupKey) === 1
    && reasons.includes('recent')
    && score >= 58;
  const accepted = strong ? score >= 55 : (uniqueWeakMatch || singleDesktopFallback);

  return {
    accepted,
    score,
    reasons,
    confidence: Math.min(0.99, Math.max(0.35, score / 140)),
  };
}

function sessionKey(session) {
  return session.key || session.sourcePath || `${session.vendor}:${session.updatedAt}`;
}

function buildMatchContext(agents, sessions) {
  return {
    agentCounts: countBy(agents, (agent) => `${vendorOf(agent)}:${agent.surface || 'terminal'}`),
    sessionCounts: countBy(sessions, (session) => `${session.vendor || 'ai'}:${session.surface || 'terminal'}`),
  };
}

function countBy(items, keyFn) {
  const counts = new Map();
  for (const item of items) {
    const key = keyFn(item);
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return counts;
}

function rejected(score, reasons) {
  return { accepted: false, score, reasons, confidence: 0 };
}

async function collectCodexSessions(logger) {
  const home = os.homedir();
  const codexDir = path.join(home, '.codex');
  const [indexTitles, historyPrompts, rolloutFiles] = await Promise.all([
    readCodexIndex(path.join(codexDir, 'session_index.jsonl')),
    readCodexHistory(path.join(codexDir, 'history.jsonl')),
    recentFiles([path.join(codexDir, 'sessions'), path.join(codexDir, 'archived_sessions')], (file) => (
      path.basename(file).startsWith('rollout-') && file.endsWith('.jsonl')
    ), { maxDepth: 7, maxFiles: MAX_RECENT_FILES }),
  ]);

  const sessions = [];
  for (const file of rolloutFiles) {
    try {
      const lines = await readJsonlHeadTail(file.path);
      const parsed = parseCodexJsonl(lines, file.path);
      const title = indexTitles.get(parsed.sessionId)?.title;
      const prompt = historyPrompts.get(parsed.sessionId)?.text;
      sessions.push({
        ...parsed,
        title: title || parsed.title || titleFromText(prompt || parsed.currentTask),
        currentTask: parsed.currentTask || prompt,
        createdAt: file.birthtimeMs,
        updatedAt: Math.max(parsed.updatedAt || 0, file.mtimeMs || 0, indexTitles.get(parsed.sessionId)?.updatedAt || 0, historyPrompts.get(parsed.sessionId)?.updatedAt || 0),
      });
    } catch (error) {
      logger?.debug('codex session parse failed', { file: file.path, error: error.message });
    }
  }

  return sessions;
}

async function readCodexIndex(file) {
  const output = new Map();
  for (const item of await readJsonlFile(file, 1500)) {
    if (!item.id) continue;
    output.set(item.id, {
      title: cleanTitle(item.thread_name),
      updatedAt: toMs(item.updated_at),
    });
  }
  return output;
}

async function readCodexHistory(file) {
  const output = new Map();
  for (const item of await readJsonlFile(file, 2500)) {
    if (!item.session_id || !item.text) continue;
    output.set(item.session_id, {
      text: cleanTask(item.text),
      updatedAt: Number(item.ts) ? Number(item.ts) * 1000 : 0,
    });
  }
  return output;
}

function parseCodexJsonl(lines, sourcePath = '') {
  const session = {
    vendor: 'codex',
    surface: 'terminal',
    source: 'codex-session',
    sourcePath,
    key: sourcePath,
    toolCall: undefined,
  };
  const calls = new Map();

  for (const line of lines) {
    const item = parseJson(line);
    if (!item) continue;
    const payload = item.payload || item;
    const updatedAt = toMs(item.timestamp || payload.timestamp);
    if (updatedAt) session.updatedAt = Math.max(session.updatedAt || 0, updatedAt);

    if (item.type === 'session_meta' || payload.cwd || payload.id) {
      if (payload.id) session.sessionId = payload.id;
      if (payload.cwd) session.projectPath = payload.cwd;
      if (payload.originator) session.surface = String(payload.originator).toLowerCase().includes('desktop') ? 'desktop' : session.surface;
      if (payload.model || payload.model_provider) session.modelName = payload.model || payload.model_provider;
    }

    if (item.type === 'turn_context' || payload.workspace_roots) {
      if (payload.cwd) session.projectPath = payload.cwd;
      if (payload.model) session.modelName = payload.model;
    }

    if (payload.type === 'user_message' && payload.message) {
      session.currentTask = cleanTask(payload.message);
      session.title = session.title || titleFromText(payload.message);
      session.activity = 'reading prompt';
    }

    if (payload.type === 'agent_message' && payload.message) {
      session.activity = cleanActivity(payload.message);
    }

    if (['function_call', 'custom_tool_call'].includes(payload.type)) {
      const call = summarizeToolCall(payload.name, payload.arguments || payload.input);
      calls.set(payload.call_id, call);
      session.toolCall = call;
      session.activity = call.activity;
    }

    if (['function_call_output', 'custom_tool_call_output'].includes(payload.type)) {
      const call = calls.get(payload.call_id);
      if (call) {
        session.toolCall = { ...call, status: 'done' };
        session.activity = `${call.shortName} done`;
      }
    }

    if (payload.type === 'patch_apply_end') {
      session.toolCall = { name: 'apply_patch', shortName: 'patch', summary: 'patch applied', status: payload.success === false ? 'failed' : 'done' };
      session.activity = 'patch applied';
    }

    if (payload.type === 'task_complete') {
      session.activity = 'complete';
      if (payload.last_agent_message) {
        session.currentTask = cleanTask(payload.last_agent_message);
      }
    }
  }

  if (!session.sessionId) {
    const match = path.basename(sourcePath).match(/(019[a-z0-9-]+)/i);
    if (match) session.sessionId = match[1].replace(/\.jsonl$/, '');
  }
  session.title = cleanTitle(session.title || titleFromText(session.currentTask));
  return session;
}

// Where each vendor keeps local app data, per platform. Every candidate root is
// probed; missing directories are skipped silently.
function claudeDesktopRoots() {
  const home = os.homedir();
  const roots = [
    path.join(home, 'Library', 'Application Support', 'Claude'),
    path.join(process.env.APPDATA || path.join(home, 'AppData', 'Roaming'), 'Claude'),
    path.join(process.env.XDG_CONFIG_HOME || path.join(home, '.config'), 'Claude'),
  ];
  // The Microsoft Store build keeps its Roaming data inside the MSIX package.
  try {
    const packagesDir = path.join(home, 'AppData', 'Local', 'Packages');
    for (const entry of require('fs').readdirSync(packagesDir)) {
      if (entry.startsWith('Claude_')) {
        roots.push(path.join(packagesDir, entry, 'LocalCache', 'Roaming', 'Claude'));
      }
    }
  } catch {
    // Not Windows, or no Packages directory.
  }
  return roots;
}

function cursorWorkspaceRoots() {
  const home = os.homedir();
  return [
    path.join(home, 'Library', 'Application Support', 'Cursor', 'User', 'workspaceStorage'),
    path.join(process.env.APPDATA || path.join(home, 'AppData', 'Roaming'), 'Cursor', 'User', 'workspaceStorage'),
    path.join(process.env.XDG_CONFIG_HOME || path.join(home, '.config'), 'Cursor', 'User', 'workspaceStorage'),
  ];
}

async function collectClaudeSessions(logger) {
  const home = os.homedir();
  const cliFiles = await recentFiles([path.join(home, '.claude', 'projects')], (file) => file.endsWith('.jsonl'), {
    maxDepth: 5,
    maxFiles: MAX_RECENT_FILES,
  });
  const desktopFiles = await recentFiles(
    claudeDesktopRoots().flatMap((root) => [
      path.join(root, 'local-agent-mode-sessions'),
      path.join(root, 'claude-code-sessions'),
    ]),
    (file) => path.basename(file).startsWith('local_') && file.endsWith('.json'),
    {
      maxDepth: 8,
      maxFiles: MAX_RECENT_FILES,
    },
  );

  const sessions = [];
  for (const file of cliFiles) {
    try {
      // Head + tail: the head holds the opening prompt and cwd, the tail holds
      // the live title/task records. The middle of a long session matters less.
      sessions.push({
        ...parseClaudeJsonl(await readJsonlHeadTail(file.path), file.path, file.mtimeMs),
        createdAt: file.birthtimeMs,
      });
    } catch (error) {
      logger?.debug('claude jsonl parse failed', { file: file.path, error: error.message });
    }
  }
  for (const file of desktopFiles) {
    try {
      const parsed = JSON.parse(await fs.readFile(file.path, 'utf8'));
      sessions.push(parseClaudeDesktopJson(parsed, file.path, file.mtimeMs));
    } catch (error) {
      logger?.debug('claude desktop metadata parse failed', { file: file.path, error: error.message });
    }
  }
  return sessions;
}

function parseClaudeJsonl(lines, sourcePath = '', fallbackUpdatedAt = 0) {
  const session = {
    vendor: 'claude',
    surface: 'terminal',
    source: 'claude-jsonl',
    sourcePath,
    key: sourcePath,
    updatedAt: fallbackUpdatedAt,
  };

  for (const line of lines) {
    const item = parseJson(line);
    if (!item) continue;
    const updatedAt = toMs(item.timestamp);
    if (updatedAt) session.updatedAt = Math.max(session.updatedAt || 0, updatedAt);
    if (item.sessionId) session.sessionId = item.sessionId;
    if (item.cwd) session.projectPath = item.cwd;
    if (item.slug) session.title = cleanTitle(item.slug);

    // Claude Code ≥2.x writes dedicated identity records. The custom title (the
    // user's own tab name) outranks the generated ai-title.
    if (item.type === 'custom-title' && item.customTitle) session.customTitle = cleanTitle(item.customTitle);
    if (item.type === 'agent-name' && item.agentName) session.agentName = cleanTitle(item.agentName);
    if (item.type === 'ai-title' && item.aiTitle) session.aiTitle = cleanTitle(item.aiTitle);
    if (item.type === 'last-prompt' && item.lastPrompt) {
      session.currentTask = cleanTask(item.lastPrompt);
      session.activity = session.activity || 'reading prompt';
    }

    if (item.type === 'user' && item.message) {
      const text = messageText(item.message);
      if (isRealUserPrompt(text, item)) {
        session.currentTask = cleanTask(text);
        session.title = session.title || titleFromText(text);
        session.activity = 'reading prompt';
      }
    }

    if (item.type === 'assistant' && Array.isArray(item.message?.content)) {
      for (const part of item.message.content) {
        if (part.type === 'tool_use') {
          session.toolCall = summarizeToolCall(part.name, part.input);
          session.activity = session.toolCall.activity;
        } else if (part.type === 'text' && part.text) {
          session.activity = cleanActivity(part.text);
        }
      }
    }

    if (item.type === 'system' && item.subtype === 'success') {
      session.activity = 'complete';
    }
  }

  session.title = cleanTitle(
    session.customTitle
    || session.agentName
    || session.aiTitle
    || session.title
    || titleFromText(session.currentTask),
  );
  return session;
}

function parseClaudeDesktopJson(item, sourcePath = '', fallbackUpdatedAt = 0) {
  const title = cleanTitle(item.title || titleFromText(item.initialMessage));
  const projectPath = firstUsefulProjectPath([
    ...(Array.isArray(item.userSelectedFolders) ? item.userSelectedFolders : []),
    item.cwd,
  ]);
  return {
    vendor: 'claude',
    surface: sourcePath.includes('claude-code-sessions') ? 'terminal' : 'desktop',
    source: 'claude-desktop-session',
    sourcePath,
    key: item.sessionId || sourcePath,
    sessionId: item.sessionId || item.cliSessionId,
    title,
    currentTask: cleanTask(item.initialMessage || title),
    projectPath,
    modelName: item.model,
    updatedAt: Number(item.lastActivityAt) || Number(item.createdAt) || fallbackUpdatedAt,
    activity: item.error ? 'needs attention' : item.isArchived ? 'archived' : 'working',
    detail: item.hostLoopMode ? 'host loop' : '',
  };
}

async function collectCursorSessions(logger) {
  const files = await recentFiles(cursorWorkspaceRoots(), (file) => path.basename(file) === 'workspace.json', {
    maxDepth: 2,
    maxFiles: 40,
  });
  const sessions = [];
  for (const file of files) {
    try {
      const item = JSON.parse(await fs.readFile(file.path, 'utf8'));
      const projectPath = fileUriToPath(item.folder || item.workspace?.folder || item.workspace);
      if (!projectPath) continue;
      sessions.push({
        vendor: 'cursor',
        surface: 'desktop',
        source: 'cursor-workspace',
        sourcePath: file.path,
        key: file.path,
        title: path.basename(projectPath),
        currentTask: `workspace ${compactHome(projectPath)}`,
        projectPath,
        updatedAt: file.mtimeMs,
        activity: 'workspace open',
      });
    } catch (error) {
      logger?.debug('cursor workspace parse failed', { file: file.path, error: error.message });
    }
  }
  return sessions;
}

async function recentFiles(roots, predicate, { maxDepth = 4, maxFiles = 40 } = {}) {
  const files = [];
  for (const root of roots) {
    await walk(root, 0);
  }
  return files.sort((a, b) => b.mtimeMs - a.mtimeMs).slice(0, maxFiles);

  async function walk(dir, depth) {
    if (depth > maxDepth) return;
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(fullPath, depth + 1);
      } else if (predicate(fullPath)) {
        try {
          const stat = await fs.stat(fullPath);
          files.push({ path: fullPath, mtimeMs: stat.mtimeMs, birthtimeMs: stat.birthtimeMs, size: stat.size });
        } catch {
          // Ignore disappearing session files.
        }
      }
    }
  }
}

async function readJsonlFile(file, maxLines = 1000) {
  try {
    return (await fs.readFile(file, 'utf8'))
      .trim()
      .split('\n')
      .slice(-maxLines)
      .map(parseJson)
      .filter(Boolean);
  } catch {
    return [];
  }
}

async function readJsonlTail(file, maxBytes = JSONL_TAIL_BYTES) {
  const handle = await fs.open(file, 'r');
  try {
    const stat = await handle.stat();
    const length = Math.min(maxBytes, stat.size);
    const buffer = Buffer.alloc(length);
    await handle.read(buffer, 0, length, Math.max(0, stat.size - length));
    return buffer.toString('utf8').split('\n').filter(Boolean);
  } finally {
    await handle.close();
  }
}

async function readJsonlHeadTail(file, headBytes = 64 * 1024, tailBytes = JSONL_TAIL_BYTES) {
  const handle = await fs.open(file, 'r');
  try {
    const stat = await handle.stat();
    const headLength = Math.min(headBytes, stat.size);
    const tailLength = Math.min(tailBytes, stat.size);
    const head = Buffer.alloc(headLength);
    const tail = Buffer.alloc(tailLength);
    await handle.read(head, 0, headLength, 0);
    await handle.read(tail, 0, tailLength, Math.max(0, stat.size - tailLength));
    const lines = [
      ...head.toString('utf8').split('\n'),
      ...tail.toString('utf8').split('\n'),
    ].filter(Boolean);
    return [...new Set(lines)];
  } finally {
    await handle.close();
  }
}

function summarizeToolCall(name, rawInput) {
  const input = parseMaybeJson(rawInput);
  const shortName = shortToolName(name);
  const target = toolTarget(input);
  return {
    name: String(name || 'tool'),
    shortName,
    target,
    summary: [shortName, target].filter(Boolean).join(' '),
    activity: target ? `${shortName} ${target}` : `${shortName} call`,
    status: 'running',
  };
}

function toolTarget(input) {
  if (!input || typeof input !== 'object') return '';
  const file = input.file_path || input.path || input.filename;
  if (file) return path.basename(String(file));
  const command = input.command || input.cmd;
  if (command) return truncate(String(command).replace(/\s+/g, ' '), 34);
  const query = input.query || input.pattern || input.search_query;
  if (query) return truncate(String(query).replace(/\s+/g, ' '), 34);
  return '';
}

function shortToolName(name) {
  const value = String(name || 'tool').split('.').pop();
  const lower = value.toLowerCase();
  if (lower.includes('exec') || lower === 'bash') return 'shell';
  if (lower.includes('apply_patch') || lower.includes('edit')) return 'edit';
  if (lower.includes('write')) return 'write';
  if (lower.includes('read') || lower.includes('open')) return 'read';
  if (lower.includes('grep') || lower.includes('search') || lower.includes('rg')) return 'search';
  return truncate(value.replace(/_/g, '-'), 12);
}

function messageText(message) {
  if (typeof message === 'string') return message;
  if (Array.isArray(message?.content)) {
    return message.content
      .map((part) => typeof part === 'string' ? part : part.text || '')
      .filter(Boolean)
      .join(' ');
  }
  return message?.content || '';
}

function titleFromText(text) {
  const task = cleanTask(text);
  if (!task) return '';
  return truncate(task.split(/[.!?\n]/)[0], 54);
}

function cleanTask(text) {
  return truncate(String(text || '')
    .replace(/# Files mentioned by the user:[\s\S]*?## My request for Codex:/, '')
    .replace(/<task-notification>[\s\S]*?<\/task-notification>/g, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim(), 96);
}

function isRealUserPrompt(text, item = {}) {
  if (!text || item.toolUseResult || item.isMeta) {
    return false;
  }
  return !/<(?:task-notification|local-command-|system-reminder|command-|tool-use-id)\b/i.test(String(text));
}

function cleanTitle(text) {
  return truncate(String(text || '').replace(/\s+/g, ' ').trim(), 54);
}

function cleanActivity(text) {
  return truncate(String(text || '').replace(/\s+/g, ' ').trim(), 42);
}

function parseJson(line) {
  try {
    return JSON.parse(line);
  } catch {
    return undefined;
  }
}

function parseMaybeJson(value) {
  if (!value || typeof value !== 'string') return value;
  return parseJson(value) || value;
}

function toMs(value) {
  if (!value) return 0;
  if (typeof value === 'number') return value < 10_000_000_000 ? value * 1000 : value;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function vendorOf(agent) {
  const key = String(`${agent.toolKey || ''} ${agent.toolName || ''}`).toLowerCase();
  if (key.includes('codex')) return 'codex';
  if (key.includes('claude')) return 'claude';
  if (key.includes('cursor')) return 'cursor';
  return 'ai';
}

function samePath(left, right) {
  if (!left || !right) return false;
  return normalizePath(left) === normalizePath(right);
}

function normalizePath(value) {
  const text = String(value || '').replace(/\\/g, '/').replace(/\/+$/, '');
  // Drive-letter paths are case-insensitive.
  return /^[a-z]:(\/|$)/i.test(text) ? text.toLowerCase() : text;
}

function normalizeText(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function preferProjectPath(existing, candidate) {
  if (!candidate) return existing;
  if (!existing || existing.includes('/.codex/computer-use/')) return candidate;
  return existing;
}

function firstUsefulProjectPath(values) {
  return values.map(fileUriToPath).find(isUsefulProjectPath) || '';
}

function isUsefulProjectPath(value) {
  const text = String(value || '');
  if (!text || text === os.homedir()) return false;
  return !/(\/Library\/Application Support\/Claude\/|\/\.codex\/computer-use\/|\/Applications\/|\/System\/|\/usr\/|\/bin\/)/.test(text)
    && !/[\\/](?:Windows|Program Files(?: \(x86\))?)[\\/]/i.test(text)
    && !/AppData[\\/]Local[\\/]Packages/i.test(text);
}

function betterSessionName(existing, candidate, agent) {
  if (!candidate) return existing;
  const generated = new RegExp(`^${String(agent.toolKey || agent.processName || 'agent').replace(/[^a-z0-9]+/gi, '[-_]?')}[-_]?\\d+$`, 'i');
  if (!existing || existing === 'desktop-app' || /^[a-z-]+-\d+$/i.test(existing) || generated.test(existing)) {
    return candidate;
  }
  return existing;
}

function fileUriToPath(value) {
  if (!value) return '';
  const text = String(value);
  if (text.startsWith('file://')) {
    const decoded = decodeURIComponent(text.slice('file://'.length));
    // file:///C:/dev/app decodes to /C:/dev/app — drop the leading slash.
    return /^\/[a-z]:\//i.test(decoded) ? decoded.slice(1) : decoded;
  }
  return text.startsWith('/') || /^[a-z]:[\\/]/i.test(text) ? text : '';
}

module.exports = {
  collectSessionMetadata,
  enrichAgentsWithSessionMetadata,
  parseClaudeDesktopJson,
  parseClaudeJsonl,
  parseCodexJsonl,
  summarizeToolCall,
};
