# Agent Office

`agent-office` is a local terminal tool that discovers the AI coding agents running on your machine and shows them two ways:

- an **animated office** where each agent is a little ASCII worker at a desk, and
- a **metrics dashboard** — a dense, sortable table with live CPU, memory, runtime, status, and current task per agent.

It also records a **session history** so you can see what ran while you were away, and a **headless watch mode** that streams agent lifecycle events as NDJSON for scripting and logging.

It scans local process metadata, classifies likely agents (Codex, Claude Code/Desktop, Cursor, Aider, Gemini, Goose, OpenCode, and custom tools), groups their helper processes, enriches them with local session metadata, and updates in real time.

## Session identity (how agents are named)

The two surfaces keep their "session" in different places, and v2 reads both:

- **Terminal agents** (Codex CLI, Claude Code) — the session is the **terminal tab**. agent-office reads each tab's title via AppleScript, keyed by tty, so an agent shows up as e.g. `Gamehub` or `ai-office` (the title Claude Code/Codex set), not `claude-12345`. On by default (`enableWindowTitleScan`); macOS only; uses Automation permission.
- **Desktop agents** (Claude/Codex/Cursor apps) — the session lives inside the app. agent-office reads the app's local session files, and optionally the **frontmost window title** (`enableAppWindowTitleScan`, off by default) for the open project/conversation. Window-title reading needs **Accessibility** permission for the terminal app that launches agent-office (System Settings → Privacy & Security → Accessibility), which takes effect after that app is fully relaunched.

If a title can't be read, agents fall back to project name, then tty (`claude@s000`), then pid.

## What's new in v2

- **Dashboard view** (`d` / `o` to toggle, or `--dashboard`) with sortable columns and a per-agent detail pane.
- **Live resource metrics**: per-agent CPU%, memory (RSS), and runtime, aggregated across an agent's grouped processes (e.g. a desktop app's helpers). A CPU sparkline tracks recent load.
- **Session history**: completed sessions are appended to `~/.agent-office/history.jsonl`; review them with `agent-office --history`.
- **Alerts**: a terminal bell + on-screen toast when an agent finishes.
- **Filter** (`/`) and **sort** (`s`) in the dashboard.
- **Agent actions**: signal the selected agent (`k` → SIGTERM/SIGINT/SIGKILL) or show a `cd <project>` hint (`c`).
- **Headless `--watch`** mode streaming NDJSON lifecycle events.

## Install And Run

```bash
npm install
npm run demo            # fake agents, great for a first look
```

Run against your real local agents:

```bash
npm start               # animated office
npm run dashboard       # start directly in the table dashboard
```

Inspect without the TUI:

```bash
agent-office --once             # one discovery pass, human-readable
agent-office --once --json      # machine-readable snapshot (with cpu/mem/runtime)
agent-office --watch            # stream lifecycle events as NDJSON
agent-office --history          # summarize recorded past sessions
```

Install the command locally:

```bash
npm link
agent-office --demo
```

## Controls

```text
q / Ctrl-C    quit                 r    rescan now
tab / ↓ →     select next          ← ↑  select previous
d / o         office ⇄ dashboard   h    help
p             pause animation      v    toggle route overlay
/             filter sessions      s    cycle dashboard sort
k             signal agent         c    show "cd <project>" hint
esc           close help / clear filter
```

Dashboard sort keys cycle through: `cpu · mem · runtime · tool · status · name`.

## Modes In Detail

### Dashboard

The dashboard is the "real tool" surface: one row per agent with `STATUS`, `TOOL`,
`SESSION`, `CPU`, `MEM`, `RUNTIME`, `PID`, `PROJECT`, and `TASK`. Columns drop
gracefully on narrow terminals (task → pid → runtime → mem → project, with CPU and
the core identity columns kept longest). The header shows totals and a CPU
sparkline; the bottom pane details the selected agent, including its command,
model, and per-agent CPU history.

### Watch (headless / scripting)

`--watch` runs no UI. It scans on the configured interval and prints one JSON
object per line for every lifecycle event:

```bash
agent-office --watch --scan-interval 1000 | jq 'select(.type=="stopped")'
```

Event types: `watch-start`, `started`, `status` (with `previousStatus`),
`stopped` (with `runtimeMs`), `error`, `watch-stop`. Stop with Ctrl-C.

### History

Completed sessions are recorded to JSONL (one line per finished session) and can
be summarized:

```bash
agent-office --history          # by tool, top projects, recent sessions
agent-office --history --json   # structured summary
agent-office --history 25       # widen the "recent" list
```

Disable recording with `--no-history` or `"enableHistory": false` in config.

## What It Detects

The scanner is best-effort and conservative. It reads running processes with:

```bash
ps -ww -axo pid=,ppid=,stat=,etime=,%cpu=,%mem=,rss=,command=
```

`%cpu`, `%mem`, and `rss` provide the live metrics; the rest provide identity,
status, and runtime. For likely agent processes it also attempts a short local
`cwd` lookup with `lsof` for a useful project label, falling back to process
arguments when `lsof` is unavailable.

By default it also reads local session metadata caches for richer labels:

- Codex `~/.codex/session_index.jsonl`, `~/.codex/history.jsonl`, and recent rollout JSONL files
- Claude Code `~/.claude/projects/**/*.jsonl`
- Claude Desktop local agent session JSON under `~/Library/Application Support/Claude`
- Cursor recent `workspaceStorage/**/workspace.json`

