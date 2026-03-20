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

export type ConfigLogger = (input: {
  level: "debug" | "info" | "warn" | "error"
  message: string
  extra?: Record<string, unknown>
}) => void | Promise<void>

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
      "varlock.config",
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
      "**/varlock.config.json",
      "**/.opencode/varlock.config.json",
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

/**
 * Validates a parsed config object against the expected schema.
 * Returns an array of human-readable error strings (empty = valid).
 */
export function validateConfig(
  config: unknown,
  logger?: ConfigLogger,
): string[] {
  const errors: string[] = []

  if (typeof config !== "object" || config === null) {
    errors.push("Config must be an object")
    return errors
  }

  const c = config as Record<string, any>

  // Validate guard section
  if (c.guard !== undefined) {
    if (typeof c.guard !== "object" || c.guard === null) {
      errors.push("guard must be an object")
    } else {
      if (
        c.guard.enabled !== undefined &&
        typeof c.guard.enabled !== "boolean"
      ) {
        errors.push(
          `guard.enabled must be boolean, got ${typeof c.guard.enabled}`,
        )
      }
      if (
        c.guard.sensitivePatterns !== undefined &&
        !Array.isArray(c.guard.sensitivePatterns)
      ) {
        errors.push("guard.sensitivePatterns must be an array")
      }
      if (
        c.guard.sensitiveGlobs !== undefined &&
        !Array.isArray(c.guard.sensitiveGlobs)
      ) {
        errors.push("guard.sensitiveGlobs must be an array")
      }
      if (
        c.guard.bashDenyPatterns !== undefined &&
        !Array.isArray(c.guard.bashDenyPatterns)
      ) {
        errors.push("guard.bashDenyPatterns must be an array")
      }
      if (
        c.guard.blockedReadTools !== undefined &&
        !Array.isArray(c.guard.blockedReadTools)
      ) {
        errors.push("guard.blockedReadTools must be an array")
      }
      if (
        c.guard.blockedWriteTools !== undefined &&
        !Array.isArray(c.guard.blockedWriteTools)
      ) {
        errors.push("guard.blockedWriteTools must be an array")
      }
      // Validate array contents are strings
      for (const arrKey of [
        "sensitivePatterns",
        "sensitiveGlobs",
        "bashDenyPatterns",
        "blockedReadTools",
        "blockedWriteTools",
      ]) {
        if (Array.isArray(c.guard[arrKey])) {
          for (let i = 0; i < c.guard[arrKey].length; i++) {
            if (typeof c.guard[arrKey][i] !== "string") {
              errors.push(`guard.${arrKey}[${i}] must be a string`)
            }
          }
        }
      }
    }
  }

  // Validate env section
  if (c.env !== undefined) {
    if (typeof c.env !== "object" || c.env === null) {
      errors.push("env must be an object")
    } else {
      if (c.env.enabled !== undefined && typeof c.env.enabled !== "boolean") {
        errors.push(`env.enabled must be boolean, got ${typeof c.env.enabled}`)
      }
      if (
        c.env.allowedRoot !== undefined &&
        typeof c.env.allowedRoot !== "string"
      ) {
        errors.push("env.allowedRoot must be a string")
      }
    }
  }

  // Validate varlock section
  if (c.varlock !== undefined) {
    if (typeof c.varlock !== "object" || c.varlock === null) {
      errors.push("varlock must be an object")
    } else {
      if (
        c.varlock.enabled !== undefined &&
        typeof c.varlock.enabled !== "boolean"
      ) {
        errors.push(
          `varlock.enabled must be boolean, got ${typeof c.varlock.enabled}`,
        )
      }
      if (
        c.varlock.autoDetect !== undefined &&
        typeof c.varlock.autoDetect !== "boolean"
      ) {
        errors.push(
          `varlock.autoDetect must be boolean, got ${typeof c.varlock.autoDetect}`,
        )
      }
      if (
        c.varlock.command !== undefined &&
        typeof c.varlock.command !== "string"
      ) {
        errors.push("varlock.command must be a string")
      }
      if (
        c.varlock.namespace !== undefined &&
        typeof c.varlock.namespace !== "string"
      ) {
        errors.push("varlock.namespace must be a string")
      }
    }
  }

  return errors
}

