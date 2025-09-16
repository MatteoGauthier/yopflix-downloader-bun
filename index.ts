#!/usr/bin/env bun

// Yopflix downloader using Bun + TypeScript (2025)
// - Searches Yopflix titles
// - Fetches title details to extract uqload embed links
// - Invokes yt-dlp to download videos
// - Outputs Jellyfin-friendly filenames

import path from "node:path"
import { mkdir } from "node:fs/promises"

/**
 * Subcommands
 *   search   --query psych [--limit 20]
 *   info     --titleId 3235 [--titleName psych-enqueteur-malgre-lui]
 *   list     --titleId 3235
 *   download --titleId 3235 [--season 1] [--episode 1,2] [--max 3] [--outDir ./downloads]
 *
 * Default (no subcommand): behaves like "download" (for backward compatibility)
 */

// Plugin directory (local to repo; override with YTDLP_PLUGIN_DIRS)
const REPO_PLUGIN_DIR = path.join(process.cwd(), "plugins")
function getPluginDirsFlag(): string[] {
	const fromEnv = process.env.YTDLP_PLUGIN_DIRS
	if (fromEnv && fromEnv.length > 0) {
		return ["--plugin-dirs", fromEnv]
	}
	return ["--plugin-dirs", REPO_PLUGIN_DIR]
}

// Types for remote API
interface SearchResultTitle {
  id: number
  name: string
  type: string
  year?: number | null
  is_series?: boolean
  model_type?: string
}

interface SearchResponse {
  results: SearchResultTitle[]
  query: string
  status: string
}

interface TitleVideo {
  id: number
  name: string // often like "S01 E01"
  url: string // uqload embed URL
  type: string // "embed"
  language?: string | null
  category?: string | null
}

interface TitleDetails {
  title: {
    id: number
    name: string
    is_series: boolean
    season_count?: number
    episode_count?: number
    language?: string
  }
  status: string
}

interface TitleDetailsWithVideos extends TitleDetails {
  videos?: TitleVideo[]
  [key: string]: unknown
}

// Utility: tiny arg parser (no deps)
function parseArgs(argv: string[]): Record<string, string | boolean> {
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

function getCommandAndArgv(): { command: string; argsv: string[] } {
  const argv = process.argv.slice(2)
  const firstNonFlag = argv.find((a) => !a.startsWith("--"))
  if (!firstNonFlag) return { command: "download", argsv: argv } // default
  // Treat the first non-flag as command, remove it from list
  const idx = argv.indexOf(firstNonFlag)
  const argsv = [...argv.slice(0, idx), ...argv.slice(idx + 1)]
  return { command: firstNonFlag, argsv }
}

function ensureString(val: string | boolean | undefined, fallback: string): string {
  return typeof val === "string" && val.length > 0 ? val : fallback
}

function ensureNumber(val: string | boolean | undefined): number | undefined {
  if (typeof val !== "string") return undefined
  const n = Number(val)
  return Number.isFinite(n) ? n : undefined
}

function splitCsvNumbers(val: string | boolean | undefined): number[] | undefined {
  if (typeof val !== "string") return undefined
  return val
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .map((s) => Number(s))
    .filter((n) => Number.isFinite(n))
}

// HTTP helpers
async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url, {
    headers: {
      accept: "application/json, text/plain, */*",
    },
  })
  if (!res.ok) {
    const body = await res.text().catch(() => "")
    throw new Error(`HTTP ${res.status} for ${url}: ${body?.slice(0, 200)}`)
  }
  return (await res.json()) as T
}

// Parse names like "S01 E01" → { season: 1, episode: 1 }
function parseSeasonEpisode(name: string): { season?: number; episode?: number } {
  const match = name.match(/S(\d{1,2})\s*E(\d{1,3})/i)
  if (match) {
    const season = Number(match[1])
    const episode = Number(match[2])
    if (Number.isFinite(season) && Number.isFinite(episode)) {
      return { season, episode }
    }
  }
  return {}
}

