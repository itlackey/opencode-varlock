# Configuration

`varlock.config.json` is optional.

If you do not provide one, `opencode-varlock` uses its built-in defaults. When present, the file only overrides those defaults.

Default config reference:
- Repo copy: `assets/varlock.config.json`
- Installed package copy: `node_modules/opencode-varlock/assets/varlock.config.json`

Config lookup order:
1. `./varlock.config.json`
2. `.opencode/varlock.config.json`
3. programmatic overrides passed to `createVarlockPlugin()`

## Config validation

All config files and programmatic overrides are validated before merging. Invalid values (wrong types, non-boolean `enabled`, non-array patterns) are logged as warnings and removed before merge, so they cannot silently disable protections.

The plugin will never crash due to a malformed config file.

## Quick start

Copy the bundled template only if you want overrides:

```bash
cp node_modules/opencode-varlock/assets/varlock.config.json ./varlock.config.json
```

Minimal example:

```json
{
  "varlock": {
    "enabled": true,
    "namespace": "myapp"
  }
}
```

The copied config template points its `$schema` at `./node_modules/opencode-varlock/assets/varlock.schema.json` for editor validation.

## Full config reference

```json
{
  "guard": {
    "enabled": true,
    "sensitivePatterns": [
      ".env", ".secret", ".pem", ".key", "credentials", ".pgpass",
      "varlock.config"
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
      "secrets/**",
      "**/varlock.config.json",
      "**/.opencode/varlock.config.json"
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

## Sections

### `guard`

| Field | Type | Default | Description |
|---|---|---|---|
| `enabled` | `boolean` | `true` | Enables the `tool.execute.before` hook |
| `sensitivePatterns` | `string[]` | built-in list | Substring matches blocked anywhere in a path |
| `sensitiveGlobs` | `string[]` | built-in list | Path-aware glob rules |
| `bashDenyPatterns` | `string[]` | `[]` | Extra bash substrings to deny |
| `blockedReadTools` | `string[]` | `[read, grep, glob, view]` | Tools that trigger sensitive read checks |
| `blockedWriteTools` | `string[]` | `[write, edit]` | Tools that trigger sensitive write checks |

The guard automatically whitelists `.env.schema`, `.env.example`, and `.env.sample` files, since varlock.dev designed `.env.schema` to be safe for AI agent consumption.

The default `sensitivePatterns` include `varlock.config` to prevent agents from tampering with the plugin's own configuration.

### `env`

| Field | Type | Default | Description |
|---|---|---|---|
| `enabled` | `boolean` | `true` | Registers `load_env` |
| `allowedRoot` | `string` | `"."` | Containment boundary for `.env` loading |

The `allowedRoot` boundary is enforced with `realpathSync` to prevent symlink traversal.

### `varlock`

| Field | Type | Default | Description |
|---|---|---|---|
| `enabled` | `boolean` | `false` | Explicitly enables Varlock tools |
| `autoDetect` | `boolean` | `true` | Enables tools if the CLI is found |
| `command` | `string` | `"varlock"` | Varlock binary name or path |
| `namespace` | `string` | `"app"` | Default namespace for secret tools |

Varlock resolution:
- `enabled: true` registers tools immediately
- `enabled: false, autoDetect: true` probes for the CLI
- `enabled: false, autoDetect: false` disables Varlock entirely

The plugin uses `varlock load --format json` to list available variables and `varlock printenv <key>` to retrieve individual values.

## Merge behavior

- Arrays are replaced, not concatenated
- Objects are deep-merged
- Scalars overwrite previous values
- Invalid types are removed before merge (with warnings logged)

Example:

```json
{
  "guard": {
    "sensitiveGlobs": ["secrets/**", "config/.env.*"]
  }
}
```

## Programmatic overrides

```typescript
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

## Permission presets

Permission presets live in `assets/permissions.json`.

They complement the guard hook by handling obvious fast-path command patterns before the plugin catches deeper edge cases.

Presets include deny rules for varlock CLI exfiltration commands (`varlock printenv`, `varlock load --show-all`), file processors (`sed`, `awk`, `dd`), and encoding bypasses (`base64 -d | bash`).
