// Search command handler

import type { Provider } from "../providers/index.ts"
import { parseArgs, ensureNumber } from "../utils/args.ts"

export async function cmdSearch(provider: Provider, argsv: string[]): Promise<void> {
  const args = parseArgs(argsv)
  const query = args.query as string | undefined
  const limit = ensureNumber(args.limit) ?? 20

  if (!query) {
    console.error("search: --query is required")
    process.exit(1)
  }

  const results = await provider.search(query, limit)

  if (results.length === 0) {
    console.log("No results.")
    return
  }

  for (const r of results) {
    const year = r.year ? ` (${r.year})` : ""
    const type = r.type === "series" ? " [series]" : ""
    console.log(`${r.id}\t${r.name}${year}${type}`)
  }
}