// Jellyfin friendly paths
function buildOutputPath(baseDir: string, show: string, season?: number, episode?: number, ext = "mp4"): string {
  const safeShow = show.replace(/[\\/:*?"<>|]/g, "-").trim()
  if (season && episode) {
    const seasonDir = path.join(baseDir, `${safeShow}`, `Season ${String(season).padStart(2, "0")}`)
    const filename = `${safeShow} - S${String(season).padStart(2, "0")}E${String(episode).padStart(2, "0")}.${ext}`
    return path.join(seasonDir, filename)
  }
  const filename = `${safeShow}.${ext}`
  return path.join(baseDir, safeShow, filename)
}

function isUqloadEmbed(url: string): boolean {
  try {
    const u = new URL(url)
    return (
      (u.hostname.includes("uqload.") || u.hostname === "uqload.cx" || u.hostname === "uqload.net") &&
      u.pathname.startsWith("/embed-")
    )
  } catch {
    return false
  }
}

async function searchTitles(query: string, limit: number): Promise<SearchResultTitle[]> {
  const url = `https://yopflix.my/secure/search/${encodeURIComponent(query)}?limit=${encodeURIComponent(String(limit))}`
  const json = await getJson<SearchResponse>(url)
  if (json.status !== "success") throw new Error(`Search failed for query=${query}`)
  return json.results ?? []
}

async function fetchTitleDetails(titleId: number, titleName?: string): Promise<TitleDetailsWithVideos> {
  const qp = new URLSearchParams({ titleId: String(titleId) })
  if (titleName) qp.set("titleName", titleName)
  const url = `https://yopflix.my/secure/titles/${titleId}?${qp.toString()}`
  return await getJson<TitleDetailsWithVideos>(url)
}

function extractVideos(details: TitleDetailsWithVideos): TitleVideo[] {
  const t = details.title as unknown as { videos?: TitleVideo[] } | undefined
  const direct = (details.videos ?? []) as TitleVideo[]
  const nested = (t?.videos ?? []) as TitleVideo[]
  const all = [...direct, ...nested]
  return all.filter((v) => typeof v.url === "string" && isUqloadEmbed(v.url))
}

function filterVideos(
  videos: TitleVideo[],
  opts: { season?: number; episodes?: number[] }
): Array<TitleVideo & { season?: number; episode?: number }> {
  const withNums = videos.map((v) => ({ ...v, ...parseSeasonEpisode(v.name ?? "") }))
  let filtered = withNums
  if (opts.season) filtered = filtered.filter((v) => v.season === opts.season)
  if (opts.episodes && opts.episodes.length > 0) {
    const set = new Set(opts.episodes)
    filtered = filtered.filter((v) => (v.episode ? set.has(v.episode) : false))
  }
  return filtered
}

async function ensureDirForFile(filePath: string): Promise<void> {
  const dir = path.dirname(filePath)
  await mkdir(dir, { recursive: true })
}

async function runYtDlp(url: string, outputFile: string): Promise<void> {
  const outDir = path.dirname(outputFile)
  await mkdir(outDir, { recursive: true })
  const proc = Bun.spawn(
    [
      "yt-dlp",
      ...getPluginDirsFlag(),
      "-o",
      outputFile,
      "--no-part",
      "--restrict-filenames",
      "--merge-output-format",
      "mp4",
      url,
    ],
    { stdio: ["inherit", "inherit", "inherit"] }
  )
  const code = await proc.exited
  if (code !== 0) {
    throw new Error(`yt-dlp exited with code ${code} for ${url}`)
  }
}

// Subcommand implementations
async function cmdSearch(argsv: string[]) {
  const args = parseArgs(argsv)
  const query = args.query as string | undefined
  const limit = ensureNumber(args.limit) ?? 20
  if (!query) {
    console.error("search: --query is required")
    process.exit(1)
  }
  const results = await searchTitles(query, limit)
  if (results.length === 0) {
    console.log("No results.")
    return
  }
  for (const r of results) {
    console.log(`${r.id}\t${r.name}${r.year ? ` (${r.year})` : ""}${r.is_series ? " [series]" : ""}`)
  }
}

async function cmdInfo(argsv: string[]) {
  const args = parseArgs(argsv)
  const titleId = ensureNumber(args.titleId)
  const titleName = typeof args.titleName === "string" ? args.titleName : undefined
  if (!titleId) {
    console.error("info: --titleId is required")
    process.exit(1)
  }
  const details = await fetchTitleDetails(titleId, titleName)
  const videos = extractVideos(details)
  console.log(
    JSON.stringify(
      {
        id: details.title.id,
        name: details.title.name,
        is_series: details.title.is_series,
        season_count: (details.title as any).season_count ?? undefined,
        episode_count: (details.title as any).episode_count ?? videos.length,
        video_count: videos.length,
      },
      null,
      2
    )
  )
}

async function cmdList(argsv: string[]) {
  const args = parseArgs(argsv)
  const titleId = ensureNumber(args.titleId)
  const titleName = typeof args.titleName === "string" ? args.titleName : undefined
  if (!titleId) {
    console.error("list: --titleId is required")
    process.exit(1)
  }
  const details = await fetchTitleDetails(titleId, titleName)
  const videos = extractVideos(details).map((v) => ({ ...v, ...parseSeasonEpisode(v.name) }))
  videos.sort((a, b) => (a.season ?? 0) - (b.season ?? 0) || (a.episode ?? 0) - (b.episode ?? 0))
  for (const v of videos) {
    const se =
      v.season && v.episode ? `S${String(v.season).padStart(2, "0")}E${String(v.episode).padStart(2, "0")}` : v.name
    console.log(`${se}\t${v.url}`)
  }
}

async function cmdDownload(argsv: string[]) {
  const args = parseArgs(argsv)
  const query = args.query as string | undefined
  const titleId = ensureNumber(args.titleId)
  const titleName = typeof args.titleName === "string" ? args.titleName : undefined
  const limit = ensureNumber(args.limit) ?? 20
  const onlySeason = ensureNumber(args.season)
  const onlyEpisodes = splitCsvNumbers(args.episode)
  const maxDownloads = ensureNumber(args.max)
  const outDir = ensureString(args.outDir as string | boolean | undefined, path.join(process.cwd(), "downloads"))

  let chosenTitleId: number | undefined = titleId
  let chosenTitleName: string | undefined = titleName
  let showName: string | undefined

  if (!chosenTitleId) {
    if (!query) {
      console.error("download: provide --query or --titleId")
      process.exit(1)
    }
    const results = await searchTitles(query, limit)
    if (results.length === 0) {
      console.error(`No results for query: ${query}`)
      process.exit(1)
    }
    const preferred = results.find((r) => r.is_series === true || r.model_type === "title") ?? results[0]
    if (!preferred) {
      console.error("No suitable results returned by API.")
      process.exit(1)
    }
    chosenTitleId = preferred.id
    chosenTitleName = undefined
    showName = preferred.name
    console.log(`Using result: ${preferred.name} (id=${preferred.id})`)
  }

  const details = await fetchTitleDetails(chosenTitleId!, chosenTitleName)
  showName = showName ?? details.title.name
  const videos = extractVideos(details)
  if (videos.length === 0) {
    console.error("No uqload embed videos found for title.")
    process.exit(1)
  }

  let filtered = filterVideos(videos, { season: onlySeason, episodes: onlyEpisodes })
  if (filtered.length === 0) filtered = videos.map((v) => ({ ...v, ...parseSeasonEpisode(v.name) }))
  if (typeof maxDownloads === "number") filtered = filtered.slice(0, maxDownloads)

  console.log(`Queued ${filtered.length} video(s) from ${showName}`)

  for (const v of filtered) {
    const episodeExt = "mp4"
    const outputPath = buildOutputPath(outDir, showName!, v.season, v.episode, episodeExt)
    await ensureDirForFile(outputPath)
    console.log(`Downloading: ${v.name} -> ${outputPath}`)
    await runYtDlp(v.url, outputPath)
  }

  console.log("All downloads completed.")
}

function printHelp() {
  console.log(
    [
      "Usage:",
      "  bun run index.ts <command> [options]",
      "",
      "Commands:",
      "  search   --query <text> [--limit 20]",
      "  info     --titleId <id> [--titleName <slug>]",
      "  list     --titleId <id>",
      "  download [--titleId <id> | --query <text>] [--season N] [--episode 1,2] [--max N] [--outDir DIR]",
      "",
      "If no command is provided, 'download' is assumed.",
    ].join("\n")
  )
}

async function main() {
  const { command, argsv } = getCommandAndArgv()
  try {
    switch (command) {
      case "search":
        await cmdSearch(argsv)
        break
      case "info":
        await cmdInfo(argsv)
        break
      case "list":
        await cmdList(argsv)
        break
      case "download":
        await cmdDownload(argsv)
        break
      case "help":
        printHelp()
        break
      default:
        if (command.startsWith("--")) {
          await cmdDownload([command, ...argsv])
        } else {
          console.error(`Unknown command: ${command}`)
          printHelp()
          process.exit(1)
        }
    }
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err))
    process.exit(1)
  }
}

main()
