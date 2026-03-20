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
  - includes a regression for runtime env-read blocking in a real session

- `test:coverage`
  - runs unit tests with coverage
  - writes reports to `coverage/`
  - emits text, HTML, and LCOV output

## CI notes

The integration suite requires the OpenCode CLI to be available.

The GitHub test workflow installs it before running integration tests.

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
