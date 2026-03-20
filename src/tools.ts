import { tool } from "@opencode-ai/plugin"
import { readFileSync, existsSync, realpathSync } from "fs"
import { resolve } from "path"
import type { EnvConfig, VarlockConfig } from "./config.js"
import type { SecretRegistry } from "./scrubber.js"

const SAFE_INPUT_RE = /^[a-zA-Z0-9_.\-\/]+$/

function validateInput(value: string, label: string): void {
  if (!SAFE_INPUT_RE.test(value)) {
    throw new Error(
      `[varlock] Invalid ${label}: "${value}". Only alphanumeric, hyphens, underscores, dots, and slashes are allowed.`,
    )
  }
}

export function createLoadEnvTool(envConfig: EnvConfig, registry?: SecretRegistry) {
  let allowedRoot: string
  try {
    allowedRoot = realpathSync(resolve(envConfig.allowedRoot))
  } catch {
    allowedRoot = resolve(envConfig.allowedRoot)
  }

  return tool({
    description: [
      "Load environment variables from a .env file into the running process.",
      "Returns the names of variables that were set - never the values.",
      "The agent can then write code that references process.env.VAR_NAME",
      "without ever seeing the actual secret.",
    ].join(" "),
    args: {
      path: tool.schema
        .string()
        .optional()
        .default(".env")
        .describe("Relative or absolute path to the .env file"),
      override: tool.schema
        .boolean()
        .optional()
        .default(false)
        .describe("Replace vars that already exist in the environment"),
      prefix: tool.schema
        .string()
        .optional()
        .describe("Only load vars whose name starts with this prefix"),
    },
    async execute(args) {
      const envPath = resolve(args.path)

      if (!envPath.startsWith(allowedRoot)) {
        throw new Error(
          `[varlock] Path "${args.path}" resolves outside the allowed root. ` +
            `Only .env files under "${allowedRoot}" are permitted.`,
        )
      }

      if (!existsSync(envPath)) {
        throw new Error(`[varlock] File not found: ${envPath}`)
      }

      const realPath = realpathSync(envPath)
      if (!realPath.startsWith(allowedRoot)) {
        throw new Error(
          `[varlock] Path "${args.path}" resolves outside the allowed root via symlink. ` +
            `Only .env files under "${allowedRoot}" are permitted.`,
        )
      }

      const content = readFileSync(realPath, "utf-8")
      const loaded: string[] = []
      const skipped: string[] = []

      for (const line of content.split("\n")) {
        const trimmed = line.trim()

        if (!trimmed || trimmed.startsWith("#")) continue

        const eqIdx = trimmed.indexOf("=")
        if (eqIdx === -1) continue

        let keyPart = trimmed.slice(0, eqIdx).trim()
        if (keyPart.startsWith("export ")) {
          keyPart = keyPart.slice(7).trim()
        }

        if (args.prefix && !keyPart.startsWith(args.prefix)) continue

        let value = trimmed.slice(eqIdx + 1).trim()
        if (
          (value.startsWith('"') && value.endsWith('"')) ||
          (value.startsWith("'") && value.endsWith("'"))
        ) {
          value = value.slice(1, -1)
        }

        if (process.env[keyPart] && !args.override) {
          skipped.push(keyPart)
          continue
        }

        process.env[keyPart] = value
        registry?.register(keyPart, value)
        loaded.push(keyPart)
      }

      return JSON.stringify({
        status: "ok",
        source: args.path,
        loaded,
        skipped,
        message:
          `Loaded ${loaded.length} variable(s): ${loaded.join(", ") || "(none)"}` +
          (skipped.length
            ? `. Skipped ${skipped.length} existing: ${skipped.join(", ")}`
            : ""),
      })
    },
  })
}

