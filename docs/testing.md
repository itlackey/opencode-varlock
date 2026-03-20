# Testing

## Commands

```bash
npm run test:unit
npm run test:integration
npm run test:coverage
```

## What each suite covers

- `test:unit`
  - config merge behavior
  - guard blocking rules
  - env and Varlock tools
  - plugin registration behavior

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
