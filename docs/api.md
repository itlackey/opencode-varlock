# API reference

## Plugin package entrypoints

- `opencode-varlock`
- `opencode-varlock/plugin`
- `opencode-varlock/config`
- `opencode-varlock/guard`
- `opencode-varlock/tools`

## Custom tools

### `load_env`

Parses a `.env` file and injects values into `process.env`.

Returns variable names only.

```text
Agent -> load_env(path: ".env")
     <- { loaded: ["DATABASE_URL", "REDIS_HOST"], skipped: ["NODE_ENV"] }
```

### `load_secrets`

Loads secrets from Varlock and injects them into `process.env`.

Returns variable names only.

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

## Lower-level exports

```typescript
import { loadConfig, DEFAULT_CONFIG } from "opencode-varlock/config"
import { createVarlockPlugin } from "opencode-varlock/plugin"
import { createEnvGuard, globToRegex } from "opencode-varlock/guard"
import { createLoadEnvTool } from "opencode-varlock/tools"
```

Example:

```typescript
const config = loadConfig(process.cwd(), {
  guard: { sensitiveGlobs: ["my-secrets/**"] },
})

const guard = createEnvGuard(config.guard)
const loadEnv = createLoadEnvTool(config.env)

const regex = globToRegex("**/.env.*")
regex.test("config/.env.production")
```
