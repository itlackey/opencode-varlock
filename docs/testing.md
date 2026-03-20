# Testing

## Commands

```bash
npm run test:unit
npm run test:integration
npm run test:coverage
```

## What each suite covers

- `test:unit` (80 tests across 5 files)
  - **config** — merge behavior, config validation, config sanitization, default patterns
  - **guard** — 58 tests covering all blocking rules:
    - sensitive file reads via read/grep/glob/view tools
    - sensitive file writes via write/edit tools
    - bash deny patterns (50+ built-in patterns)
    - varlock CLI self-exfiltration (`varlock printenv`, `varlock load --format env/shell`)
    - interpreter-based file reads (Python `open()`, Ruby `File.read`, Node `readFileSync`, etc.)
    - file processor commands (`sed`, `awk`, `cut`, `dd`, `tee`, `xxd`, etc.)
    - shell redirects (`read < .env`, `mapfile < .env`, `exec < .env`)
    - encoding/eval bypasses (`base64 -d | bash`, `eval "$(..."`)
    - printf with variable references
    - variable listing (`set |`, `compgen -v`, `typeset -x`)
    - bare `env` command detection
    - recursive grep targeting `.env` files
    - config file tamper protection (`varlock.config.json`)
    - `.env.schema` / `.env.example` whitelist (safe files pass through)
  - **tools** — env loading, varlock CLI integration, input sanitization, symlink traversal rejection, namespace prefix filtering
  - **scrubber** — SecretRegistry registration, scrubbing, size tracking, boundary matching
  - **plugin** — registration behavior

- `test:integration`
  - starts a real OpenCode server via `@opencode-ai/sdk`
  - loads the built plugin into real temp projects
  - verifies `load_env`, `load_secrets`, and `secret_status`
  - keeps the runtime env-read tool-call regression as an opt-in test because model-driven tool-call behavior can be flaky across CI environments

- `test:coverage`
  - runs unit tests with coverage
  - writes reports to `coverage/`
  - emits text, HTML, and LCOV output

## CI notes

The integration suite requires the OpenCode CLI to be available.

The GitHub test workflow installs it before running integration tests.

To run the opt-in model-driven tool-call regression locally:

```bash
RUN_OPENCODE_TOOLCALL_E2E=1 npm run test:integration
```

## Validation

```bash
npm run validate
```

This runs:
- typecheck
- build
- unit tests
- `npm pack --dry-run`

`validate` intentionally does not run integration tests so publish-time checks stay faster and less environment-sensitive.