export function createLoadSecretsTool(
  $: any,
  varlockConfig: VarlockConfig,
  registry?: SecretRegistry,
) {
  const cmd = varlockConfig.command
  const defaultNs = varlockConfig.namespace

  return tool({
    description: [
      "Load secrets from Varlock into the running process environment.",
      "Varlock retrieves secrets from the configured backend (pass, Azure Key Vault, etc.).",
      "Returns only the names of loaded variables - never the values.",
    ].join(" "),
    args: {
      namespace: tool.schema
        .string()
        .optional()
        .default(defaultNs)
        .describe("Varlock namespace / path prefix to load from"),
      keys: tool.schema
        .array(tool.schema.string())
        .optional()
        .describe(
          "Specific secret keys to load. If omitted, loads all keys in the namespace.",
        ),
      override: tool.schema
        .boolean()
        .optional()
        .default(false)
        .describe("Replace vars that already exist in the environment"),
      envPrefix: tool.schema
        .string()
        .optional()
        .describe(
          "Prefix to add to env var names, e.g. 'APP_' turns 'db_url' into 'APP_DB_URL'",
        ),
    },
    async execute(args) {
      const ns = args.namespace

      if (ns) {
        validateInput(ns, "namespace")
      }

      if (args.envPrefix) {
        validateInput(args.envPrefix, "envPrefix")
      }

      let keyList: string[]
      if (args.keys && args.keys.length > 0) {
        for (const key of args.keys) {
          validateInput(key, "key")
        }
        keyList = args.keys
      } else {
        try {
          const raw = await $`${cmd} load --format json`.text()
          const parsed = JSON.parse(raw)
          keyList = Object.keys(parsed)
          if (ns) {
            keyList = keyList.filter((k: string) =>
              k.toLowerCase().startsWith(ns.toLowerCase()),
            )
          }
        } catch (err: any) {
          throw new Error(
            `[varlock] Failed to list keys in namespace "${ns}": ${err.message}`,
          )
        }
      }

      const loaded: string[] = []
      const failed: string[] = []
      const skipped: string[] = []

      for (const key of keyList) {
        const envName = args.envPrefix
          ? `${args.envPrefix}${key.toUpperCase()}`
          : key.toUpperCase()

        if (process.env[envName] && !args.override) {
          skipped.push(envName)
          continue
        }

        try {
          const value = (await $`${cmd} printenv ${key}`.text()).trim()
          if (value) {
            process.env[envName] = value
            registry?.register(envName, value)
            loaded.push(envName)
          }
        } catch {
          failed.push(key)
        }
      }

      const parts = [
        `Loaded ${loaded.length} secret(s): ${loaded.join(", ") || "(none)"}`,
      ]
      if (skipped.length) {
        parts.push(`Skipped ${skipped.length} existing: ${skipped.join(", ")}`)
      }
      if (failed.length) {
        parts.push(`Failed ${failed.length}: ${failed.join(", ")}`)
      }

      return JSON.stringify({
        status: failed.length === keyList.length ? "error" : "ok",
        source: `varlock/${ns}`,
        loaded,
        skipped,
        failed,
        message: parts.join(". "),
      })
    },
  })
}

export function createSecretStatusTool(
  $: any,
  varlockConfig: VarlockConfig,
) {
  const cmd = varlockConfig.command
  const defaultNs = varlockConfig.namespace

  return tool({
    description: [
      "Check which secrets are available in Varlock and which are",
      "currently loaded in the process environment.",
      "Returns key names and loaded/unloaded status - never values.",
    ].join(" "),
    args: {
      namespace: tool.schema
        .string()
        .optional()
        .default(defaultNs)
        .describe("Varlock namespace to inspect"),
    },
    async execute(args) {
      const ns = args.namespace

      if (ns) {
        validateInput(ns, "namespace")
      }

      let available: string[]
      try {
        const raw = await $`${cmd} load --format json`.text()
        const parsed = JSON.parse(raw)
        available = Object.keys(parsed)
        if (ns) {
          available = available.filter((k: string) =>
            k.toLowerCase().startsWith(ns.toLowerCase()),
          )
        }
      } catch (err: any) {
        throw new Error(
          `[varlock] Cannot list namespace "${ns}": ${err.message}`,
        )
      }

      const status = available.map((key) => {
        const envName = key.toUpperCase()
        return {
          key,
          envName,
          loaded: envName in process.env,
        }
      })

      const loadedCount = status.filter((s) => s.loaded).length

      return JSON.stringify({
        namespace: ns,
        total: available.length,
        loaded: loadedCount,
        unloaded: available.length - loadedCount,
        keys: status,
      })
    },
  })
}
