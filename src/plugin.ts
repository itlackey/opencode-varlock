import { type Plugin, tool } from "@opencode-ai/plugin"
import { loadConfig, type PluginConfig, type DeepPartial } from "./config.js"
import { createEnvGuard } from "./guard.js"
import {
  createLoadEnvTool,
  createLoadSecretsTool,
  createSecretStatusTool,
} from "./tools.js"

export const VarlockPlugin: Plugin = async (ctx) => {
  return createVarlockPlugin()(ctx)
}

export function createVarlockPlugin(
  overrides: DeepPartial<PluginConfig> = {},
): Plugin {
  return async ({ $, project, directory }) => {
    const cwd = directory ?? process.cwd()

    const config = loadConfig(cwd, overrides)

    let varlockAvailable = config.varlock.enabled
    if (!varlockAvailable && config.varlock.autoDetect) {
      try {
        const result = await $`which ${config.varlock.command}`.quiet()
        varlockAvailable = result.exitCode === 0
        if (varlockAvailable) {
          console.log(
            `[varlock] Auto-detected "${config.varlock.command}" CLI`,
          )
        }
      } catch {
        varlockAvailable = false
      }
    }

    const tools: Record<string, ReturnType<typeof tool>> = {}

    if (config.env.enabled) {
      tools.load_env = createLoadEnvTool(config.env)
    }

    if (varlockAvailable) {
      tools.load_secrets = createLoadSecretsTool($, config.varlock)
      tools.secret_status = createSecretStatusTool($, config.varlock)
    }

    const hookResult: Record<string, any> = {
      tool: tools,

      event: async ({ event }: { event: { type: string } }) => {
        if (event.type === "session.created") {
          const sources: string[] = []
          if (config.env.enabled) sources.push(".env")
          if (varlockAvailable) sources.push(`varlock (${config.varlock.command})`)

          const guardStatus = config.guard.enabled
            ? `${config.guard.sensitivePatterns.length} patterns, ${config.guard.sensitiveGlobs.length} globs`
            : "disabled"

          console.log(
            `[varlock] Sources: ${sources.join(", ") || "none"} | Guard: ${guardStatus}`,
          )
        }
      },
    }

    if (config.guard.enabled) {
      hookResult["tool.execute.before"] = createEnvGuard(config.guard)
    }

    return hookResult
  }
}

export default VarlockPlugin
