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
          if (command === "varlock list app") return "db_url\napi_key\n"
          if (command === "varlock get app/db_url") return "postgres://secret\n"
          if (command === "varlock get app/api_key") return "token\n"
          throw new Error(`unexpected command: ${command}`)
        },
      }
    }

    await withEnv({ DB_URL: undefined, API_KEY: undefined }, async () => {
      const tool = createLoadSecretsTool($, {
        enabled: true,
        autoDetect: false,
        command: "varlock",
        namespace: "app",
      })

      const result = JSON.parse(await tool.execute({ namespace: "app", override: false }))

      expect(result.loaded).toEqual(["DB_URL", "API_KEY"])
      expect(result.message).not.toContain("postgres://secret")
      expect(calls).toEqual(["varlock list app", "varlock get app/db_url", "varlock get app/api_key"])
    })
  })

  test("secret_status reports loaded env names only", async () => {
    const $ = (strings: TemplateStringsArray, ...values: string[]) => ({
      async text() {
        const command = strings.reduce((acc, part, index) => acc + part + (values[index] ?? ""), "")
        if (command === "varlock list app") return "db_url\napi_key\n"
        throw new Error(`unexpected command: ${command}`)
      },
    })

    await withEnv({ DB_URL: "present", API_KEY: undefined }, async () => {
      const tool = createSecretStatusTool($, {
        enabled: true,
        autoDetect: false,
        command: "varlock",
        namespace: "app",
      })

      const result = JSON.parse(await tool.execute({ namespace: "app" }))

      expect(result.total).toBe(2)
      expect(result.loaded).toBe(1)
      expect(result.keys).toEqual([
        { key: "db_url", envName: "DB_URL", loaded: true },
        { key: "api_key", envName: "API_KEY", loaded: false },
      ])
    })
  })
})
