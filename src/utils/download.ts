// yt-dlp integration and download utilities

import path from "node:path"
import { mkdir, stat } from "node:fs/promises"

// Plugin directory (local to repo; override with YTDLP_PLUGIN_DIRS)
const REPO_PLUGIN_DIR = path.join(process.cwd(), "plugins")

function getPluginDirsFlag(): string[] {
  const fromEnv = process.env.YTDLP_PLUGIN_DIRS
  if (fromEnv && fromEnv.length > 0) {
    return ["--plugin-dirs", fromEnv]
  }
  return ["--plugin-dirs", REPO_PLUGIN_DIR]
}

async function findExecutable(names: string[]): Promise<string | null> {
  for (const name of names) {
    try {
      const proc = Bun.spawn([name, "--version"], { stdio: ["ignore", "pipe", "pipe"] })
      const code = await proc.exited
      if (code === 0) return name
    } catch {
      // ignore and continue
    }
  }
  return null
}

export async function resolveYtDlpBinary(): Promise<string> {
  const override = process.env.YTDLP_BIN
  if (override && override.length > 0) return override
  const candidate = await findExecutable(["yt-dlp", "yt-dlp_linux", "yt-dlp_linux_aarch64"])
  if (candidate) return candidate
  throw new Error("Could not find yt-dlp executable (tried: yt-dlp, yt-dlp_linux). Set YTDLP_BIN to override.")
}

export async function ensureDirForFile(filePath: string): Promise<void> {
  const dir = path.dirname(filePath)
  await mkdir(dir, { recursive: true })
}

export async function fileExists(filePath: string): Promise<boolean> {
  try {
    const s = await stat(filePath)
    return s.isFile() && s.size > 0
  } catch {
    return false
  }
}

export async function sleep(ms: number): Promise<void> {
  await new Promise((r) => setTimeout(r, ms))
}

export async function runYtDlp(url: string, outputFile: string, opts?: { noOverwrite?: boolean; noContinue?: boolean }): Promise<void> {
  const outDir = path.dirname(outputFile)
  await mkdir(outDir, { recursive: true })
  const bin = await resolveYtDlpBinary()
  const args = [
    bin,
    ...getPluginDirsFlag(),
    "-o",
    outputFile,
    "--merge-output-format",
    "mp4",
    url,
  ]
  if (opts?.noOverwrite) args.splice(3, 0, "--no-overwrites")
  if (opts?.noContinue) args.push("--no-continue")
  args.push("--no-part", "--restrict-filenames")

  const proc = Bun.spawn(args, { stdio: ["inherit", "inherit", "inherit"] })
  const code = await proc.exited
  if (code !== 0) {
    throw new Error(`${bin} exited with code ${code} for ${url}`)
  }
}

export async function downloadWithRetries(url: string, outputFile: string, attempts = 3): Promise<boolean> {
  const exists = await fileExists(outputFile)
  if (exists) {
    console.log(`Skipping existing file: ${outputFile}`)
    return true
  }

  let lastError: unknown
  for (let i = 0; i < attempts; i += 1) {
    try {
      await runYtDlp(url, outputFile, { noOverwrite: true, noContinue: true })
      return true
    } catch (err) {
      lastError = err
      const delayMs = 5000 * Math.pow(2, i)
      console.warn(`Download failed (attempt ${i + 1}/${attempts}): ${err instanceof Error ? err.message : String(err)}. Retrying in ${Math.round(delayMs / 1000)}s...`)
      await sleep(delayMs)
    }
  }
  console.error(`Giving up after ${attempts} attempts for ${url}: ${lastError instanceof Error ? lastError.message : String(lastError)}`)
  return false
}

// Jellyfin friendly paths
export function buildOutputPath(baseDir: string, show: string, season?: number, episode?: number, ext = "mp4"): string {
  const safeShow = show.replace(/[\\/:*?"<>|]/g, "-").trim()
  if (season && episode) {
    const seasonDir = path.join(baseDir, `${safeShow}`, `Season ${String(season).padStart(2, "0")}`)
    const filename = `${safeShow} - S${String(season).padStart(2, "0")}E${String(episode).padStart(2, "0")}.${ext}`
    return path.join(seasonDir, filename)
  }
  const filename = `${safeShow}.${ext}`
  return path.join(baseDir, safeShow, filename)
}

export function isUqloadEmbed(url: string): boolean {
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

// Parse names like "S01 E01" → { season: 1, episode: 1 }
export function parseSeasonEpisode(name: string): { season?: number; episode?: number } {
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
