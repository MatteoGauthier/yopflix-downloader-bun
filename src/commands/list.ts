// List command handler

import type { Provider } from "../providers/index.ts"
import { parseArgs, ensureNumber } from "../utils/args.ts"

export async function cmdList(provider: Provider, argsv: string[]): Promise<void> {
  const args = parseArgs(argsv)
  const titleId = args.titleId as string | undefined
  const numericId = ensureNumber(args.titleId)

  // Allow both numeric IDs (yopflix) and path IDs (frenchstream)
  const id = numericId ?? titleId

  if (!id) {
    console.error("list: --titleId is required")
    process.exit(1)
  }

  const episodes = await provider.getEpisodes(id)

  // Sort by season and episode
  episodes.sort((a, b) =>
    (a.season ?? 0) - (b.season ?? 0) ||
    (a.episode ?? 0) - (b.episode ?? 0)
  )

  for (const ep of episodes) {
    const se = ep.season && ep.episode
      ? `S${String(ep.season).padStart(2, "0")}E${String(ep.episode).padStart(2, "0")}`
      : ep.name
    const lang = ep.language ? ` [${ep.language}]` : ""
    console.log(`${se}${lang}\t${ep.url}`)
  }
}
