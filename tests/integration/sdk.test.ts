import { afterAll, beforeAll, describe, expect, test } from "vitest"
import { spawnSync } from "node:child_process"
import { createServer, type Server } from "node:http"
import { createOpencodeClient, createOpencodeServer } from "@opencode-ai/sdk"
import { createTempProject } from "../helpers.js"

const pluginEntry = new URL("../../dist/index.js", import.meta.url).href
const hasOpencodeBinary = spawnSync("opencode", ["--help"], { stdio: "ignore" }).status === 0

function randomPort() {
  return 4500 + Math.floor(Math.random() * 1000)
}

async function createMockOpenAICompatibleServer() {
  let requestCount = 0

  const server = createServer(async (req, res) => {
    if (req.method !== "POST" || req.url !== "/v1/chat/completions") {
      res.statusCode = 404
      res.end("not found")
      return
    }

    requestCount += 1

    res.writeHead(200, {
      "content-type": "text/event-stream",
      connection: "keep-alive",
      "cache-control": "no-cache",
    })

    if (requestCount === 1) {
      const args = JSON.stringify({
        command: "python -c 'import os; print(os.getenv(\"OLLAMA_MODELS\", \"\"))'",
      })

      writeSse(res, {
        id: "chatcmpl-tool-1",
        object: "chat.completion.chunk",
        created: 0,
        model: "model",
        choices: [
          {
            index: 0,
            delta: {
              role: "assistant",
              tool_calls: [
                {
                  index: 0,
                  id: "call_env_read",
                  type: "function",
                  function: {
                    name: "bash",
                    arguments: "",
                  },
                },
              ],
            },
            finish_reason: null,
          },
        ],
      })

      writeSse(res, {
        id: "chatcmpl-tool-1",
        object: "chat.completion.chunk",
        created: 0,
        model: "model",
        choices: [
          {
            index: 0,
            delta: {
              tool_calls: [
                {
                  index: 0,
                  function: {
                    arguments: args,
                  },
                },
              ],
            },
            finish_reason: null,
          },
        ],
      })

      writeSse(res, {
        id: "chatcmpl-tool-1",
        object: "chat.completion.chunk",
        created: 0,
        model: "model",
        choices: [
          {
            index: 0,
            delta: {},
            finish_reason: "tool_calls",
          },
        ],
      })
    } else {
      writeSse(res, {
        id: "chatcmpl-tool-2",
        object: "chat.completion.chunk",
        created: 0,
        model: "model",
        choices: [
          {
            index: 0,
            delta: {
              role: "assistant",
              content: "The environment value read was blocked.",
            },
            finish_reason: null,
          },
        ],
      })

      writeSse(res, {
        id: "chatcmpl-tool-2",
        object: "chat.completion.chunk",
        created: 0,
        model: "model",
        choices: [
          {
            index: 0,
            delta: {},
            finish_reason: "stop",
          },
        ],
      })
    }

    res.write("data: [DONE]\n\n")
    res.end()
  })

  const port = randomPort()
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject)
    server.listen(port, "127.0.0.1", () => resolve())
  })

  return {
    url: `http://127.0.0.1:${port}/v1`,
    requestCount: () => requestCount,
    close: async () => {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()))
      })
    },
  }
}

function writeSse(res: ServerResponseLike, payload: unknown) {
  res.write(`data: ${JSON.stringify(payload)}\n\n`)
}

type ServerResponseLike = Pick<import("node:http").ServerResponse, "write">

async function waitForToolPart(
  client: ReturnType<typeof createOpencodeClient>,
  sessionID: string,
  tool: string,
  timeoutMs = 5000,
) {
  const started = Date.now()

  while (Date.now() - started < timeoutMs) {
    const messages = await client.session.messages({
      path: { id: sessionID },
    })

    const part = messages.data
      .flatMap((message) => message.parts)
      .find((item) => item.type === "tool" && item.tool === tool)

    if (part) return part

    await new Promise((resolve) => setTimeout(resolve, 100))
  }

  return undefined
}

describe.skipIf(!hasOpencodeBinary)("OpenCode SDK integration", () => {
  let server: Awaited<ReturnType<typeof createOpencodeServer>> | undefined
  let cliDir: Awaited<ReturnType<typeof createTempProject>> | undefined
  let originalPath: string | undefined
  let modelServer: Awaited<ReturnType<typeof createMockOpenAICompatibleServer>> | undefined

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
    modelServer = await createMockOpenAICompatibleServer()

    server = await createOpencodeServer({
      port: randomPort(),
      timeout: 15000,
    })
  }, 20000)

  afterAll(async () => {
    server?.close()
    await modelServer?.close()
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

  test("blocks runtime env reads during a real prompted bash tool call", async () => {
    const project = await createTempProject("varlock-sdk-runtime-env")

    try {
      await project.write(
        "opencode.json",
        JSON.stringify({
          $schema: "https://opencode.ai/config.json",
          model: "mock/model",
          plugin: [pluginEntry],
          provider: {
            mock: {
              npm: "@ai-sdk/openai-compatible",
              env: [],
              models: {
                model: {
                  name: "Mock Model",
                  tool_call: true,
                  limit: { context: 4000, output: 1000 },
                },
              },
              options: {
                apiKey: "test-key",
                baseURL: modelServer!.url,
              },
            },
          },
        }),
      )
      await project.write(
        "varlock.config.json",
        JSON.stringify({
          env: { enabled: true },
          varlock: { enabled: false, autoDetect: false },
        }),
      )

      const client = createOpencodeClient({
        baseUrl: server!.url,
        directory: project.root,
      })

      const session = await client.session.create()
      await client.session.prompt({
        path: { id: session.data.id },
        body: {
          parts: [
            {
              type: "text",
              text: "Check the OLLAMA_MODELS environment variable and tell me where models are stored.",
            },
          ],
        },
      })

      const toolPart = await waitForToolPart(client, session.data.id, "bash")

      expect(toolPart).toBeDefined()
      expect(toolPart?.state.status).toBe("error")
      expect("error" in (toolPart?.state ?? {})).toBe(true)
      if (toolPart?.state.status === "error") {
        expect(toolPart.state.error).toContain("read environment variable values at runtime")
      }
      expect(modelServer!.requestCount()).toBeGreaterThanOrEqual(2)
    } finally {
      await project.dispose()
    }
  }, 20000)
})
