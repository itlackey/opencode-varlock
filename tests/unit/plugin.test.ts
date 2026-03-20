import { describe, expect, test } from "vitest"
import { createVarlockPlugin } from "../../src/plugin.js"
import { createTempProject } from "../helpers.js"

describe("plugin", () => {
  test("registers load_env and guard hook from overrides", async () => {
    const project = await createTempProject("varlock-plugin")

    try {
      const plugin = createVarlockPlugin({
        env: { enabled: true },
        varlock: { enabled: false, autoDetect: false },
      })

      const hooks = await plugin({
        client: {
          app: {
            log: async () => ({})
          }
        } as any,
        project: {} as any,
        worktree: project.root,
        directory: project.root,
        $: (() => {
          throw new Error("autodetect should not run")
        }) as any,
      })

      expect(hooks.tool?.load_env).toBeDefined()
      expect(hooks.tool?.load_secrets).toBeUndefined()
      expect(hooks["tool.execute.before"]).toBeTypeOf("function")
    } finally {
      await project.dispose()
    }
  })
})
