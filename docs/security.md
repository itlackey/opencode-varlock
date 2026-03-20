# Security model

`opencode-varlock` is designed to let agents use secrets without directly seeing secret values.

This is still early software. The goal is to reduce common and clever exfiltration paths, not to claim perfect isolation.

## Three layers

1. Tool layer
   - `load_env` and `load_secrets` load values into the process environment
   - tool responses return names, never values

2. Permission layer
   - permission presets deny obvious commands like `cat .env`, `printenv`, and `echo $SECRET`

3. Guard layer
   - `tool.execute.before` inspects actual tool arguments before execution
   - catches paths and runtime tricks that simple glob rules miss

## Why this exists

Without a guard, an agent can try things like:

```bash
python3 -c "print(open('.env').read())"
python -c "import os; print(os.getenv('API_KEY'))"
node -e "console.log(process.env.API_KEY)"
```

The guard blocks direct file reads and common interpreter-based runtime env reads.

## What the agent should see

```text
Loaded 5 variables: DATABASE_URL, API_KEY, REDIS_HOST, JWT_SECRET, SMTP_PASS
```

Not this:

```text
DATABASE_URL=postgres://...
API_KEY=...
```

## Current protections

- sensitive file detection via substring patterns and glob rules
- bash deny list for common exfiltration commands
- runtime env read detection for common interpreters and APIs
- explicit redirection toward `load_env` and `load_secrets`

## Limitations

- the deny model is heuristic and requires continuous hardening
- new shells, interpreters, or encoding tricks may reveal new gaps
- downstream code can still misuse loaded env vars if the surrounding workflow is careless

## Contributing security fixes

Security-focused PRs, bug reports, and repro cases are very welcome.

The most helpful reports include:
- the exact command or tool call attempted
- whether it used `bash`, `read`, `grep`, or another tool
- what should have been blocked
- whether the value was exposed directly or indirectly
