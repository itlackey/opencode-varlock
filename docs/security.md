# Security model

`opencode-varlock` is designed to let agents use secrets without directly seeing secret values.

This is still early software. The goal is to reduce common and clever exfiltration paths, not to claim perfect isolation.

## Four layers

1. Tool layer
   - `load_env` and `load_secrets` load values into the process environment
   - tool responses return names, never values

2. Permission layer
   - permission presets deny obvious commands like `cat .env`, `printenv`, and `echo $SECRET`

3. Guard layer (`tool.execute.before`)
   - inspects actual tool arguments before execution
   - catches paths and runtime tricks that simple glob rules miss
   - blocks varlock CLI self-exfiltration (`varlock printenv`, `varlock load --format env`)
   - blocks file reads via interpreters (`python open()`, `ruby File.read`, `node readFileSync`)
   - blocks 30+ file processors (`sed`, `awk`, `cut`, `dd`, `tee`, `xxd`, etc.)
   - blocks shell redirects (`< .env`, `read line < .env`, `mapfile < .env`)
   - blocks encoding/eval bypasses (`base64 -d | bash`, `eval "$(..."`)
   - blocks variable listing (`set |`, `compgen -v`, `declare -x`)
   - whitelists safe env files (`.env.schema`, `.env.example`, `.env.sample`)

4. Output scrubbing layer (`tool.execute.after`)
   - redacts loaded secret values from tool output before they reach the agent context
   - tracks all values loaded by `load_env` and `load_secrets` via a `SecretRegistry`
   - values >= 8 chars are replaced with `[REDACTED:VAR_NAME]`
   - shorter values (3-7 chars) use word-boundary matching to avoid false positives
   - acts as the fallback defense when a guard bypass succeeds

## Why this exists

Without a guard, an agent can try things like:

```bash
python3 -c "print(open('.env').read())"
python -c "import os; print(os.getenv('API_KEY'))"
node -e "console.log(process.env.API_KEY)"
sed '' .env
read line < .env; echo $line
varlock printenv SECRET_KEY
echo Y2F0IC5lbnY= | base64 -d | bash
```

The guard blocks direct file reads, interpreter-based file and env reads, shell redirects, encoding tricks, and even the varlock CLI itself when used to exfiltrate values.

## What the agent should see

```text
Loaded 5 variables: DATABASE_URL, API_KEY, REDIS_HOST, JWT_SECRET, SMTP_PASS
```

Not this:

```text
DATABASE_URL=postgres://...
API_KEY=...
```

And if a value somehow leaks into tool output, the scrubber redacts it:

```text
Connection string: [REDACTED:DATABASE_URL]
```

## Current protections

### File access
- sensitive file detection via substring patterns and glob rules
- symlink traversal prevention using `realpathSync` in `load_env`
- `allowedRoot` boundary enforcement for `.env` file loading
- config file tamper protection (`varlock.config.json` blocked from agent writes)

### Bash commands
- 50+ built-in deny patterns for common exfiltration commands
- varlock CLI self-exfiltration patterns (`printenv`, `load --format env/shell`, `load --show-all`)
- runtime env read detection for 9 interpreter APIs (Python, Node, Bun, Deno, Ruby, PHP, Java, Perl)
- interpreter-based file read detection (Python `open()`, `pathlib`, Ruby `File.read`, Node `readFileSync`, Bun `Bun.file`, PHP `file_get_contents`, Perl `open()`)
- 30+ file processor commands (`sed`, `awk`, `cut`, `sort`, `dd`, `tee`, `xxd`, `hexdump`, etc.)
- shell redirect patterns (`< .env`, `read ... < .env`, `mapfile ... < .env`, `exec ... < .env`)
- encoding/eval bypass detection (pipe to shell, `eval` with command substitution)
- printf with variable reference detection
- variable listing command blocking (`set |`, `compgen -v`, `typeset -x`)
- bare `env` command detection
- recursive grep targeting `.env` files

### Input validation
- namespace, keys, and prefix arguments validated against `[a-zA-Z0-9_.\-\/]+` to prevent command injection
- tool arguments sanitized before shell execution

### Safe file allowlist
- `.env.schema`, `.env.example`, and `.env.sample` are whitelisted through the guard
- varlock.dev designed `.env.schema` to be safe for AI agent consumption (contains metadata, never values)

### Post-execution
- output scrubbing via `SecretRegistry` redacts loaded values from all tool output
- optional `varlock scan` integration checks written files for leaked secrets
- `shell.env` hook provides observability for shell executions with managed secrets

## Limitations

- the deny model is heuristic and requires continuous hardening
- new shells, interpreters, or encoding tricks may reveal new gaps
- script-write-then-execute: an agent could write a script that reads `process.env` and execute it; the output scrubber mitigates but does not fully prevent this
- downstream code can still misuse loaded env vars if the surrounding workflow is careless
- the output scrubber cannot redact values shorter than 3 characters

## Contributing security fixes

Security-focused PRs, bug reports, and repro cases are very welcome.

The most helpful reports include:
- the exact command or tool call attempted
- whether it used `bash`, `read`, `grep`, or another tool
- what should have been blocked
- whether the value was exposed directly or indirectly
