const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { HistoryRecorder, readHistory, summarizeHistory } = require('../src/state/history');

function tmpFile() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-office-history-'));
  return path.join(dir, 'history.jsonl');
}

test('records only stopped sessions and reads them back', () => {
  const filePath = tmpFile();
  const recorder = new HistoryRecorder({ filePath });

  recorder.record([
    { type: 'started', at: 1000, agentId: 'a', toolName: 'Codex CLI' },
    { type: 'status', at: 1500, agentId: 'a', status: 'idle' },
    {
      type: 'stopped',
      at: 5000,
      agentId: 'a',
      toolKey: 'codex-cli',
      toolName: 'Codex CLI',
      sessionName: 'refactor',
      projectLabel: '~/work/api',
      runtimeMs: 4000,
      previousStatus: 'active',
    },
  ]);

  const records = readHistory({ filePath });
  assert.equal(records.length, 1);
  assert.equal(records[0].kind, 'session');
  assert.equal(records[0].toolName, 'Codex CLI');
  assert.equal(records[0].runtimeMs, 4000);
  assert.equal(records[0].startedAt, 1000);
  assert.equal(records[0].lastStatus, 'active');
});

test('appends across multiple record calls', () => {
  const filePath = tmpFile();
  const recorder = new HistoryRecorder({ filePath });
  recorder.record([{ type: 'stopped', at: 1, agentId: 'a', toolName: 'A', runtimeMs: 100 }]);
  recorder.record([{ type: 'stopped', at: 2, agentId: 'b', toolName: 'B', runtimeMs: 200 }]);
  assert.equal(readHistory({ filePath }).length, 2);
});

test('disabled recorder writes nothing', () => {
  const filePath = tmpFile();
  const recorder = new HistoryRecorder({ filePath, enabled: false });
  recorder.record([{ type: 'stopped', at: 1, agentId: 'a', toolName: 'A', runtimeMs: 100 }]);
  assert.equal(fs.existsSync(filePath), false);
});

test('readHistory returns empty for a missing file', () => {
  assert.deepEqual(readHistory({ filePath: '/nonexistent/agent-office/history.jsonl' }), []);
});

test('summarizes sessions by tool and project', () => {
  const summary = summarizeHistory([
    { kind: 'session', toolName: 'Codex CLI', projectLabel: '~/api', runtimeMs: 3000 },
    { kind: 'session', toolName: 'Codex CLI', projectLabel: '~/web', runtimeMs: 1000 },
    { kind: 'session', toolName: 'Claude Code', projectLabel: '~/api', runtimeMs: 5000 },
  ]);

  assert.equal(summary.totalSessions, 3);
  assert.equal(summary.totalRuntimeMs, 9000);
  assert.equal(summary.byTool[0].tool, 'Claude Code');
  assert.equal(summary.byTool[0].runtimeMs, 5000);
  assert.equal(summary.byProject[0].project, '~/api');
  assert.equal(summary.byProject[0].sessions, 2);
  assert.equal(summary.longest[0].runtimeMs, 5000);
});
