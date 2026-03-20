/**
 * EnvGuard - tool.execute.before hook that prevents agents from
 * reading sensitive files or running commands that expose secrets.
 */

import type { GuardConfig } from "./config.js"

export type { GuardConfig } from "./config.js"

/* ------------------------------------------------------------------ *
 *  Task 6: Safe env file patterns that should NOT be blocked
 * ------------------------------------------------------------------ */
const SAFE_ENV_PATTERNS = [".env.schema", ".env.example", ".env.sample"]

/* ------------------------------------------------------------------ *
 *  Task 1: Block varlock CLI self-exfiltration
 *  Task 8: Block set/compgen/declare/typeset variable listing
 *  Task 10: Block targeted recursive grep for .env files
 *  (Existing deny patterns preserved)
 * ------------------------------------------------------------------ */
const BUILTIN_BASH_DENY = [
  "cat .env",
  "less .env",
  "more .env",
  "head .env",
  "tail .env",
  "bat .env",
  "nano .env",
  "vim .env",
  "vi .env",
  "code .env",
  "printenv",
  "echo $",
  'echo "$',
  "printf '%s' $",
  "env |",
  "env\n",
  "export -p",
  "declare -x",
  "process.env",
  "os.environ",
  "os.getenv(",
  "getenv(",
  "system.getenv(",
  "deno.env.get(",
  "dotenv",
  "source .env",
  ". .env",
  "set -a",
  "grep .env",
  "rg .env",
  "ag .env",
  "ack .env",
  "find . -name .env",
  "find . -name '*.env'",
  'find . -name "*.env"',
  "curl.*env",
  "wget.*env",

  // Task 1: varlock CLI self-exfiltration
  "varlock printenv",
  "varlock load --show-all",
  "varlock load --format env",
  "varlock load --format shell",
  "varlock load -f env",
  "varlock load -f shell",

  // Task 8: compgen/typeset variable listing
  "compgen -v",
  "compgen -A variable",
  "typeset -x",

  // Task 10: recursive grep targeting .env files
  "grep --include=*.env*",
  "rg -g '*.env*'",
]

/* ------------------------------------------------------------------ *
 *  Existing: Regex patterns for runtime env-value reads via interpreters
 * ------------------------------------------------------------------ */
