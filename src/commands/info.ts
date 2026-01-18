// Info command handler

import type { Provider } from "../providers/index.ts"
import { parseArgs, ensureNumber } from "../utils/args.ts"

export async function cmdInfo(provider: Provider, argsv: string[]): Promise<void> {
  const args = parseArgs(argsv)
  const titleId = args.titleId as string | undefined
  const numericId = ensureNumber(args.titleId)

  // Allow both numeric IDs (yopflix) and path IDs (frenchstream)
  const id = numericId ?? titleId

  if (!id) {
    console.error("info: --titleId is required")
    process.exit(1)
  }

  const details = await provider.getDetails(id)

  console.log(
    JSON.stringify(
      {
        id: details.id,
        name: details.name,
        type: details.type,
        season_count: details.seasonCount,
        episode_count: details.episodeCount,
        video_count: details.episodes.length,
      },
      null,
      2
    )
  )
}
