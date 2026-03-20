# opencode-varlock

OpenCode plugin that gives agents access to environment variables without revealing secret values.

> Warning
> This plugin is still early in development, and there is active work underway to improve its security model and edge-case protections. PRs, issue reports, and security feedback are very welcome.

## What it does

- provides `load_env` so agents can use `.env` values without seeing them directly
- provides `load_secrets` and `secret_status` when the Varlock CLI is available
- blocks direct secret reads with permission presets plus a `tool.execute.before` guard
- tries to catch common workarounds like interpreter-based env reads

## Install

Add the package to your `opencode.json` file:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": ["opencode-varlock@latest"]
}
```

## Configuration

`varlock.config.json` is optional.

If you do not provide one, the plugin uses its built-in defaults from [assets/varlock.config.json](assets/varlock.config.json). Create a local config only when you want to override those defaults.

Quick example:

```json
{
  "$schema": "https://raw.githubusercontent.com/itlackey/opencode-varlock/main/assets/varlock.schema.json",
  "varlock": {
    "enabled": true,
    "namespace": "myapp"
  }
}
```

Useful files:
- default config: `assets/varlock.config.json`
- JSON schema: `assets/varlock.schema.json`
- recommended permission configurations: `assets/permissions.json`

## Docs

- setup and overrides: `docs/configuration.md`
- security model and limitations: `docs/security.md`
- tests and validation: `docs/testing.md`
- exported APIs and tools: `docs/api.md`
- Docker + pass guide: `docs/docker-pass-guide.md`

## Repo layout

```text
src/    TypeScript source
assets/ Packaged JSON assets
docs/   Guides and reference docs
tests/  Unit and integration tests
```

## License

MPL-2.0
