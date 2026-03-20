import { describe, expect, test } from "vitest"
import { writeFile, mkdir } from "node:fs/promises"
import { loadConfig, deepMerge, DEFAULT_CONFIG, validateConfig } from "../../src/config.js"
import { createTempProject } from "../helpers.js"

describe("config", () => {
  test("deepMerge replaces arrays instead of concatenating", () => {
    const merged = deepMerge(DEFAULT_CONFIG, {
      guard: {
        sensitiveGlobs: ["custom/**"],
      },
    })

    expect(merged.guard.sensitiveGlobs).toEqual(["custom/**"])
  })

  test("loadConfig merges root file, .opencode file, and overrides", async () => {
    const project = await createTempProject("varlock-config")

    try {
      await writeFile(
        project.path("varlock.config.json"),
        JSON.stringify({
          env: { allowedRoot: "config" },
          varlock: { enabled: true },
        }),
      )
      await mkdir(project.path(".opencode"), { recursive: true })
      await writeFile(
        project.path(".opencode", "varlock.config.json"),
        JSON.stringify({
          guard: { enabled: false },
          varlock: { namespace: "workspace" },
        }),
      )

      const config = loadConfig(project.root, {
        env: { enabled: false },
      })

      expect(config.guard.enabled).toBe(false)
      expect(config.varlock.enabled).toBe(true)
      expect(config.varlock.namespace).toBe("workspace")
      expect(config.env.enabled).toBe(false)
      expect(config.env.allowedRoot).toBe(project.path("config"))
    } finally {
      await project.dispose()
    }
  })

  // ── Config validation ────────────────────────────────────────────────

  describe("validateConfig", () => {
    test("returns errors for non-boolean guard.enabled", () => {
      const errors = validateConfig({
        guard: { enabled: "yes" },
      })
      expect(errors).toContain(
        "guard.enabled must be boolean, got string",
      )
    })

    test("returns errors for non-array sensitivePatterns", () => {
      const errors = validateConfig({
        guard: { sensitivePatterns: "not-an-array" },
      })
      expect(errors).toContain("guard.sensitivePatterns must be an array")
    })

    test("returns no errors for valid config", () => {
      const errors = validateConfig({
        guard: {
          enabled: true,
          sensitivePatterns: [".env"],
          sensitiveGlobs: ["**/.env"],
          bashDenyPatterns: [],
          blockedReadTools: ["read"],
          blockedWriteTools: ["write"],
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
      })
      expect(errors).toEqual([])
    })

    test("loadConfig sanitizes invalid values before merge (boolean field set to string)", async () => {
      const project = await createTempProject("varlock-sanitize")

      try {
        // Write a config file where guard.enabled is a string instead of boolean
        await writeFile(
          project.path("varlock.config.json"),
          JSON.stringify({
            guard: { enabled: "true" },
          }),
        )

        const config = loadConfig(project.root)

        // The sanitizer should have removed the invalid "true" string,
        // so the default boolean true should be preserved
        expect(config.guard.enabled).toBe(true)
        expect(typeof config.guard.enabled).toBe("boolean")
      } finally {
        await project.dispose()
      }
    })

    test("varlock.config is in default sensitivePatterns", () => {
      expect(DEFAULT_CONFIG.guard.sensitivePatterns).toContain("varlock.config")
    })
  })
})
