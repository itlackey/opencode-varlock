# API reference

## Plugin package entrypoints

- `opencode-varlock`
- `opencode-varlock/plugin`
- `opencode-varlock/config`
- `opencode-varlock/guard`
- `opencode-varlock/tools`
- `opencode-varlock/scrubber`

## Custom tools

### `load_env`

Parses a `.env` file and injects values into `process.env`.

Returns variable names only. Values are never exposed to the agent.

Enforces an `allowedRoot` boundary with symlink resolution to prevent path traversal.

```text
Agent -> load_env(path: ".env")
     <- { loaded: ["DATABASE_URL", "REDIS_HOST"], skipped: ["NODE_ENV"] }
```

### `load_secrets`

Loads secrets from Varlock and injects them into `process.env`.

Uses `varlock load --format json` to discover available keys and `varlock printenv <key>` to retrieve values. Namespace acts as an optional prefix filter.

Returns variable names only. Input arguments are validated against `[a-zA-Z0-9_.\-\/]+` to prevent command injection.

```text
Agent -> load_secrets(namespace: "prod", keys: ["db_url", "api_key"])
     <- { loaded: ["DB_URL", "API_KEY"], source: "varlock/prod" }
```

### `secret_status`

Reports which secret keys exist and which corresponding env vars are currently loaded.

```text
Agent -> secret_status(namespace: "app")
     <- { total: 5, loaded: 3, unloaded: 2, keys: [...] }
```

## Hooks

### `tool.execute.before` (EnvGuard)

Blocks sensitive file reads, bash exfiltration commands, interpreter-based env reads, shell redirects, encoding bypasses, and variable listing commands. See `docs/security.md` for the full list of protections.

### `tool.execute.after` (Output Scrubber)

Redacts loaded secret values from tool output using the `SecretRegistry`. Also runs `varlock scan` on files after write/edit operations when the varlock CLI is available.

### `shell.env`

Logs debug information when shell commands execute with managed secrets in the environment.

### `event` (Session lifecycle)

Logs configuration status on session creation.

## Lower-level exports

```typescript
import { loadConfig, validateConfig, DEFAULT_CONFIG } from "opencode-varlock/config"
import { createVarlockPlugin } from "opencode-varlock/plugin"
import { createEnvGuard, globToRegex } from "opencode-varlock/guard"
import { createLoadEnvTool } from "opencode-varlock/tools"
import { createSecretRegistry, type SecretRegistry } from "opencode-varlock/scrubber"
```

Example:

```typescript
const config = loadConfig(process.cwd(), {
  guard: { sensitiveGlobs: ["my-secrets/**"] },
})

const guard = createEnvGuard(config.guard)
const registry = createSecretRegistry()
const loadEnv = createLoadEnvTool(config.env, registry)

const regex = globToRegex("**/.env.*")
regex.test("config/.env.production")
```

### `SecretRegistry`

Tracks loaded secret values and scrubs them from strings.

```typescript
import { createSecretRegistry } from "opencode-varlock/scrubber"

const registry = createSecretRegistry()
registry.register("API_KEY", "sk-abc123456789")
registry.scrub("token is sk-abc123456789") // "token is [REDACTED:API_KEY]"
registry.size() // 1
```

### `validateConfig`

Validates a parsed config object against the expected schema. Returns an array of error strings (empty = valid).

```typescript
import { validateConfig } from "opencode-varlock/config"

const errors = validateConfig({ guard: { enabled: "yes" } })
// ["guard.enabled must be boolean, got string"]
```