/**
 * Removes invalid keys from a parsed config so they won't be merged.
 * Mutates the object in place and returns the list of keys that were removed.
 */
function sanitizeConfig(config: Record<string, any>): string[] {
  const removed: string[] = []

  const sections: Array<{
    name: string
    booleans: string[]
    strings: string[]
    arrays: string[]
  }> = [
    {
      name: "guard",
      booleans: ["enabled"],
      strings: [],
      arrays: [
        "sensitivePatterns",
        "sensitiveGlobs",
        "bashDenyPatterns",
        "blockedReadTools",
        "blockedWriteTools",
      ],
    },
    {
      name: "env",
      booleans: ["enabled"],
      strings: ["allowedRoot"],
      arrays: [],
    },
    {
      name: "varlock",
      booleans: ["enabled", "autoDetect"],
      strings: ["command", "namespace"],
      arrays: [],
    },
  ]

  for (const section of sections) {
    const s = config[section.name]
    if (s === undefined) continue
    if (typeof s !== "object" || s === null) {
      delete config[section.name]
      removed.push(section.name)
      continue
    }

    for (const key of section.booleans) {
      if (s[key] !== undefined && typeof s[key] !== "boolean") {
        delete s[key]
        removed.push(`${section.name}.${key}`)
      }
    }
    for (const key of section.strings) {
      if (s[key] !== undefined && typeof s[key] !== "string") {
        delete s[key]
        removed.push(`${section.name}.${key}`)
      }
    }
    for (const key of section.arrays) {
      if (s[key] !== undefined && !Array.isArray(s[key])) {
        delete s[key]
        removed.push(`${section.name}.${key}`)
      } else if (Array.isArray(s[key])) {
        // Filter out non-string elements from arrays
        const original = s[key] as unknown[]
        const filtered = original.filter(
          (v: unknown): v is string => typeof v === "string",
        )
        if (filtered.length !== original.length) {
          s[key] = filtered
          removed.push(`${section.name}.${key} (non-string elements removed)`)
        }
      }
    }
  }

  return removed
}

const CONFIG_FILENAMES = [
  "varlock.config.json",
  ".opencode/varlock.config.json",
]

export function loadConfig(
  cwd: string,
  overrides: DeepPartial<PluginConfig> = {},
  logger?: ConfigLogger,
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

        // Validate and warn about any schema violations
        const validationErrors = validateConfig(parsed, logger)
        if (validationErrors.length > 0) {
          logger?.({
            level: "warn",
            message: "config validation warnings",
            extra: { filepath, errors: validationErrors },
          })
        }

        // Remove invalid values so they don't override safe defaults
        const removedKeys = sanitizeConfig(parsed)
        if (removedKeys.length > 0) {
          logger?.({
            level: "warn",
            message: "invalid config values removed before merge",
            extra: { filepath, removedKeys },
          })
        }

        merged = deepMerge(merged, parsed)
        logger?.({
          level: "info",
          message: "loaded config",
          extra: { filepath },
        })
      } catch (err: any) {
        logger?.({
          level: "warn",
          message: "failed to parse config",
          extra: {
            filepath,
            error: err instanceof Error ? err.message : String(err),
          },
        })
      }
    }
  }

  // Validate and sanitize programmatic overrides the same way
  if (overrides && typeof overrides === "object") {
    const overridesObj = overrides as Record<string, any>
    const overrideErrors = validateConfig(overridesObj, logger)
    if (overrideErrors.length > 0) {
      logger?.({
        level: "warn",
        message: "config validation warnings in programmatic overrides",
        extra: { errors: overrideErrors },
      })
    }
    const removedKeys = sanitizeConfig(overridesObj)
    if (removedKeys.length > 0) {
      logger?.({
        level: "warn",
        message: "invalid override values removed before merge",
        extra: { removedKeys },
      })
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
