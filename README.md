# opencode-varlock

OpenCode plugin that gives agents access to environment variables **without revealing secret values**.

> Warning
> This plugin is still early in development, and there is active work underway to improve its security model and edge-case protections. PRs, issue reports, and security feedback are very welcome.

## The Problem

When an AI agent needs secrets (database URLs, API keys, tokens) to run your code, the obvious approach — letting it read `.env` — puts every secret directly into its context window. It can then echo them, log them, or hallucinate them into committed code.

## How It Works

Three layers enforce the boundary:

```
┌──────────────────────────────────────────────────┐
│  Agent context window                            │
│                                                  │
│  "Loaded 3 vars: DB_URL, API_KEY, REDIS_HOST"   │
│   ↑ names only, never values                     │
│                                                  │
├──────────────────────────────────────────────────┤
│  Layer 1 — Custom tools (load_env / load_secrets)│
│  Reads files or calls Varlock CLI, injects into  │
│  process.env, returns only key names.            │
├──────────────────────────────────────────────────┤
│  Layer 2 — Permission rules                      │
│  Glob-based deny rules block `cat .env`,         │
│  `printenv`, `echo $SECRET`, etc.                │
├──────────────────────────────────────────────────┤
│  Layer 3 — EnvGuard hook                         │
│  tool.execute.before intercept catches anything  │
│  the glob rules miss (python -c, scripting       │
│  escapes, indirect reads).                       │
└──────────────────────────────────────────────────┘
```

## Install

### As an npm plugin

```bash
npm install opencode-varlock
```

```json
// opencode.json
{
  "plugin": ["opencode-varlock"]
}
```

The published package ships compiled ESM in `dist/`, and the root entry exports only the plugin itself so OpenCode can load it cleanly through the normal npm plugin resolution flow.

## Configuration

All configuration lives in a single `varlock.config.json` file. The plugin searches for it in two locations (merged in order):

1. `./varlock.config.json` (project root)
2. `.opencode/varlock.config.json`

Programmatic overrides passed to `createVarlockPlugin()` take highest priority.

### Quick start

Copy the default config into your project:

```bash
cp node_modules/opencode-varlock/assets/varlock.config.json ./varlock.config.json
```

Or create a minimal one — only the fields you want to change:

```json
{
  "varlock": {
    "enabled": true,
    "namespace": "myapp"
  }
}
```

Everything else inherits from the built-in defaults.

The bundled template and permission presets now live in `assets/`:

```text
assets/varlock.config.json
assets/varlock.schema.json
assets/permissions.json
```

The copied config template points its `$schema` at `./node_modules/opencode-varlock/assets/varlock.schema.json`, so editors can validate and autocomplete it after install.

## Repo layout

```text
src/   TypeScript source for the plugin entry, config, guard, and tools
assets/ JSON assets shipped with the npm package
docs/  Setup and integration guides
```

## Testing

```bash
npm run test:unit
npm run test:integration
npm run test:coverage
```

- `test:unit` covers config, guard, tools, and plugin registration
- `test:integration` starts a real OpenCode server through `@opencode-ai/sdk` and verifies the plugin inside real sessions
- `test:coverage` emits text, HTML, and LCOV coverage reports under `coverage/`

### Full config reference

```json
{
  "guard": {
    "enabled": true,

    "sensitivePatterns": [
      ".env", ".secret", ".pem", ".key", "credentials", ".pgpass"
    ],

    "sensitiveGlobs": [
      "**/.env",
      "**/.env.*",
      "**/.env.local",
      "**/.env.production",
      "**/*.pem",
      "**/*.key",
      "**/credentials",
      "**/credentials.*",
      "**/.pgpass",
      "secrets/**"
    ],

    "bashDenyPatterns": [],

    "blockedReadTools": ["read", "grep", "glob", "view"],
    "blockedWriteTools": ["write", "edit"]
  },

  "env": {
    "enabled": true,
    "allowedRoot": "."
  },

  "varlock": {
    "enabled": false,
    "autoDetect": true,
    "command": "varlock",
    "namespace": "app"
  }
}
```

### Config sections

#### `guard` — EnvGuard hook

| Field | Type | Default | Description |
|---|---|---|---|
| `enabled` | `boolean` | `true` | Master switch for the `tool.execute.before` hook |
| `sensitivePatterns` | `string[]` | see above | Substring patterns — a path containing any of these is blocked |
| `sensitiveGlobs` | `string[]` | see above | Glob patterns — matched against full paths using `*`, `**`, `?` |
| `bashDenyPatterns` | `string[]` | `[]` | Extra bash substrings to deny (merged with ~30 built-ins) |
| `blockedReadTools` | `string[]` | `["read","grep","glob","view"]` | Tool names that trigger the file-read check |
| `blockedWriteTools` | `string[]` | `["write","edit"]` | Tool names that trigger the file-write check |

#### `env` — .env file loader

| Field | Type | Default | Description |
|---|---|---|---|
| `enabled` | `boolean` | `true` | Register the `load_env` tool |
| `allowedRoot` | `string` | `"."` | Path containment boundary (resolved relative to cwd) |

#### `varlock` — Varlock integration

| Field | Type | Default | Description |
|---|---|---|---|
| `enabled` | `boolean` | `false` | Explicitly enable Varlock tools |
| `autoDetect` | `boolean` | `true` | Probe for the CLI at startup and enable if found |
| `command` | `string` | `"varlock"` | Path or name of the Varlock binary |
| `namespace` | `string` | `"app"` | Default namespace for `load_secrets` / `secret_status` |

