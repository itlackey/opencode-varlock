import { tool } from "@opencode-ai/plugin"
import { readFileSync, existsSync } from "fs"
import { resolve } from "path"
import type { EnvConfig, VarlockConfig } from "./config.js"

export function createLoadEnvTool(envConfig: EnvConfig) {
  const allowedRoot = resolve(envConfig.allowedRoot)

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

      const content = readFileSync(envPath, "utf-8")
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

      let keyList: string[]
      if (args.keys && args.keys.length > 0) {
        keyList = args.keys
      } else {
        try {
          const raw = await $`${cmd} list ${ns}`.text()
          keyList = raw
            .trim()
            .split("\n")
            .filter((k: string) => k.length > 0)
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
          const value = (await $`${cmd} get ${ns}/${key}`.text()).trim()
          if (value) {
            process.env[envName] = value
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

      let available: string[]
      try {
        const raw = await $`${cmd} list ${ns}`.text()
        available = raw
          .trim()
          .split("\n")
          .filter((k: string) => k.length > 0)
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
