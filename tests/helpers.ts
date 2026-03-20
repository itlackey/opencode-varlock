import { chmod, mkdtemp, mkdir, writeFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"

export async function createTempProject(prefix: string) {
  const root = await mkdtemp(join(tmpdir(), `${prefix}-`))

  return {
    root,
    path(...parts: string[]) {
      return join(root, ...parts)
    },
    async write(relativePath: string, content: string) {
      const fullPath = join(root, relativePath)
      await mkdir(dirname(fullPath), { recursive: true })
      await writeFile(fullPath, content)
      return fullPath
    },
    async writeExecutable(relativePath: string, content: string) {
      const fullPath = await this.write(relativePath, content)
      await chmod(fullPath, 0o755)
      return fullPath
    },
    async mkdir(relativePath: string) {
      await mkdir(join(root, relativePath), { recursive: true })
    },
    async dispose() {
      await rm(root, { recursive: true, force: true })
    },
  }
}

export function withEnv<T>(updates: Record<string, string | undefined>, fn: () => Promise<T> | T) {
  const previous = new Map<string, string | undefined>()
  for (const [key, value] of Object.entries(updates)) {
    previous.set(key, process.env[key])
    if (value === undefined) {
      delete process.env[key]
    } else {
      process.env[key] = value
    }
  }

  return Promise.resolve()
    .then(fn)
    .finally(() => {
      for (const [key, value] of previous.entries()) {
        if (value === undefined) {
          delete process.env[key]
        } else {
          process.env[key] = value
        }
      }
    })
}
