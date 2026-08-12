const test = require('node:test');
const assert = require('node:assert/strict');
const {
  enrichAgentsWithSessionMetadata,
  parseClaudeDesktopJson,
  parseClaudeJsonl,
  parseCodexJsonl,
  summarizeToolCall,
} = require('../src/discovery/sessionMetadata');

test('parses Codex title, cwd, task, and tool calls from rollout lines', () => {
  const lines = [
    JSON.stringify({
      timestamp: '2026-06-17T10:00:00.000Z',
      type: 'session_meta',
      payload: { id: 'codex-session-1', cwd: '/Users/me/app', originator: 'Codex Desktop', model_provider: 'openai' },
    }),
    JSON.stringify({
      timestamp: '2026-06-17T10:01:00.000Z',
      type: 'event_msg',
      payload: { type: 'user_message', message: 'Fix checkout totals and update tests.' },
    }),
    JSON.stringify({
      timestamp: '2026-06-17T10:02:00.000Z',
      type: 'response_item',
      payload: { type: 'function_call', name: 'exec_command', arguments: '{"cmd":"npm test"}', call_id: 'call_1' },
    }),
  ];

  const parsed = parseCodexJsonl(lines, '/tmp/rollout.jsonl');

  assert.equal(parsed.vendor, 'codex');
  assert.equal(parsed.surface, 'desktop');
  assert.equal(parsed.projectPath, '/Users/me/app');
  assert.equal(parsed.currentTask, 'Fix checkout totals and update tests.');
  assert.equal(parsed.toolCall.shortName, 'shell');
  assert.match(parsed.toolCall.summary, /npm test/);
});

test('parses Claude Code JSONL tool use and project context', () => {
  const lines = [
    JSON.stringify({
      type: 'user',
      timestamp: '2026-06-17T10:00:00.000Z',
      cwd: '/Users/me/api',
      sessionId: 'claude-session-1',
      message: { role: 'user', content: [{ type: 'text', text: 'Add pagination to the users endpoint.' }] },
    }),
    JSON.stringify({
      type: 'assistant',
      timestamp: '2026-06-17T10:01:00.000Z',
      cwd: '/Users/me/api',
      sessionId: 'claude-session-1',
      message: { role: 'assistant', content: [{ type: 'tool_use', name: 'Edit', input: { file_path: '/Users/me/api/src/users.js' } }] },
    }),
  ];

  const parsed = parseClaudeJsonl(lines, '/tmp/claude.jsonl');

  assert.equal(parsed.vendor, 'claude');
  assert.equal(parsed.surface, 'terminal');
  assert.equal(parsed.projectPath, '/Users/me/api');
  assert.equal(parsed.currentTask, 'Add pagination to the users endpoint.');
  assert.equal(parsed.toolCall.summary, 'edit users.js');
});

test('parses Claude Desktop local agent metadata', () => {
  const parsed = parseClaudeDesktopJson({
    sessionId: 'desktop-1',
    cwd: '/Users/me/site',
    title: 'Polish landing page',
    initialMessage: 'Make the landing page feel premium.',
    model: 'claude-opus',
    lastActivityAt: 1781690000000,
  }, '/Users/me/Library/Application Support/Claude/local-agent-mode-sessions/local_1.json');

  assert.equal(parsed.surface, 'desktop');
  assert.equal(parsed.title, 'Polish landing page');
  assert.equal(parsed.currentTask, 'Make the landing page feel premium.');
  assert.equal(parsed.modelName, 'claude-opus');
});

test('enriches generated process labels with matched session metadata', () => {
  const enriched = enrichAgentsWithSessionMetadata([
    {
      id: 'claude-code:123',
      toolKey: 'claude-code',
      toolName: 'Claude Code',
      surface: 'terminal',
      sessionName: 'claude-123',
      projectPath: '/Users/me/api',
    },
  ], {
    sessions: [{
      key: 'session-1',
      vendor: 'claude',
      surface: 'terminal',
      title: 'Users pagination',
      currentTask: 'Add pagination to the users endpoint.',
      projectPath: '/Users/me/api',
      activity: 'edit users.js',
      toolCall: summarizeToolCall('Edit', { file_path: '/Users/me/api/src/users.js' }),
      updatedAt: Date.now(),
    }],
  });

  assert.equal(enriched[0].sessionName, 'Users pagination');
  assert.equal(enriched[0].currentTask, 'Add pagination to the users endpoint.');
  assert.equal(enriched[0].toolCall.summary, 'edit users.js');
  assert.ok(enriched[0].metadataConfidence > 0.5);
  assert.match(enriched[0].metadataReason, /project/);
});

test('does not enrich multiple same-vendor agents from weak recency-only sessions', () => {
  const now = Date.now();
  const enriched = enrichAgentsWithSessionMetadata([
    {
      id: 'claude-code:101',
      toolKey: 'claude-code',
      toolName: 'Claude Code',
      surface: 'terminal',
      sessionName: 'claude-101',
    },
    {
      id: 'claude-code:102',
      toolKey: 'claude-code',
      toolName: 'Claude Code',
      surface: 'terminal',
      sessionName: 'claude-102',
    },
  ], {
    sessions: [
      { key: 's1', vendor: 'claude', surface: 'terminal', title: 'Recent A', updatedAt: now },
      { key: 's2', vendor: 'claude', surface: 'terminal', title: 'Recent B', updatedAt: now - 1000 },
    ],
  });

  assert.equal(enriched[0].title, undefined);
  assert.equal(enriched[1].title, undefined);
});

