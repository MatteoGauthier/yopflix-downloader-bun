// Argument parsing utilities

export function parseArgs(argv: string[]): Record<string, string | boolean> {
  const args: Record<string, string | boolean> = {}
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i]
    if (!token) continue
    if (!token.startsWith("--")) continue
    const key = token.slice(2)
    const next = argv[i + 1]
    if (!next || next.startsWith("--")) {
      args[key] = true
    } else {
      args[key] = next
      i += 1
    }
  }
  return args
}

export function getCommandAndArgv(): { command: string; argsv: string[] } {
  const argv = process.argv.slice(2)
  const firstNonFlag = argv.find((a) => !a.startsWith("--"))
  if (!firstNonFlag) return { command: "download", argsv: argv } // default
  // Treat the first non-flag as command, remove it from list
  const idx = argv.indexOf(firstNonFlag)
  const argsv = [...argv.slice(0, idx), ...argv.slice(idx + 1)]
  return { command: firstNonFlag, argsv }
}

export function ensureString(val: string | boolean | undefined, fallback: string): string {
  return typeof val === "string" && val.length > 0 ? val : fallback
}

export function ensureNumber(val: string | boolean | undefined): number | undefined {
  if (typeof val !== "string") return undefined
  const n = Number(val)
  return Number.isFinite(n) ? n : undefined
}

export function splitCsvNumbers(val: string | boolean | undefined): number[] | undefined {
  if (typeof val !== "string") return undefined
  return val
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .map((s) => Number(s))
    .filter((n) => Number.isFinite(n))
}
