import { describe, expect, test } from "vitest"
import { createEnvGuard } from "../../src/guard.js"
import { DEFAULT_CONFIG } from "../../src/config.js"

describe("guard", () => {
  const guard = createEnvGuard(DEFAULT_CONFIG.guard)

  // ── Existing tests ──────────────────────────────────────────────────

  test("blocks direct reads of sensitive files", async () => {
    await expect(
      guard({ tool: "read" }, { args: { filePath: "/tmp/.env" } }),
    ).rejects.toThrow('cannot directly read "/tmp/.env"')
  })

  test("blocks writes to sensitive files", async () => {
    await expect(
      guard({ tool: "edit" }, { args: { filePath: "secrets/app.key" } }),
    ).rejects.toThrow('cannot write to "secrets/app.key"')
  })

  test("blocks bash commands that expose env files", async () => {
    await expect(
      guard({ tool: "bash" }, { args: { command: "cat .env" } }),
    ).rejects.toThrow('matches deny pattern "cat .env"')
  })

  test("blocks python getenv runtime env reads", async () => {
    await expect(
      guard(
        { tool: "bash" },
        {
          args: {
            command:
              "python -c 'import os; print(os.getenv(\"OLLAMA_MODELS\", \"\"))'",
          },
        },
      ),
    ).rejects.toThrow("read environment variable values at runtime")
  })

  test("blocks node process.env runtime env reads", async () => {
    await expect(
      guard(
        { tool: "bash" },
        {
          args: {
            command:
              "node -e 'console.log(process.env.OLLAMA_MODELS ?? \"\")'",
          },
        },
      ),
    ).rejects.toThrow("read environment variable values at runtime")
  })

  test("allows non-sensitive paths and commands", async () => {
    await expect(
      guard({ tool: "read" }, { args: { filePath: "/tmp/index.ts" } }),
    ).resolves.toBeUndefined()

    await expect(
      guard({ tool: "bash" }, { args: { command: "npm test" } }),
    ).resolves.toBeUndefined()
  })

  // ── P0-2: Varlock CLI self-exfiltration ─────────────────────────────

  describe("varlock CLI self-exfiltration (P0-2)", () => {
    test("blocks varlock printenv SECRET_KEY", async () => {
      // The generic "printenv" deny pattern fires first
      await expect(
        guard({ tool: "bash" }, { args: { command: "varlock printenv SECRET_KEY" } }),
      ).rejects.toThrow("printenv")
    })

    test("blocks varlock load --show-all", async () => {
      await expect(
        guard({ tool: "bash" }, { args: { command: "varlock load --show-all" } }),
      ).rejects.toThrow("varlock load --show-all")
    })

    test("blocks varlock load --format env", async () => {
      // The bare env regex fires first since "env" is at end of line
      await expect(
        guard({ tool: "bash" }, { args: { command: "varlock load --format env" } }),
      ).rejects.toThrow(/bare "env" command|varlock load --format env/)
    })

    test("blocks varlock load --format shell", async () => {
      await expect(
        guard({ tool: "bash" }, { args: { command: "varlock load --format shell" } }),
      ).rejects.toThrow("varlock load --format shell")
    })

    test("blocks varlock load -f env", async () => {
      // The bare env regex fires first since "env" is at end of line
      await expect(
        guard({ tool: "bash" }, { args: { command: "varlock load -f env" } }),
      ).rejects.toThrow(/bare "env" command|varlock load -f env/)
    })

    test("allows varlock run -- node app.js", async () => {
      await expect(
        guard({ tool: "bash" }, { args: { command: "varlock run -- node app.js" } }),
      ).resolves.toBeUndefined()
    })
  })

  // ── P0-3: Python open() and interpreter file reads ──────────────────

  describe("Python open() and interpreter file reads (P0-3)", () => {
    test("blocks python3 -c with open('.env').read()", async () => {
      await expect(
        guard(
          { tool: "bash" },
          { args: { command: `python3 -c "print(open('.env').read())"` } },
        ),
      ).rejects.toThrow("read a sensitive file via interpreter")
    })

    test("blocks python -c with pathlib Path('.env').read_text()", async () => {
      await expect(
        guard(
          { tool: "bash" },
          {
            args: {
              command: `python -c "from pathlib import Path; print(Path('.env').read_text())"`,
            },
          },
        ),
      ).rejects.toThrow("read a sensitive file via interpreter")
    })

    test("blocks ruby -e with File.read('.env')", async () => {
      await expect(
        guard(
          { tool: "bash" },
          { args: { command: `ruby -e "puts File.read('.env')"` } },
        ),
      ).rejects.toThrow("read a sensitive file via interpreter")
    })

    test("blocks node -e with fs.readFileSync('.env')", async () => {
      await expect(
        guard(
          { tool: "bash" },
          {
            args: {
              command: `node -e "console.log(require('fs').readFileSync('.env','utf8'))"`,
            },
          },
        ),
      ).rejects.toThrow("read a sensitive file via interpreter")
    })

    test("blocks php -r with file_get_contents('.env')", async () => {
      await expect(
        guard(
          { tool: "bash" },
          { args: { command: `php -r "echo file_get_contents('.env');"` } },
        ),
      ).rejects.toThrow("read a sensitive file via interpreter")
    })

    test("blocks bun -e with Bun.file('.env')", async () => {
      await expect(
        guard(
          { tool: "bash" },
          {
            args: {
              command: `bun -e "console.log(Bun.file('.env').text())"`,
            },
          },
        ),
      ).rejects.toThrow("read a sensitive file via interpreter")
    })

    test("allows python3 -c with no sensitive file", async () => {
      await expect(
        guard(
          { tool: "bash" },
          { args: { command: `python3 -c "print('hello')"` } },
        ),
      ).resolves.toBeUndefined()
    })
  })

  // ── P1-1: File processors ──────────────────────────────────────────

  describe("file processors (P1-1)", () => {
    test("blocks sed '' .env", async () => {
      await expect(
        guard({ tool: "bash" }, { args: { command: "sed '' .env" } }),
      ).rejects.toThrow("read a sensitive file")
    })

    test("blocks awk '{print}' .env", async () => {
      await expect(
        guard({ tool: "bash" }, { args: { command: "awk '{print}' .env" } }),
      ).rejects.toThrow("read a sensitive file")
    })

    test("blocks cut -d= -f2 .env", async () => {
      await expect(
        guard({ tool: "bash" }, { args: { command: "cut -d= -f2 .env" } }),
      ).rejects.toThrow("read a sensitive file")
    })

    test("blocks sort .env", async () => {
      await expect(
        guard({ tool: "bash" }, { args: { command: "sort .env" } }),
      ).rejects.toThrow("read a sensitive file")
    })

    test("blocks dd if=.env", async () => {
      await expect(
        guard({ tool: "bash" }, { args: { command: "dd if=.env" } }),
      ).rejects.toThrow("read a sensitive file")
    })

    test("blocks tee < .env", async () => {
      await expect(
        guard({ tool: "bash" }, { args: { command: "tee < .env" } }),
      ).rejects.toThrow(/read a sensitive file/)
    })

    test("blocks xxd .env", async () => {
      await expect(
        guard({ tool: "bash" }, { args: { command: "xxd .env" } }),
      ).rejects.toThrow("read a sensitive file")
    })

    test("allows sed on non-sensitive files", async () => {
      await expect(
        guard({ tool: "bash" }, { args: { command: "sed 's/foo/bar/' app.ts" } }),
      ).resolves.toBeUndefined()
    })
  })

  // ── P1-2: Shell redirects ──────────────────────────────────────────

  describe("shell redirects (P1-2)", () => {
    test("blocks read line < .env", async () => {
      await expect(
        guard({ tool: "bash" }, { args: { command: "read line < .env" } }),
      ).rejects.toThrow("shell redirects to read a sensitive file")
    })

    test("blocks while read line; do echo; done < .env", async () => {
      // The 'echo "$' deny pattern fires first due to echo "$line" in the command
      await expect(
        guard(
          { tool: "bash" },
          {
            args: {
              command: 'while read line; do echo "$line"; done < .env',
            },
          },
        ),
      ).rejects.toThrow(/Blocked/)
    })

    test("blocks mapfile -t lines < .env", async () => {
      await expect(
        guard(
          { tool: "bash" },
          { args: { command: "mapfile -t lines < .env" } },
        ),
      ).rejects.toThrow("shell redirects to read a sensitive file")
    })

    test("blocks exec 3< .env", async () => {
      await expect(
        guard({ tool: "bash" }, { args: { command: "exec 3< .env" } }),
      ).rejects.toThrow("shell redirects to read a sensitive file")
    })

    test("allows read line < input.txt (non-sensitive)", async () => {
      await expect(
        guard({ tool: "bash" }, { args: { command: "read line < input.txt" } }),
      ).resolves.toBeUndefined()
    })
  })

  // ── P1-3: Encoding/eval bypasses ───────────────────────────────────

  describe("encoding/eval bypasses (P1-3)", () => {
    test("blocks base64 decoded pipe to bash", async () => {
      await expect(
        guard(
          { tool: "bash" },
          { args: { command: "echo Y2F0IC5lbnY= | base64 -d | bash" } },
        ),
      ).rejects.toThrow("pipes output into a shell interpreter")
    })

    test("blocks eval with command substitution", async () => {
      await expect(
        guard(
          { tool: "bash" },
          { args: { command: 'eval "$(echo test)"' } },
        ),
      ).rejects.toThrow("eval with command substitution")
    })

    test("blocks something | sh", async () => {
      await expect(
        guard(
          { tool: "bash" },
          { args: { command: "something | sh" } },
        ),
      ).rejects.toThrow("pipes output into a shell interpreter")
    })

    test("allows echo hello (no pipe to shell)", async () => {
      await expect(
        guard({ tool: "bash" }, { args: { command: "echo hello" } }),
      ).resolves.toBeUndefined()
    })
  })

  // ── P1-4: .env.schema whitelist ────────────────────────────────────

  describe(".env.schema whitelist (P1-4)", () => {
    test("allows reading .env.schema via read tool", async () => {
      await expect(
        guard({ tool: "read" }, { args: { filePath: "/project/.env.schema" } }),
      ).resolves.toBeUndefined()
    })

    test("allows reading .env.example via read tool", async () => {
      await expect(
        guard({ tool: "read" }, { args: { filePath: "/project/.env.example" } }),
      ).resolves.toBeUndefined()
    })

    test("allows cat .env.example via bash", async () => {
      await expect(
        guard({ tool: "bash" }, { args: { command: "cat .env.example" } }),
      ).resolves.toBeUndefined()
    })

    test("still blocks reading .env via read tool", async () => {
      await expect(
        guard({ tool: "read" }, { args: { filePath: "/project/.env" } }),
      ).rejects.toThrow("cannot directly read")
    })

    test("still blocks reading .env.local via read tool", async () => {
      await expect(
        guard({ tool: "read" }, { args: { filePath: "/project/.env.local" } }),
      ).rejects.toThrow("cannot directly read")
    })
  })

  // ── P1-7: printf bypass fix ────────────────────────────────────────

  describe("printf bypass fix (P1-7)", () => {
    test('blocks printf "%s\\n" "$SECRET_VAR"', async () => {
      await expect(
        guard(
          { tool: "bash" },
          { args: { command: 'printf "%s\\n" "$SECRET_VAR"' } },
        ),
      ).rejects.toThrow("printf with a variable reference")
    })

    test("blocks printf '%s' $SECRET", async () => {
      await expect(
        guard(
          { tool: "bash" },
          { args: { command: "printf '%s' $SECRET" } },
        ),
      ).rejects.toThrow("printf")
    })

    test('allows printf "hello world" (no variable)', async () => {
      await expect(
        guard(
          { tool: "bash" },
          { args: { command: 'printf "hello world"' } },
        ),
      ).resolves.toBeUndefined()
    })
  })

  // ── P1-8: set/compgen/declare ──────────────────────────────────────

  describe("set/compgen/declare (P1-8)", () => {
    test("blocks compgen -v", async () => {
      await expect(
        guard({ tool: "bash" }, { args: { command: "compgen -v" } }),
      ).rejects.toThrow("compgen -v")
    })

    test("blocks compgen -A variable", async () => {
      await expect(
        guard({ tool: "bash" }, { args: { command: "compgen -A variable" } }),
      ).rejects.toThrow("compgen -A variable")
    })

    test("blocks typeset -x", async () => {
      await expect(
        guard({ tool: "bash" }, { args: { command: "typeset -x" } }),
      ).rejects.toThrow("typeset -x")
    })

    test("blocks set | grep SECRET", async () => {
      await expect(
        guard({ tool: "bash" }, { args: { command: "set | grep SECRET" } }),
      ).rejects.toThrow('uses "set" in a way that may expose variables')
    })

    test("allows set -e (common shell option)", async () => {
      await expect(
        guard({ tool: "bash" }, { args: { command: "set -e" } }),
      ).resolves.toBeUndefined()
    })

    test("allows set -x (common shell option)", async () => {
      await expect(
        guard({ tool: "bash" }, { args: { command: "set -x" } }),
      ).resolves.toBeUndefined()
    })
  })

  // ── P1-9: Bare env fix ─────────────────────────────────────────────

  describe("bare env fix (P1-9)", () => {
    test("blocks bare env command", async () => {
      await expect(
        guard({ tool: "bash" }, { args: { command: "env" } }),
      ).rejects.toThrow('bare "env" command')
    })

    test("blocks env at end of pipeline (something && env)", async () => {
      await expect(
        guard({ tool: "bash" }, { args: { command: "something && env" } }),
      ).rejects.toThrow('bare "env" command')
    })

    test("allows env -i command (env with flags is not bare)", async () => {
      // env -i starts with a clean environment; the bare env regex
      // looks for env at end of line, so "env -i command" should not
      // match the bare-env pattern since it has trailing args.
      await expect(
        guard({ tool: "bash" }, { args: { command: "env -i command" } }),
      ).resolves.toBeUndefined()
    })
  })

  // ── P2-3: Recursive grep guard ─────────────────────────────────────

  describe("recursive grep guard (P2-3)", () => {
    test("blocks grep --include=*.env* -r password .", async () => {
      await expect(
        guard(
          { tool: "bash" },
          { args: { command: "grep --include=*.env* -r password ." } },
        ),
      ).rejects.toThrow("grep --include=*.env*")
    })

    test("blocks rg -g '*.env*' password", async () => {
      await expect(
        guard(
          { tool: "bash" },
          { args: { command: "rg -g '*.env*' password" } },
        ),
      ).rejects.toThrow("rg -g '*.env*'")
    })
  })

  // ── P1-6: Config protection ────────────────────────────────────────

  describe("config protection (P1-6)", () => {
    test("blocks reading varlock.config.json via read tool", async () => {
      await expect(
        guard(
          { tool: "read" },
          { args: { filePath: "varlock.config.json" } },
        ),
      ).rejects.toThrow("cannot directly read")
    })

    test("blocks writing to varlock.config.json via edit tool", async () => {
      await expect(
        guard(
          { tool: "edit" },
          { args: { filePath: "varlock.config.json" } },
        ),
      ).rejects.toThrow("cannot write to")
    })

    test("blocks writing to .opencode/varlock.config.json via write tool", async () => {
      await expect(
        guard(
          { tool: "write" },
          { args: { filePath: ".opencode/varlock.config.json" } },
        ),
      ).rejects.toThrow("cannot write to")
    })
  })
})