Set `"enableSessionMetadataScan": false` to use process metadata only.

Provider modules classify Codex CLI/Desktop, Claude Code/Desktop, Cursor and its
helpers, common terminal agents (Aider, Gemini, Goose, OpenCode, Qwen, …), custom
tools from config, and generic unknown terminal-launched AI commands. For each
detected agent it derives tool name, session label/title, current task and tool
call (when metadata exposes one), project path, PID and grouped helper PIDs,
status, runtime, CPU/memory, and whether it runs in a terminal or a desktop app.

## Privacy Boundaries

`agent-office` is local-only.

- No telemetry. No network calls. No cloud calls.
- No keylogging. No clipboard access. No screen recording.
- The `c` "cd hint" prints a path on screen for you to copy manually — it does **not** touch the clipboard.

By default it reads process metadata and local AI-tool session metadata files so
it can show titles, tasks, tool calls, and workspace names. Set
`"enableSessionMetadataScan": false` to use process metadata only.

Session history is stored locally at `~/.agent-office/history.jsonl` and records
only tool name, session/title, project label, PID, and timing — never file
contents. Disable it with `--no-history`.

Optional `sessionFolderPaths` reads one directory level of file/folder names plus
modification times. It does not open arbitrary project files. Debug logging is
opt-in with `--debug` and writes to `~/.agent-office/agent-office.log`.

## Configuration

Default config path:

```text
~/.agent-office/config.json
```

Or pass a path: `agent-office --config ./config/agent-office.example.json`.

```json
{
  "scanIntervalMs": 2000,
  "stoppedGraceMs": 10000,
  "enableWindowTitleScan": false,
  "enableSessionMetadataScan": true,
  "enableHistory": true,
  "historyPath": "~/.agent-office/history.jsonl",
  "bellOnFinish": true,
  "idleAlertMs": 0,
  "defaultView": "office",
  "sessionFolderPaths": [],
  "excludePatterns": ["agent-office"],
  "terminalAgentKeywords": ["claude", "claude-code", "codex", "aider", "gemini", "goose", "opencode"],
  "customTools": [
    {
      "key": "my-agent",
      "name": "My Agent",
      "icon": "M",
      "color": "magenta",
      "processNames": ["my-agent"],
      "commandPatterns": ["my-agent", "regex:\\bmy-ai-tool\\b"],
      "windowTitlePatterns": [],
      "sessionFolderPaths": []
    }
  ]
}
```

| Key | Default | Meaning |
| --- | --- | --- |
| `scanIntervalMs` | `2000` | Process scan cadence. |
| `stoppedGraceMs` | `10000` | How long a stopped agent lingers before disappearing. |
| `enableSessionMetadataScan` | `true` | Read local session caches for richer labels. |
| `enableWindowTitleScan` | `true` | Read terminal tab titles (macOS) to name terminal agents. |
| `enableAppWindowTitleScan` | `false` | Read desktop app window titles (macOS, needs Accessibility). |
| `enableHistory` | `true` | Append completed sessions to `historyPath`. |
| `historyPath` | `~/.agent-office/history.jsonl` | Where session history is written. |
| `bellOnFinish` | `true` | Ring the terminal bell when an agent finishes (and on idle alerts). |
| `idleAlertMs` | `0` | Alert once when an agent stays idle this long (ms). `0` disables. |
| `defaultView` | `"office"` | Initial view: `"office"` or `"dashboard"`. |
| `customTools` | `[]` | Extra detectors. `commandPatterns` are substring matches; prefix `regex:` for a regex. |

CLI flags override config: `--scan-interval`, `--dashboard`, `--no-history`, `--filter <text>`.

## Architecture

```text
bin/agent-office.js              CLI entry point (TUI, --once, --watch, --history)
src/config/                      config loading, defaults, normalization
src/discovery/                   process scanning (+cpu/mem/rss), metadata enrichment, process tree
src/detection/                   classifier and provider modules
src/state/store.js               cross-scan state, metrics history, lifecycle events
src/state/history.js             JSONL session history recorder + summaries
src/demo.js                      fake agents for visual testing
src/tui/app.js                   Blessed app: views, filtering, sorting, actions, alerts
src/tui/designRenderer.js        animated ASCII office renderer
src/tui/dashboard.js             metrics table renderer (sort/filter/detail)
src/util/                        text, time, and metric formatting helpers
test/                            classifier, metadata, renderer, dashboard, store, history, scanner, cli tests
```

To add a detector: create a module in `src/detection/providers/`, return a
candidate with `makeCandidate()` from `src/detection/helpers.js`, register it in
`PROVIDERS` in `src/detection/index.js`, and add tests in
`test/classifier.test.js`.

## Limitations

- Status is inferred from process state, not private session internals.
- CPU% reflects the OS `ps` sampling (recent average), not an instantaneous reading.
- Project paths are derived from command-line arguments / `lsof` and may be missing.
- macOS desktop apps spawn many helpers; Codex/Claude Desktop and Cursor helpers are grouped (and their metrics summed) when the process tree is visible.
- Window-title detection is represented in config for future detectors but is off by default (OS APIs can require accessibility permissions).
- Linux works wherever the `ps` invocation is supported. Windows needs a new process scanner module.

## Development

```bash
npm install
npm test       # node --test (classifier, store, history, dashboard, scanner, renderer, cli)
npm run check  # syntax check every file
npm run demo
```