const ENV_VALUE_READ_PATTERNS = [
  /\bpython\d*\b[\s\S]*\bos\.getenv\s*\(/i,
  /\bpython\d*\b[\s\S]*\bos\.environ(?:\s*\[|\s*\.get\s*\()/i,
  /\bnode\b[\s\S]*\bprocess\.env(?:\.[a-zA-Z_][a-zA-Z0-9_]*|\s*\[)/i,
  /\bbun\b[\s\S]*\bprocess\.env(?:\.[a-zA-Z_][a-zA-Z0-9_]*|\s*\[)/i,
  /\bdeno\b[\s\S]*\bDeno\.env\.get\s*\(/i,
  /\bruby\b[\s\S]*\bENV(?:\s*\[|\.fetch\s*\()/i,
  /\bphp\b[\s\S]*\bgetenv\s*\(/i,
  /\bjava\b[\s\S]*\bSystem\.getenv\s*\(/i,
  /\bperl\b[\s\S]*\bENV\s*\{/i,
]

/* ------------------------------------------------------------------ *
 *  Task 2: Sensitive file read via interpreter (open(), File.read, etc.)
 *  Catches python open('.env'), ruby File.read('.env'), node fs.readFileSync('.env'), etc.
 * ------------------------------------------------------------------ */
const SENSITIVE_FILE_SUFFIX_RE =
  "(?:\\.env\\b|\\.pem\\b|\\.key\\b|credentials|\\.pgpass|\\.secret)"

const SENSITIVE_FILE_READ_VIA_INTERPRETER: RegExp[] = [
  // Python: open(), pathlib, Path()
  new RegExp(
    `\\bpython\\d*\\b[\\s\\S]*\\bopen\\s*\\([\\s\\S]*${SENSITIVE_FILE_SUFFIX_RE}`,
    "i",
  ),
  new RegExp(
    `\\bpython\\d*\\b[\\s\\S]*pathlib[\\s\\S]*${SENSITIVE_FILE_SUFFIX_RE}`,
    "i",
  ),
  new RegExp(
    `\\bpython\\d*\\b[\\s\\S]*\\bPath\\s*\\([\\s\\S]*${SENSITIVE_FILE_SUFFIX_RE}`,
    "i",
  ),
  // Ruby: File.read, File.open, IO.read
  new RegExp(
    `\\bruby\\b[\\s\\S]*(?:File\\.(?:read|open)|IO\\.read)\\s*\\([\\s\\S]*${SENSITIVE_FILE_SUFFIX_RE}`,
    "i",
  ),
  // Node: fs.readFileSync, readFileSync, readFile
  new RegExp(
    `\\bnode\\b[\\s\\S]*(?:readFileSync|readFile)\\s*\\([\\s\\S]*${SENSITIVE_FILE_SUFFIX_RE}`,
    "i",
  ),
  // Bun: Bun.file, readFileSync
  new RegExp(
    `\\bbun\\b[\\s\\S]*(?:Bun\\.file|readFileSync)\\s*\\([\\s\\S]*${SENSITIVE_FILE_SUFFIX_RE}`,
    "i",
  ),
  // Perl: open()
  new RegExp(
    `\\bperl\\b[\\s\\S]*\\bopen\\s*\\([\\s\\S]*${SENSITIVE_FILE_SUFFIX_RE}`,
    "i",
  ),
  // PHP: file_get_contents, fopen, file
  new RegExp(
    `\\bphp\\b[\\s\\S]*(?:file_get_contents|fopen|\\bfile\\b)\\s*\\([\\s\\S]*${SENSITIVE_FILE_SUFFIX_RE}`,
    "i",
  ),
]

/* ------------------------------------------------------------------ *
 *  Task 5: Encoding / eval bypass patterns — pipe to shell, eval subshell
 * ------------------------------------------------------------------ */
const PIPE_TO_SHELL_RE = /\|\s*(?:bash|sh|zsh|dash)\s*$/im
const EVAL_SUBSHELL_RE = /\beval\s+"\$\(/i

/* ------------------------------------------------------------------ *
 *  Task 7: printf format string bypass — catches printf with $VAR reference
 * ------------------------------------------------------------------ */
const PRINTF_VAR_RE = /\bprintf\b[\s\S]*\$[A-Za-z_]/i

/* ------------------------------------------------------------------ *
 *  Task 8: bare `set` piped or at end of command (set | grep, etc.)
 * ------------------------------------------------------------------ */
const SET_PIPE_RE = /\bset\s*(\||$|>)/im

/* ------------------------------------------------------------------ *
 *  Task 9: bare `env` command detection (fixed from literal \n)
 * ------------------------------------------------------------------ */
const BARE_ENV_RE = /(?:^|\s|;|&&|\|\|)env\s*$/im

type ToolInput = { tool: string }
type ToolOutput = { args: Record<string, any> }
type CompiledGlob = { source: string; regex: RegExp }

export function createEnvGuard(
  config: GuardConfig,
): (input: ToolInput, output: ToolOutput) => Promise<void> {
  const {
    sensitivePatterns,
    sensitiveGlobs,
    bashDenyPatterns,
    blockedReadTools,
    blockedWriteTools,
  } = config

  const bashDeny = [...BUILTIN_BASH_DENY, ...bashDenyPatterns]
  const compiledGlobs = sensitiveGlobs.map((g) => ({
    source: g,
    regex: globToRegex(g),
  }))

  /* ---------------------------------------------------------------- *
   *  Task 4: Build shell redirect patterns dynamically from sensitivePatterns
   * ---------------------------------------------------------------- */
  const shellRedirectPatterns: RegExp[] = []
  for (const sp of sensitivePatterns) {
    // Skip safe patterns in redirect construction
    if (SAFE_ENV_PATTERNS.some((safe) => sp.toLowerCase() === safe.toLowerCase())) {
      continue
    }
    const escaped = escapeRegex(sp)
    shellRedirectPatterns.push(
      new RegExp(
        `\\b(?:read|mapfile|readarray)\\b[\\s\\S]*<[\\s\\S]*${escaped}`,
        "i",
      ),
    )
    shellRedirectPatterns.push(new RegExp(`<\\s*\\S*${escaped}`, "i"))
    shellRedirectPatterns.push(
      new RegExp(`\\bexec\\b[\\s\\S]*<[\\s\\S]*${escaped}`, "i"),
    )
  }

  return async (input: ToolInput, output: ToolOutput) => {
    const args = output.args

    if (blockedReadTools.includes(input.tool)) {
      const target = args.filePath ?? args.path ?? args.pattern ?? args.file ?? ""
      if (target && isSensitive(target, sensitivePatterns, compiledGlobs)) {
        throw new Error(
          `[varlock] Blocked: cannot directly read "${target}". ` +
            `Use the load_env or load_secrets tool instead.`,
        )
      }
    }

    if (blockedWriteTools.includes(input.tool)) {
      const target = args.filePath ?? args.path ?? args.file ?? ""
      if (target && isSensitive(target, sensitivePatterns, compiledGlobs)) {
        throw new Error(
          `[varlock] Blocked: cannot write to "${target}". ` +
            `Secret files are managed outside the agent's scope.`,
        )
      }
    }

    if (input.tool === "bash") {
      const rawCommand = String(args.command ?? "")
      const cmd = rawCommand.toLowerCase()

      /* -- Existing: runtime env-value read patterns -- */
      for (const pattern of ENV_VALUE_READ_PATTERNS) {
        if (pattern.test(rawCommand)) {
          throw new Error(
            `[varlock] Blocked: bash command appears to read environment variable values at runtime. ` +
              `Use the load_env or load_secrets tool instead.`,
          )
        }
      }

      /* -- Task 2: sensitive file read via interpreter -- */
      for (const pattern of SENSITIVE_FILE_READ_VIA_INTERPRETER) {
        if (pattern.test(rawCommand)) {
          throw new Error(
            `[varlock] Blocked: bash command appears to read a sensitive file via interpreter. ` +
              `Use the load_env or load_secrets tool instead.`,
          )
        }
      }

      /* -- Task 5: pipe-to-shell and eval subshell bypass -- */
      if (PIPE_TO_SHELL_RE.test(rawCommand)) {
        throw new Error(
          `[varlock] Blocked: bash command pipes output into a shell interpreter. ` +
            `This pattern is not allowed for security reasons.`,
        )
      }
      if (EVAL_SUBSHELL_RE.test(rawCommand)) {
        throw new Error(
          `[varlock] Blocked: bash command uses eval with command substitution. ` +
            `This pattern is not allowed for security reasons.`,
        )
      }

      /* -- Task 7: printf with variable reference -- */
      if (PRINTF_VAR_RE.test(rawCommand)) {
        throw new Error(
          `[varlock] Blocked: bash command uses printf with a variable reference. ` +
            `Use the load_env or load_secrets tool instead.`,
        )
      }

      /* -- Task 8: bare set piped/redirected -- */
      if (SET_PIPE_RE.test(rawCommand)) {
        throw new Error(
          `[varlock] Blocked: bash command uses "set" in a way that may expose variables. ` +
            `Use the load_env or load_secrets tool instead.`,
        )
      }

      /* -- Task 9: bare env command -- */
      if (BARE_ENV_RE.test(rawCommand)) {
        throw new Error(
          `[varlock] Blocked: bare "env" command may expose environment variables. ` +
            `Use the load_env or load_secrets tool instead.`,
        )
      }

      /* -- Existing + Task 6 safe-pattern check: string deny patterns -- */
      for (const pattern of bashDeny) {
        if (cmd.includes(pattern.toLowerCase())) {
          // Task 6: If the command only references safe env files, allow it
          if (isSafeEnvReference(rawCommand)) {
            continue
          }
          throw new Error(
            `[varlock] Blocked: bash command matches deny pattern "${pattern}". ` +
              `Use the load_env or load_secrets tool to access secrets.`,
          )
        }
      }

      /* -- Existing + Task 3: file viewer/processor regex with sensitive patterns -- */
      for (const sp of sensitivePatterns) {
        // Task 6: skip safe env patterns
        if (SAFE_ENV_PATTERNS.some((safe) => sp.toLowerCase() === safe.toLowerCase())) {
          continue
        }
        // Task 3: expanded list of file processors
        // Use [\s\S]* between command and pattern to match across flags/arguments
        const fileAccessRe = new RegExp(
          `(cat|less|more|head|tail|bat|vim?|nano|code|type|get-content|select-string|sed|awk|cut|sort|tac|rev|paste|dd|tee|xargs|nl|fold|strings|xxd|od|hexdump|column)\\s[\\s\\S]*${escapeRegex(sp)}`,
          "i",
        )
        if (fileAccessRe.test(rawCommand)) {
          // Task 6: allow safe env file references
          if (isSafeEnvReference(rawCommand)) {
            continue
          }
          throw new Error(
            `[varlock] Blocked: bash command appears to read a sensitive file (*${sp}*). ` +
              `Use the load_env or load_secrets tool instead.`,
          )
        }
      }

      /* -- Task 4: shell redirect patterns -- */
      for (const pattern of shellRedirectPatterns) {
        if (pattern.test(rawCommand)) {
          if (isSafeEnvReference(rawCommand)) {
            continue
          }
          throw new Error(
            `[varlock] Blocked: bash command uses shell redirects to read a sensitive file. ` +
              `Use the load_env or load_secrets tool instead.`,
          )
        }
      }

      if (compiledGlobs.length > 0) {
        const tokens = extractPathTokens(rawCommand)
        for (const token of tokens) {
          // Task 6: skip safe env file tokens
          if (isSafeEnvToken(token)) {
            continue
          }
          for (const { source, regex } of compiledGlobs) {
            if (regex.test(token)) {
              throw new Error(
                `[varlock] Blocked: bash command references "${token}" which matches glob "${source}". ` +
                  `Use the load_env or load_secrets tool instead.`,
              )
            }
          }
        }
      }
    }
  }
}

/* ------------------------------------------------------------------ *
 *  Task 6: Safe env pattern helpers
 * ------------------------------------------------------------------ */

/**
 * Returns true if a path ends with a known safe env file suffix.
 */
function isSafeEnvToken(token: string): boolean {
  const lower = token.toLowerCase()
  return SAFE_ENV_PATTERNS.some((safe) => lower.endsWith(safe.toLowerCase()))
}

/**
 * Returns true if the command ONLY references safe env files (e.g. .env.example)
 * and does NOT reference actual secret env files.
 * We check if every .env mention in the command is a safe one.
 */
function isSafeEnvReference(command: string): boolean {
  // Find all .env references in the command
  const envRefs = command.match(/\S*\.env\S*/gi)
  if (!envRefs) return false

  // Every .env reference must be a safe pattern
  return envRefs.every((ref) =>
    SAFE_ENV_PATTERNS.some((safe) =>
      ref.toLowerCase().endsWith(safe.toLowerCase()),
    ),
  )
}

function isSensitive(
  path: string,
  patterns: string[],
  globs: CompiledGlob[],
): boolean {
  const lower = path.toLowerCase()

  // Task 6: allow safe env files through
  if (SAFE_ENV_PATTERNS.some((safe) => lower.endsWith(safe.toLowerCase()))) {
    return false
  }

  if (patterns.some((p) => lower.includes(p.toLowerCase()))) {
    return true
  }

  for (const { regex } of globs) {
    if (regex.test(path) || regex.test(lower)) {
      return true
    }
  }

  return false
}

export function globToRegex(glob: string): RegExp {
  let result = ""
  let i = 0

  while (i < glob.length) {
    const ch = glob[i]

    if (ch === "*") {
      if (glob[i + 1] === "*") {
        if (glob[i + 2] === "/") {
          result += "(?:.*/)?"
          i += 3
        } else {
          result += ".*"
          i += 2
        }
      } else {
        result += "[^/]*"
        i++
      }
    } else if (ch === "?") {
      result += "[^/]"
      i++
    } else if (ch === ".") {
      result += "\\."
      i++
    } else if (ch === "/" || ch === "\\") {
      result += "[\\\\/]"
      i++
    } else if ("(){}[]^$+|".includes(ch)) {
      result += "\\" + ch
      i++
    } else {
      result += ch
      i++
    }
  }

  return new RegExp(`^${result}$`, "i")
}

function extractPathTokens(cmd: string): string[] {
  const tokenRe = /(?:^|\s)((?:\.{0,2}\/)?[a-zA-Z0-9_./-]+\.[a-zA-Z0-9_.*]+)/g
  const tokens: string[] = []
  let match: RegExpExecArray | null

  while ((match = tokenRe.exec(cmd)) !== null) {
    const token = match[1].trim()
    if (token.length > 1 && !token.startsWith("-")) {
      tokens.push(token)
    }
  }

  return tokens
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}
