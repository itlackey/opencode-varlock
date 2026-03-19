/**
 * EnvGuard - tool.execute.before hook that prevents agents from
 * reading sensitive files or running commands that expose secrets.
 */

import type { GuardConfig } from "./config.js"

export type { GuardConfig } from "./config.js"

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
]

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
      const cmd = String(args.command ?? "").toLowerCase()

      for (const pattern of bashDeny) {
        if (cmd.includes(pattern.toLowerCase())) {
          throw new Error(
            `[varlock] Blocked: bash command matches deny pattern "${pattern}". ` +
              `Use the load_env or load_secrets tool to access secrets.`,
          )
        }
      }

      for (const sp of sensitivePatterns) {
        const fileAccessRe = new RegExp(
          `(cat|less|more|head|tail|bat|vim?|nano|code|type|get-content|select-string)\\s+\\S*${escapeRegex(sp)}`,
          "i",
        )
        if (fileAccessRe.test(String(args.command ?? ""))) {
          throw new Error(
            `[varlock] Blocked: bash command appears to read a sensitive file (*${sp}*). ` +
              `Use the load_env or load_secrets tool instead.`,
          )
        }
      }

      if (compiledGlobs.length > 0) {
        const tokens = extractPathTokens(String(args.command ?? ""))
        for (const token of tokens) {
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

function isSensitive(
  path: string,
  patterns: string[],
  globs: CompiledGlob[],
): boolean {
  const lower = path.toLowerCase()

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
