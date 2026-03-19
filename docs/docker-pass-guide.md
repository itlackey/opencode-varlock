# Using opencode-varlock with Pass and Docker

A practical guide to running OpenCode in a Docker container with secrets managed on the host via [Pass](https://www.passwordstore.org/) (the standard Unix password manager) and `.env` files. The agent gets access to environment variables at runtime without ever seeing the raw values.

## What you'll set up

```
┌─── Host machine ────────────────────────────────┐
│                                                  │
│  ~/.password-store/         .env                 │
│    app/                     DB_URL=postgres://... │
│      db_url                 API_KEY=sk-abc...     │
│      api_key                                      │
│      redis_host                                   │
│                                                  │
│  varlock CLI (reads from pass)                   │
│                                                  │
├──────────────────────────────────────────────────┤
│  Docker boundary                                 │
├──────────────────────────────────────────────────┤
│                                                  │
│  OpenCode + opencode-varlock plugin              │
│                                                  │
│  Agent calls load_env or load_secrets            │
│  → gets back: "Loaded: DB_URL, API_KEY"          │
│  → never sees: postgres://..., sk-abc...         │
│                                                  │
└──────────────────────────────────────────────────┘
```

Two paths are covered — use whichever fits your setup, or both:

- **Path A: `.env` file** — simple, works everywhere, secrets exist as a file mounted into the container
- **Path B: Varlock + Pass** — secrets never touch the container filesystem at all

## Prerequisites

- Docker and Docker Compose on the host
- OpenCode installed (the container image or a Dockerfile that includes it)
- For Path B: `pass` initialized on the host (`pass init <gpg-id>`)

---

## Path A: `.env` files (simple)

### 1. Create your `.env` on the host

```bash
# ~/projects/myapp/.env
DATABASE_URL=postgres://user:pass@db:5432/myapp
API_KEY=sk-live-abc123
REDIS_HOST=redis://cache:6379
SMTP_PASS=mailgun-key-xyz
```

### 2. Mount it read-only into the container

```yaml
# docker-compose.yml
services:
  opencode:
    image: ghcr.io/opencode-ai/opencode:latest
    volumes:
      - ./project:/workspace
      - ./.env:/workspace/.env:ro          # read-only mount
    working_dir: /workspace
    environment:
      - ANTHROPIC_API_KEY                   # pass through from host env
```

The `:ro` flag means the agent can't modify the file, but a `cat` or `read` tool call would still expose its contents. That's where the plugin comes in.

### 3. Add the plugin and config

In your project directory:

```bash
cd ~/projects/myapp
mkdir -p .opencode/plugin
```

Install the plugin (or copy the source):

```bash
# if using bun/npm
bun add opencode-varlock

# or copy directly
cp -r path/to/opencode-varlock .opencode/plugin/varlock
```

Copy `assets/varlock.config.json` into your project root, or create `varlock.config.json` manually:

```json
{
  "guard": {
    "enabled": true,
    "sensitivePatterns": [".env", ".secret", ".pem", ".key"],
    "sensitiveGlobs": [
      "**/.env",
      "**/.env.*"
    ]
  },
  "env": {
    "enabled": true,
    "allowedRoot": "."
  },
  "varlock": {
    "enabled": false,
    "autoDetect": false
  }
}
```

Register it in `opencode.json`:

```json
{
  "plugin": ["opencode-varlock"],
  "permission": {
    "bash": {
      "cat *.env*": "deny",
      "printenv*": "deny",
      "echo $*": "deny",
      "env": "deny",
      "npm test": "allow",
      "bun test": "allow",
      "git *": "allow",
      "*": "ask"
    }
  }
}
```

### 4. How the agent uses it

```
You:    Run the database migration
Agent:  I'll load the environment first.
        → load_env(path: ".env")
        ← Loaded 4 variables: DATABASE_URL, API_KEY, REDIS_HOST, SMTP_PASS

Agent:  Environment is ready. Running migration...
        → bash("bun run db:migrate")
        ← Migration complete. 3 tables created.
```

If the agent tries to peek:

```
Agent:  → bash("cat .env")
        ← [varlock] Blocked: bash command matches deny pattern "cat .env".
           Use the load_env or load_secrets tool to access secrets.
```

---

## Path B: Varlock + Pass (secrets never on container disk)

This is the stronger approach. The `.env` file doesn't exist inside the container at all — secrets are pulled from the host's `pass` store via the Varlock CLI mounted into the container.

### 1. Store secrets in Pass on the host

```bash
pass insert app/db_url       # postgres://user:pass@db:5432/myapp
pass insert app/api_key      # sk-live-abc123
pass insert app/redis_host   # redis://cache:6379
```

Verify:

```bash
pass ls app/
# app
# ├── api_key
# ├── db_url
# └── redis_host
```

### 2. Set up the container with Pass + Varlock access

The container needs access to the host's GPG keyring and password store, plus the Varlock binary. Mount them read-only:

```yaml
# docker-compose.yml
services:
  opencode:
    image: ghcr.io/opencode-ai/opencode:latest
    volumes:
      - ./project:/workspace

      # Pass store (read-only)
      - ~/.password-store:/home/opencode/.password-store:ro

      # GPG keyring so pass can decrypt (read-only)
      - ~/.gnupg:/home/opencode/.gnupg:ro

      # Varlock binary from host
      - /usr/local/bin/varlock:/usr/local/bin/varlock:ro
    working_dir: /workspace
    environment:
      - ANTHROPIC_API_KEY
      - GNUPGHOME=/home/opencode/.gnupg
      - PASSWORD_STORE_DIR=/home/opencode/.password-store
```

> **Note:** If your GPG key has a passphrase, you'll need `gpg-agent` forwarding. See the GPG agent section below.

### 3. Configure the plugin for Varlock

`varlock.config.json`:

```json
{
  "guard": {
    "enabled": true,
    "sensitivePatterns": [".env", ".secret", ".pem", ".key", "credentials"],
    "sensitiveGlobs": [
      "**/.env",
      "**/.env.*",
      "**/.password-store/**",
      "**/.gnupg/**"
    ]
  },
  "env": {
    "enabled": false
  },
  "varlock": {
    "enabled": true,
    "autoDetect": false,
    "command": "varlock",
    "namespace": "app"
  }
}
```

Note that `env.enabled` is `false` — there's no `.env` file to load. The glob list now also protects the mounted `.password-store` and `.gnupg` directories.

`opencode.json`:

```json
{
  "plugin": ["opencode-varlock"],
  "permission": {
    "bash": {
      "cat *.env*": "deny",
      "pass *": "deny",
      "gpg *": "deny",
      "printenv*": "deny",
      "echo $*": "deny",
      "env": "deny",
      "*": "ask"
    }
  }
}
```

### 4. How the agent uses it

```
You:    Set up the environment and run tests
Agent:  Loading secrets from Varlock.
        → load_secrets(namespace: "app")
        ← Loaded 3 secret(s): DB_URL, API_KEY, REDIS_HOST

Agent:  Let me check what's available.
        → secret_status(namespace: "app")
        ← { total: 3, loaded: 3, unloaded: 0 }

Agent:  All secrets loaded. Running tests...
        → bash("bun test")
        ← 42 tests passed.
```

The agent writes code referencing `process.env.DB_URL` — it knows the name exists but never sees `postgres://user:pass@db:5432/myapp`.

---

## Using both paths together

You might want `.env` for non-sensitive config (ports, feature flags) and Varlock for actual secrets:

```json
{
  "guard": {
    "enabled": true,
    "sensitivePatterns": [".secret", ".pem", ".key"],
    "sensitiveGlobs": [
      "**/.password-store/**",
      "**/.gnupg/**",
      "secrets/**"
    ]
  },
  "env": {
    "enabled": true,
    "allowedRoot": "."
  },
  "varlock": {
    "enabled": true,
    "namespace": "app"
  }
}
```

```
Agent → load_env(path: ".env")
     ← Loaded: PORT, LOG_LEVEL, FEATURE_FLAG_V2

Agent → load_secrets(namespace: "app")
     ← Loaded: DB_URL, API_KEY, REDIS_HOST
```

---

## GPG agent forwarding for passphrase-protected keys

If your GPG key requires a passphrase, `pass` inside the container needs to talk to `gpg-agent` on the host. Mount the agent socket:

```yaml
services:
  opencode:
    volumes:
      # ... other mounts ...
      - ${GPG_AGENT_SOCK}:/home/opencode/.gnupg/S.gpg-agent:ro
    environment:
      - GPG_AGENT_INFO=/home/opencode/.gnupg/S.gpg-agent
```

Find your socket path:

```bash
export GPG_AGENT_SOCK=$(gpgconf --list-dirs agent-socket)
```

Make sure the agent is running and has your passphrase cached:

```bash
# cache passphrase for 8 hours
echo "default-cache-ttl 28800" >> ~/.gnupg/gpg-agent.conf
echo "max-cache-ttl 28800" >> ~/.gnupg/gpg-agent.conf
gpgconf --reload gpg-agent

# trigger a passphrase prompt now so it's cached before the container starts
pass show app/db_url > /dev/null
```

---

## Adding custom globs for your project

Every project has different file layouts. Add globs that match yours:

```json
{
  "guard": {
    "sensitiveGlobs": [
      "**/.env",
      "**/.env.*",

      "deploy/**/*.key",
      "deploy/**/*.pem",

      "config/secrets/**",
      "config/production.json",

      "terraform/**/*.tfvars",
      "ansible/vault/**"
    ]
  }
}
```

The glob matcher supports `*` (single directory), `**` (any depth), and `?` (single character). Patterns are matched case-insensitively against the full path argument the agent passes to tools.

---

## Verifying the guard

Test that the guard blocks what it should before giving the agent real work:

```bash
# inside the container, start opencode and try:

> cat .env
# → [varlock] Blocked: bash command matches deny pattern "cat .env"

> python3 -c "print(open('.env').read())"
# → [varlock] Blocked: bash command appears to read a sensitive file (*.env*)

> echo $DATABASE_URL
# → [varlock] Blocked: bash command matches deny pattern "echo $"

# the approved path works:
> /load_env
# → Loaded 4 variables: DATABASE_URL, API_KEY, REDIS_HOST, SMTP_PASS
```

---

## Quick reference

| Goal | Config |
|------|--------|
| `.env` only, no Varlock | `env.enabled: true`, `varlock.enabled: false`, `varlock.autoDetect: false` |
| Varlock only, no `.env` | `env.enabled: false`, `varlock.enabled: true` |
| Both | `env.enabled: true`, `varlock.enabled: true` |
| Disable guard (testing) | `guard.enabled: false` |
| Custom Varlock path | `varlock.command: "/opt/bin/varlock"` |
| Change namespace | `varlock.namespace: "prod"` |
| Add project globs | Append to `guard.sensitiveGlobs` |