**Varlock resolution logic:**

- `enabled: true` → tools are registered (fails at runtime if CLI is missing)
- `enabled: false, autoDetect: true` → probes `which <command>`, enables if found
- `enabled: false, autoDetect: false` → Varlock is fully disabled

### Config merge behavior

Arrays are **replaced**, not concatenated. This means you can fully override the default glob list in your config file without inheriting the defaults:

```json
{
  "guard": {
    "sensitiveGlobs": ["secrets/**", "config/.env.*"]
  }
}
```

Object sections are deep-merged. Scalar values overwrite.

### Programmatic overrides

For project-specific customization beyond what JSON can express:

```typescript
// .opencode/plugin/secrets.ts
import { createVarlockPlugin } from "opencode-varlock/plugin"

export default createVarlockPlugin({
  guard: {
    sensitiveGlobs: [
      "**/.env",
      "**/.env.*",
      "infra/secrets/**",
      "deploy/*.key",
    ],
    bashDenyPatterns: ["vault read", "aws secretsmanager"],
  },
  varlock: {
    enabled: true,
    command: "/usr/local/bin/varlock",
    namespace: "prod",
  },
})
```

## Glob patterns

The guard supports glob patterns alongside the existing substring patterns. Both are checked — a match on either blocks the access.

### Supported syntax

| Pattern | Matches | Example |
|---|---|---|
| `*` | Any characters except `/` | `*.pem` matches `server.pem` |
| `**` | Any characters including `/` | `secrets/**` matches `secrets/prod/db.key` |
| `**/` | Zero or more directory levels | `**/.env` matches `.env` and `config/.env` |
| `?` | Single character except `/` | `?.key` matches `a.key` |

### When to use which

**Substring patterns** are fast and filename-oriented. Use them for extensions and file names that should be blocked everywhere regardless of path:

```json
"sensitivePatterns": [".env", ".pem", "credentials"]
```

**Glob patterns** are structural and path-aware. Use them for directory-scoped rules and more precise matching:

```json
"sensitiveGlobs": [
  "secrets/**",
  "config/.env.*",
  "deploy/**/*.key",
  "**/node_modules/**/.env"
]
```

### How globs are checked

For file tool calls (`read`, `write`, `edit`, etc.), the glob is matched against the path argument directly.

For bash commands, the guard extracts file-path-like tokens from the command string and checks each one against the compiled globs. This catches things like `jq . secrets/config.json` even when the substring patterns wouldn't flag it.

## Tools

### `load_env`

Parses a `.env` file and sets `process.env`. Returns only variable **names**.

```
Agent → load_env(path: ".env")
     ← { loaded: ["DATABASE_URL", "REDIS_HOST"], skipped: ["NODE_ENV"] }
```

### `load_secrets` (Varlock)

Pulls secrets from Varlock and injects into `process.env`.

```
Agent → load_secrets(namespace: "prod", keys: ["db_url", "api_key"])
     ← { loaded: ["DB_URL", "API_KEY"], source: "varlock/prod" }
```

### `secret_status` (Varlock)

Read-only check of which secrets exist and which are loaded.

```
Agent → secret_status(namespace: "app")
     ← { total: 5, loaded: 3, unloaded: 2, keys: [...] }
```

## Permission sets

The `assets/permissions.json` file contains three tiers (standard, strict, lockdown) plus an example agent definition. Copy the tier that fits your threat model into `opencode.json`.

These permission rules complement the EnvGuard hook — the rules handle fast-path blocking while the hook catches edge cases the glob-based rules miss.

## Architecture

### Why three layers?

**Permissions alone aren't enough.** An agent can try `python3 -c "print(open('.env').read())"` or `python -c "import os; print(os.getenv('API_KEY'))"` - the obvious glob rules won't catch every runtime exfiltration path.

**Prompt instructions alone aren't enough.** Telling an agent "never read .env" is a soft boundary the model can reason past.

**The plugin hook is the hard boundary.** `tool.execute.before` runs before every built-in tool call, inspects actual arguments, and throws an error the agent cannot suppress. The error message redirects it to the approved tools.

### What the agent sees

```
✓ "Loaded 5 variables: DATABASE_URL, API_KEY, REDIS_HOST, JWT_SECRET, SMTP_PASS"
✓ Writes code: const db = new Client(process.env.DATABASE_URL)
✗ cat .env              → Blocked: deny pattern
✗ echo $API_KEY         → Blocked: deny pattern
✗ python -c "os.getenv" → Blocked: runtime env read
✗ python -c "open..."   → Blocked: sensitive file
✗ jq . secrets/app.json → Blocked: matches glob "secrets/**"
```

## Advanced: composing individual pieces

Every component is exported for use in custom plugins:

```typescript
import { loadConfig, DEFAULT_CONFIG } from "opencode-varlock/config"
import { createVarlockPlugin } from "opencode-varlock/plugin"
import { createEnvGuard, globToRegex } from "opencode-varlock/guard"
import { createLoadEnvTool } from "opencode-varlock/tools"

// Load config with custom overrides
const config = loadConfig(process.cwd(), {
  guard: { sensitiveGlobs: ["my-secrets/**"] },
})

// Use just the guard
const guard = createEnvGuard(config.guard)

// Use just the tool
const loadEnv = createLoadEnvTool(config.env)

// Test a glob pattern
const regex = globToRegex("**/.env.*")
regex.test("config/.env.production") // true
```

## License

MPL-2.0
