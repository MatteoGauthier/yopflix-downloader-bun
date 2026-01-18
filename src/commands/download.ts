// Download command handler

import path from "node:path"
import type { Provider } from "../providers/index.ts"
import type { Episode } from "../types.ts"
import { parseArgs, ensureString, ensureNumber, splitCsvNumbers } from "../utils/args.ts"
import { downloadWithRetries, buildOutputPath, ensureDirForFile } from "../utils/download.ts"

export async function cmdDownload(provider: Provider, argsv: string[]): Promise<void> {
  const args = parseArgs(argsv)
  const query = args.query as string | undefined
  const titleId = args.titleId as string | undefined
  const numericId = ensureNumber(args.titleId)
  const limit = ensureNumber(args.limit) ?? 20
  const onlySeason = ensureNumber(args.season)
  const onlyEpisodes = splitCsvNumbers(args.episode)
  const maxDownloads = ensureNumber(args.max)
  const outDir = ensureString(args.outDir as string | boolean | undefined, path.join(process.cwd(), "downloads"))

  let resolvedId: string | number | undefined = numericId ?? titleId
  let showName: string | undefined

  // If no titleId, search for it
  if (!resolvedId) {
    if (!query) {
      console.error("download: provide --query or --titleId")
      process.exit(1)
    }
    const results = await provider.search(query, limit)
    if (results.length === 0) {
      console.error(`No results for query: ${query}`)
      process.exit(1)
    }
    // Prefer series if available
    const preferred = results.find((r) => r.type === "series") ?? results[0]
    if (!preferred) {
      console.error("No suitable results returned by API.")
      process.exit(1)
    }
    resolvedId = preferred.id
    showName = preferred.name
    console.log(`Using result: ${preferred.name} (id=${preferred.id})`)
  }

  // Get title details
  const details = await provider.getDetails(resolvedId)
  showName = showName ?? details.name
  const episodes = details.episodes

  if (episodes.length === 0) {
    console.error("No downloadable episodes found for title.")
    process.exit(1)
  }

  // Filter episodes
  let filtered = filterEpisodes(episodes, { season: onlySeason, episodes: onlyEpisodes })
  if (filtered.length === 0) filtered = episodes
  if (typeof maxDownloads === "number") filtered = filtered.slice(0, maxDownloads)

  console.log(`Queued ${filtered.length} video(s) from ${showName}`)

  const failures: Array<{ name: string; url: string; error: string }> = []

  for (const ep of filtered) {
    const outputPath = buildOutputPath(outDir, showName!, ep.season, ep.episode, "mp4")
    await ensureDirForFile(outputPath)
    console.log(`Downloading: ${ep.name} -> ${outputPath}`)
    const ok = await downloadWithRetries(ep.url, outputPath, 3)
    if (!ok) {
      failures.push({ name: ep.name, url: ep.url, error: "download failed after retries" })
    }
  }

  if (failures.length > 0) {
    console.warn(`Completed with ${failures.length} failure(s):`)
    for (const f of failures) console.warn(`- ${f.name} :: ${f.url} :: ${f.error}`)
  } else {
    console.log("All downloads completed.")
  }
}

function filterEpisodes(
  episodes: Episode[],
  opts: { season?: number; episodes?: number[] }
): Episode[] {
  let filtered = episodes

  if (opts.season) {
    filtered = filtered.filter((ep) => ep.season === opts.season)
  }

  if (opts.episodes && opts.episodes.length > 0) {
    const set = new Set(opts.episodes)
    filtered = filtered.filter((ep) => ep.episode !== undefined && set.has(ep.episode))
  }

  return filtered
}
