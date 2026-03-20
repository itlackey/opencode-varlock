import { describe, expect, test } from "vitest"
import { createEnvGuard } from "../../src/guard.js"
import { DEFAULT_CONFIG } from "../../src/config.js"

describe("guard", () => {
  const guard = createEnvGuard(DEFAULT_CONFIG.guard)

  test("blocks direct reads of sensitive files", async () => {
    await expect(
      guard({ tool: "read" }, { args: { filePath: "/tmp/.env" } }),
    ).rejects.toThrow('cannot directly read "/tmp/.env"')
  })

  test("blocks writes to sensitive files", async () => {
    await expect(
      guard({ tool: "edit" }, { args: { filePath: "secrets/app.key" } }),
    ).rejects.toThrow('cannot write to "secrets/app.key"')
  })

  test("blocks bash commands that expose env files", async () => {
    await expect(
      guard({ tool: "bash" }, { args: { command: "cat .env" } }),
    ).rejects.toThrow('matches deny pattern "cat .env"')
  })

  test("allows non-sensitive paths and commands", async () => {
    await expect(
      guard({ tool: "read" }, { args: { filePath: "/tmp/index.ts" } }),
    ).resolves.toBeUndefined()

    await expect(
      guard({ tool: "bash" }, { args: { command: "npm test" } }),
    ).resolves.toBeUndefined()
  })
})
