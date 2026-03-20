import { describe, expect, test } from "vitest"
import { writeFile, mkdir } from "node:fs/promises"
import { loadConfig, deepMerge, DEFAULT_CONFIG } from "../../src/config.js"
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
})
