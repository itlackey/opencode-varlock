import { describe, expect, test } from "vitest"
import { createLoadEnvTool, createLoadSecretsTool, createSecretStatusTool } from "../../src/tools.js"
import { createTempProject, withEnv } from "../helpers.js"

describe("tools", () => {
  test("load_env loads names without exposing values", async () => {
    const project = await createTempProject("varlock-env")

    try {
      await project.write(
        ".env",
        ["FOO=secret-value", "BAR=another-value", "export APP_TOKEN=xyz"].join("\n"),
      )

      await withEnv({ FOO: undefined, BAR: undefined, APP_TOKEN: undefined }, async () => {
        const tool = createLoadEnvTool({ enabled: true, allowedRoot: project.root })
        const result = JSON.parse(await tool.execute({ path: project.path(".env"), override: false }))

        expect(result.loaded).toEqual(["FOO", "BAR", "APP_TOKEN"])
        expect(result.message).not.toContain("secret-value")
        expect(process.env.FOO).toBe("secret-value")
      })
    } finally {
      await project.dispose()
    }
  })

  test("load_secrets loads names from varlock shell wrapper", async () => {
    const calls: string[] = []
    const $ = (strings: TemplateStringsArray, ...values: string[]) => {
      const command = strings.reduce((acc, part, index) => acc + part + (values[index] ?? ""), "")
      calls.push(command)
      return {
        async text() {
          if (command === "varlock load --format json") return JSON.stringify({ db_url: { set: true }, api_key: { set: true } })
          if (command === "varlock printenv db_url") return "postgres://secret\n"
          if (command === "varlock printenv api_key") return "token\n"
          throw new Error(`unexpected command: ${command}`)
        },
      }
    }

    await withEnv({ DB_URL: undefined, API_KEY: undefined }, async () => {
      const tool = createLoadSecretsTool($, {
        enabled: true,
        autoDetect: false,
        command: "varlock",
        namespace: "",
      })

      const result = JSON.parse(await tool.execute({ namespace: "", override: false }))

      expect(result.loaded).toEqual(["DB_URL", "API_KEY"])
      expect(result.message).not.toContain("postgres://secret")
      expect(calls).toEqual(["varlock load --format json", "varlock printenv db_url", "varlock printenv api_key"])
    })
  })

  test("secret_status reports loaded env names only", async () => {
    const $ = (strings: TemplateStringsArray, ...values: string[]) => ({
      async text() {
        const command = strings.reduce((acc, part, index) => acc + part + (values[index] ?? ""), "")
        if (command === "varlock load --format json") return JSON.stringify({ db_url: { set: true }, api_key: { set: false } })
        throw new Error(`unexpected command: ${command}`)
      },
    })

    await withEnv({ DB_URL: "present", API_KEY: undefined }, async () => {
      const tool = createSecretStatusTool($, {
        enabled: true,
        autoDetect: false,
        command: "varlock",
        namespace: "",
      })

      const result = JSON.parse(await tool.execute({ namespace: "" }))

      expect(result.total).toBe(2)
      expect(result.loaded).toBe(1)
      expect(result.keys).toEqual([
        { key: "db_url", envName: "DB_URL", loaded: true },
        { key: "api_key", envName: "API_KEY", loaded: false },
      ])
    })
  })

  test("load_secrets rejects namespace with shell injection characters", async () => {
    const $ = () => ({ async text() { return "" } })

    const tool = createLoadSecretsTool($, {
      enabled: true,
      autoDetect: false,
      command: "varlock",
      namespace: "app",
    })

    await expect(
      tool.execute({ namespace: "app; cat .env", override: false }),
    ).rejects.toThrow("[varlock] Invalid namespace")
  })

  test("load_secrets rejects keys with shell injection characters", async () => {
    const $ = () => ({ async text() { return "" } })

    const tool = createLoadSecretsTool($, {
      enabled: true,
      autoDetect: false,
      command: "varlock",
      namespace: "app",
    })

    await expect(
      tool.execute({ namespace: "app", keys: ["valid_key", "bad$(whoami)"], override: false }),
    ).rejects.toThrow("[varlock] Invalid key")
  })

  test("secret_status rejects namespace with shell injection characters", async () => {
    const $ = () => ({ async text() { return "" } })

    const tool = createSecretStatusTool($, {
      enabled: true,
      autoDetect: false,
      command: "varlock",
      namespace: "app",
    })

    await expect(
      tool.execute({ namespace: "app && rm -rf /" }),
    ).rejects.toThrow("[varlock] Invalid namespace")
  })

  test("load_env rejects symlinks that escape allowed root", async () => {
    const { symlinkSync, mkdtempSync, writeFileSync, mkdirSync } = await import("fs")
    const { join } = await import("path")
    const { tmpdir } = await import("os")

    const outsideDir = mkdtempSync(join(tmpdir(), "varlock-outside-"))
    const projectDir = mkdtempSync(join(tmpdir(), "varlock-project-"))
    const secretFile = join(outsideDir, ".env")
    writeFileSync(secretFile, "SECRET=leaked")

    const symlinkPath = join(projectDir, ".env.link")
    symlinkSync(secretFile, symlinkPath)

    try {
      const tool = createLoadEnvTool({ enabled: true, allowedRoot: projectDir })

      await expect(
        tool.execute({ path: symlinkPath, override: false }),
      ).rejects.toThrow("resolves outside the allowed root via symlink")
    } finally {
      const { rmSync } = await import("fs")
      rmSync(outsideDir, { recursive: true, force: true })
      rmSync(projectDir, { recursive: true, force: true })
    }
  })

  test("load_secrets filters keys by namespace prefix", async () => {
    const $ = (strings: TemplateStringsArray, ...values: string[]) => {
      const command = strings.reduce((acc, part, index) => acc + part + (values[index] ?? ""), "")
      return {
        async text() {
          if (command === "varlock load --format json") {
            return JSON.stringify({
              app_db_url: { set: true },
              app_api_key: { set: true },
              other_secret: { set: true },
            })
          }
          if (command === "varlock printenv app_db_url") return "postgres://secret\n"
          if (command === "varlock printenv app_api_key") return "token\n"
          throw new Error(`unexpected command: ${command}`)
        },
      }
    }

    await withEnv({ APP_DB_URL: undefined, APP_API_KEY: undefined }, async () => {
      const tool = createLoadSecretsTool($, {
        enabled: true,
        autoDetect: false,
        command: "varlock",
        namespace: "app",
      })

      const result = JSON.parse(await tool.execute({ namespace: "app", override: false }))

      expect(result.loaded).toEqual(["APP_DB_URL", "APP_API_KEY"])
      expect(result.loaded).not.toContain("OTHER_SECRET")
    })
  })
})
