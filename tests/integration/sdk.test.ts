import { afterAll, beforeAll, describe, expect, test } from "vitest"
import { spawnSync } from "node:child_process"
import { createOpencodeClient, createOpencodeServer } from "@opencode-ai/sdk"
import { createTempProject } from "../helpers.js"

const pluginEntry = new URL("../../dist/index.js", import.meta.url).href
const hasOpencodeBinary = spawnSync("opencode", ["--help"], { stdio: "ignore" }).status === 0

function randomPort() {
  return 4500 + Math.floor(Math.random() * 1000)
}

describe.skipIf(!hasOpencodeBinary)("OpenCode SDK integration", () => {
  let server: Awaited<ReturnType<typeof createOpencodeServer>> | undefined
  let cliDir: Awaited<ReturnType<typeof createTempProject>> | undefined
  let originalPath: string | undefined

  beforeAll(async () => {
    cliDir = await createTempProject("varlock-cli")
    await cliDir.writeExecutable(
      "bin/varlock",
      [
        "#!/usr/bin/env bash",
        "set -euo pipefail",
        'if [ "$1" = "list" ] && [ "$2" = "app" ]; then',
        '  printf "db_url\\napi_key\\n"',
        'elif [ "$1" = "get" ] && [ "$2" = "app/db_url" ]; then',
        '  printf "postgres://integration-secret\\n"',
        'elif [ "$1" = "get" ] && [ "$2" = "app/api_key" ]; then',
        '  printf "integration-token\\n"',
        "else",
        '  printf "unexpected args: %s\\n" "$*" >&2',
        "  exit 1",
        "fi",
      ].join("\n"),
    )

    originalPath = process.env.PATH
    process.env.PATH = `${cliDir.path("bin")}:${process.env.PATH ?? ""}`

    server = await createOpencodeServer({
      port: randomPort(),
      timeout: 15000,
    })
  }, 20000)

  afterAll(async () => {
    server?.close()
    process.env.PATH = originalPath
    await cliDir?.dispose()
  })

  test("loads plugin tools for a real project session", async () => {
    const project = await createTempProject("varlock-sdk")

    try {
      await project.write(
        "opencode.json",
        JSON.stringify({
          $schema: "https://opencode.ai/config.json",
          plugin: [pluginEntry],
        }),
      )
      await project.write(
        "varlock.config.json",
        JSON.stringify({
          env: { enabled: true },
          varlock: { enabled: false, autoDetect: false },
        }),
      )
      await project.write(".env", "DATABASE_URL=postgres://local\n")

      const client = createOpencodeClient({
        baseUrl: server!.url,
        directory: project.root,
      })

      const session = await client.session.create()
      expect(session.data.id).toBeTruthy()

      const tools = await client.tool.ids()
      expect(tools.data).toContain("load_env")
      expect(tools.data).not.toContain("load_secrets")
    } finally {
      await project.dispose()
    }
  }, 20000)

  test("respects project config that disables env tool", async () => {
    const project = await createTempProject("varlock-sdk-disabled")

    try {
      await project.write(
        "opencode.json",
        JSON.stringify({
          $schema: "https://opencode.ai/config.json",
          plugin: [pluginEntry],
        }),
      )
      await project.write(
        "varlock.config.json",
        JSON.stringify({
          env: { enabled: false },
          varlock: { enabled: false, autoDetect: false },
        }),
      )

      const client = createOpencodeClient({
        baseUrl: server!.url,
        directory: project.root,
      })

      await client.session.create()
      const tools = await client.tool.ids()

      expect(tools.data).not.toContain("load_env")
    } finally {
      await project.dispose()
    }
  }, 20000)

  test("registers varlock tools when the CLI is auto-detected", async () => {
    const project = await createTempProject("varlock-sdk-secrets")

    try {
      await project.write(
        "opencode.json",
        JSON.stringify({
          $schema: "https://opencode.ai/config.json",
          plugin: [pluginEntry],
        }),
      )
      await project.write(
        "varlock.config.json",
        JSON.stringify({
          env: { enabled: false },
          varlock: {
            enabled: false,
            autoDetect: true,
            command: "varlock",
            namespace: "app",
          },
        }),
      )

      const client = createOpencodeClient({
        baseUrl: server!.url,
        directory: project.root,
      })

      await client.session.create()
      const tools = await client.tool.ids()

      expect(tools.data).toContain("load_secrets")
      expect(tools.data).toContain("secret_status")
      expect(tools.data).not.toContain("load_env")
    } finally {
      await project.dispose()
    }
  }, 20000)
})