test('allows a unique weak app-session match when it is the only candidate', () => {
  const enriched = enrichAgentsWithSessionMetadata([
    {
      id: 'claude-desktop:1',
      toolKey: 'claude-desktop',
      toolName: 'Claude Desktop',
      surface: 'desktop',
      sessionName: 'claude-app-1',
    },
  ], {
    sessions: [{
      key: 'desktop-session',
      vendor: 'claude',
      surface: 'desktop',
      title: 'Design review',
      currentTask: 'Review homepage design notes',
      updatedAt: Date.now(),
    }],
  });

  assert.equal(enriched[0].sessionName, 'Design review');
  assert.equal(enriched[0].currentTask, 'Review homepage design notes');
  assert.match(enriched[0].metadataReason, /vendor/);
});

test('reads Claude Code identity records (custom-title, ai-title, last-prompt)', () => {
  const lines = [
    JSON.stringify({ type: 'user', timestamp: '2026-08-01T10:00:00Z', cwd: 'C:\\Users\\me\\shop', message: { role: 'user', content: 'Fix the checkout bug.' } }),
    JSON.stringify({ type: 'ai-title', aiTitle: 'Fix checkout bug in shop' }),
    JSON.stringify({ type: 'last-prompt', lastPrompt: 'Now also add a test.' }),
    JSON.stringify({ type: 'custom-title', customTitle: 'Shop checkout' }),
  ];

  const parsed = parseClaudeJsonl(lines, 'C:\\tmp\\claude.jsonl');

  // The user's own tab name outranks the generated ai-title.
  assert.equal(parsed.title, 'Shop checkout');
  assert.equal(parsed.currentTask, 'Now also add a test.');
  assert.equal(parsed.projectPath, 'C:\\Users\\me\\shop');
});

test('matches sessions created moments after each process started', () => {
  const now = Date.now();
  const enriched = enrichAgentsWithSessionMetadata([
    { id: 'claude-code:1', toolKey: 'claude-code', surface: 'terminal', sessionName: 'claude-1', startedAt: now - 60_000 },
    { id: 'claude-code:2', toolKey: 'claude-code', surface: 'terminal', sessionName: 'claude-2', startedAt: now - 600_000 },
  ], {
    sessions: [
      { key: 'a', vendor: 'claude', surface: 'terminal', title: 'Fresh work', createdAt: now - 58_000, updatedAt: now },
      { key: 'b', vendor: 'claude', surface: 'terminal', title: 'Older work', createdAt: now - 601_000, updatedAt: now - 1000 },
    ],
  }, now);

  assert.equal(enriched[0].title, 'Fresh work');
  assert.equal(enriched[1].title, 'Older work');
  assert.match(enriched[0].metadataReason, /started-together/);
});

test('gives the last unmatched agent the only remaining live session', () => {
  const now = Date.now();
  const enriched = enrichAgentsWithSessionMetadata([
    { id: 'claude-code:1', toolKey: 'claude-code', surface: 'terminal', sessionName: 'claude-1', startedAt: now - 30_000 },
    // Resumed session: the process is young but its file is a day old, so no
    // started-together signal exists for it.
    { id: 'claude-code:2', toolKey: 'claude-code', surface: 'terminal', sessionName: 'claude-2', startedAt: now - 3_600_000 },
  ], {
    sessions: [
      { key: 'fresh', vendor: 'claude', surface: 'terminal', title: 'New session', createdAt: now - 29_000, updatedAt: now },
      { key: 'resumed', vendor: 'claude', surface: 'terminal', title: 'Resumed session', createdAt: now - 86_400_000, updatedAt: now - 5_000 },
    ],
  }, now);

  assert.equal(enriched[0].title, 'New session');
  assert.equal(enriched[1].title, 'Resumed session');
  assert.match(enriched[1].metadataReason, /live-leftover/);
});

test('normalizes Windows paths when matching agent and session projects', () => {
  const enriched = enrichAgentsWithSessionMetadata([
    {
      id: 'claude-code:9',
      toolKey: 'claude-code',
      surface: 'terminal',
      sessionName: 'claude-9',
      projectPath: 'C:\\Users\\Me\\Shop',
    },
  ], {
    sessions: [{
      key: 'win',
      vendor: 'claude',
      surface: 'terminal',
      title: 'Windows path match',
      projectPath: 'c:/users/me/shop',
      updatedAt: Date.now(),
    }],
  });

  assert.equal(enriched[0].title, 'Windows path match');
  assert.match(enriched[0].metadataReason, /project/);
});

test('allows a single desktop app to use the freshest matching desktop session', () => {
  const enriched = enrichAgentsWithSessionMetadata([
    {
      id: 'codex-desktop:1',
      toolKey: 'codex-desktop',
      toolName: 'Codex Desktop',
      surface: 'desktop',
      sessionName: 'codex-app-1',
    },
  ], {
    sessions: [
      { key: 'old', vendor: 'codex', surface: 'desktop', title: 'Old task', updatedAt: Date.now() - 5000 },
      { key: 'new', vendor: 'codex', surface: 'desktop', title: 'Current task', currentTask: 'Improve backend matching', updatedAt: Date.now() },
    ],
  });

  assert.equal(enriched[0].sessionName, 'Current task');
  assert.equal(enriched[0].currentTask, 'Improve backend matching');
});
