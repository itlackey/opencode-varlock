/**
 * Output scrubber - tool.execute.after hook that redacts secret values
 * from tool output before they reach the agent context.
 */

export type SecretRegistry = {
  /** Register a secret value that should be redacted from output */
  register(name: string, value: string): void
  /** Scrub all registered secret values from a string */
  scrub(text: string): string
  /** Get count of registered secrets */
  size(): number
}

export function createSecretRegistry(): SecretRegistry {
  const secrets = new Map<string, string>() // name -> value

  return {
    register(name: string, value: string) {
      if (value && value.length >= 3) { // don't scrub trivially short values
        secrets.set(name, value)
      }
    },

    scrub(text: string): string {
      let result = text
      for (const [name, value] of secrets) {
        // Only replace if the value is substantial enough to avoid false positives
        if (value.length >= 8) {
          result = result.replaceAll(value, `[REDACTED:${name}]`)
        } else if (value.length >= 3) {
          // For shorter values, only replace exact matches with word boundaries
          const escaped = value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
          result = result.replace(new RegExp(`\\b${escaped}\\b`, 'g'), `[REDACTED:${name}]`)
        }
      }
      return result
    },

    size() {
      return secrets.size
    },
  }
}
