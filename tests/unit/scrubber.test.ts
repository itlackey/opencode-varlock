import { describe, expect, test } from "vitest"
import { createSecretRegistry } from "../../src/scrubber.js"

describe("SecretRegistry", () => {
  test("registers and scrubs values >= 8 chars with replaceAll", () => {
    const registry = createSecretRegistry()
    registry.register("DB_PASSWORD", "super-secret-password")

    const result = registry.scrub("The password is super-secret-password in the config")
    expect(result).toBe("The password is [REDACTED:DB_PASSWORD] in the config")
    expect(result).not.toContain("super-secret-password")
  })

  test("registers and scrubs values 3-7 chars with word boundary matching", () => {
    const registry = createSecretRegistry()
    registry.register("TOKEN", "abc123")

    // Word boundary match: standalone occurrence is redacted
    const result = registry.scrub("token is abc123 here")
    expect(result).toBe("token is [REDACTED:TOKEN] here")
  })

  test("ignores values < 3 chars", () => {
    const registry = createSecretRegistry()
    registry.register("SHORT", "ab")

    expect(registry.size()).toBe(0)
    const result = registry.scrub("value ab should remain")
    expect(result).toBe("value ab should remain")
  })

  test("scrubs multiple registered secrets in one pass", () => {
    const registry = createSecretRegistry()
    registry.register("DB_URL", "postgres://user:pass@host/db")
    registry.register("API_KEY", "sk-1234567890abcdef")

    const text = "DB_URL=postgres://user:pass@host/db API_KEY=sk-1234567890abcdef"
    const result = registry.scrub(text)

    expect(result).not.toContain("postgres://user:pass@host/db")
    expect(result).not.toContain("sk-1234567890abcdef")
    expect(result).toContain("[REDACTED:DB_URL]")
    expect(result).toContain("[REDACTED:API_KEY]")
  })

  test("size() returns correct count", () => {
    const registry = createSecretRegistry()
    expect(registry.size()).toBe(0)

    registry.register("SECRET_A", "value-one")
    expect(registry.size()).toBe(1)

    registry.register("SECRET_B", "value-two")
    expect(registry.size()).toBe(2)

    // Registering with same name overwrites, not duplicates
    registry.register("SECRET_A", "new-value")
    expect(registry.size()).toBe(2)
  })

  test("scrub returns original text when no secrets registered", () => {
    const registry = createSecretRegistry()
    const text = "This is plain text with no secrets"
    expect(registry.scrub(text)).toBe(text)
  })
})
