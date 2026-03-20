/**
 * Configuration system for opencode-varlock.
 *
 * Resolution order (last wins):
 *   1. Built-in defaults
 *   2. varlock.config.json in project root
 *   3. .opencode/varlock.config.json
 *   4. Programmatic options passed to createVarlockPlugin()
 */

import { existsSync, readFileSync } from "fs"
import { isAbsolute, resolve } from "path"

export type GuardConfig = {
  enabled: boolean
  sensitivePatterns: string[]
  sensitiveGlobs: string[]
  bashDenyPatterns: string[]
  blockedReadTools: string[]
  blockedWriteTools: string[]
}

export type EnvConfig = {
  enabled: boolean
  allowedRoot: string
}

export type VarlockConfig = {
  enabled: boolean
  autoDetect: boolean
  command: string
  namespace: string
}

export type PluginConfig = {
  guard: GuardConfig
  env: EnvConfig
  varlock: VarlockConfig
}

export const DEFAULT_CONFIG: PluginConfig = {
  guard: {
    enabled: true,
    sensitivePatterns: [
      ".env",
      ".secret",
      ".pem",
      ".key",
      "credentials",
      ".pgpass",
    ],
    sensitiveGlobs: [
      "**/.env",
      "**/.env.*",
      "**/.env.local",
      "**/.env.production",
      "**/*.pem",
      "**/*.key",
      "**/credentials",
      "**/credentials.*",
      "**/.pgpass",
      "secrets/**",
    ],
    bashDenyPatterns: [],
    blockedReadTools: ["read", "grep", "glob", "view"],
    blockedWriteTools: ["write", "edit"],
  },
  env: {
    enabled: true,
    allowedRoot: ".",
  },
  varlock: {
    enabled: false,
    autoDetect: true,
    command: "varlock",
    namespace: "app",
  },
}

const CONFIG_FILENAMES = [
  "varlock.config.json",
  ".opencode/varlock.config.json",
]

export function loadConfig(
  cwd: string,
  overrides: DeepPartial<PluginConfig> = {},
): PluginConfig {
  let merged = structuredClone(DEFAULT_CONFIG)

  for (const filename of CONFIG_FILENAMES) {
    const filepath = resolve(cwd, filename)
    if (existsSync(filepath)) {
      try {
        const raw = readFileSync(filepath, "utf-8")
        const parsed = JSON.parse(raw)

        delete parsed.$schema
        delete parsed.$comment

        merged = deepMerge(merged, parsed)
        console.log(`[varlock] Loaded config from ${filepath}`)
      } catch (err: any) {
        console.warn(`[varlock] Failed to parse ${filepath}: ${err.message}`)
      }
    }
  }

  merged = deepMerge(merged, overrides as any)

  if (merged.env.allowedRoot && !isAbsolute(merged.env.allowedRoot)) {
    merged.env.allowedRoot = resolve(cwd, merged.env.allowedRoot)
  } else if (merged.env.allowedRoot) {
    merged.env.allowedRoot = resolve(merged.env.allowedRoot)
  }

  return merged
}

type DeepPartial<T> = {
  [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K]
}

export function deepMerge<T extends Record<string, any>>(
  target: T,
  source: DeepPartial<T>,
): T {
  const result = { ...target }

  for (const key of Object.keys(source) as Array<keyof T>) {
    const srcVal = source[key]
    if (srcVal === undefined || srcVal === null) continue

    if (Array.isArray(srcVal)) {
      ;(result as any)[key] = [...srcVal]
    } else if (
      typeof srcVal === "object" &&
      !Array.isArray(srcVal) &&
      typeof result[key] === "object" &&
      !Array.isArray(result[key])
    ) {
      ;(result as any)[key] = deepMerge(
        result[key] as Record<string, any>,
        srcVal as Record<string, any>,
      )
    } else {
      ;(result as any)[key] = srcVal
    }
  }

  return result
}

export type { DeepPartial }
