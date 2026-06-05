// yt-dlp integration and download utilities

import path from "node:path"
import { mkdir, stat } from "node:fs/promises"
import { isUqloadEmbed as isUqloadEmbedUrl, resolveUqloadEmbed } from "./uqload.ts"
import { isVidzyEmbed, resolveVidzyEmbed } from "./vidzy.ts"

// Plugin directory (local to repo; override with YTDLP_PLUGIN_DIRS)
const REPO_PLUGIN_DIR = path.join(process.cwd(), "plugins", "xfileshare")

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

async function resolveFfmpegBinary(): Promise<string | null> {
  const override = process.env.FFMPEG_BIN
  if (override && override.length > 0) return override

  const fromEnvPath = process.env.PATH?.split(":") ?? []
  const candidates = [
    "ffmpeg",
    ...fromEnvPath.flatMap((dir) => [`${dir}/ffmpeg`]),
  ]
  return findExecutable(candidates)
}

function isHlsUrl(url: string): boolean {
  return /\.m3u8(?:\?|$)/i.test(url)
}

async function isMpegTsFile(filePath: string): Promise<boolean> {
  try {
    const file = Bun.file(filePath)
    const head = new Uint8Array(await file.slice(0, 1).arrayBuffer())
    return head[0] === 0x47
  } catch {
    return false
  }
}

async function remuxToMp4(inputFile: string): Promise<void> {
  const ffmpeg = await resolveFfmpegBinary()
  if (!ffmpeg) {
    throw new Error("Downloaded MPEG-TS stream but ffmpeg is unavailable for remux")
  }

  const tmpFile = `${inputFile}.remux.mp4`
  const proc = Bun.spawn(
    [ffmpeg, "-hide_banner", "-y", "-i", inputFile, "-c", "copy", "-movflags", "+faststart", tmpFile],
    { stdio: ["inherit", "inherit", "inherit"] }
  )
  const code = await proc.exited
  if (code !== 0) {
    throw new Error(`ffmpeg remux exited with code ${code}`)
  }

  await Bun.write(inputFile, Bun.file(tmpFile))
  await Bun.file(tmpFile).delete()
  console.log(`Remuxed MPEG-TS to MP4: ${inputFile}`)
}

export async function resolveYtDlpBinary(): Promise<string> {
  const override = process.env.YTDLP_BIN
  if (override && override.length > 0) return override

  const baseNames = ["yt-dlp", "yt-dlp_linux", "yt-dlp_linux_aarch64"]
  const fromEnvPath = process.env.PATH?.split(":") ?? []
  const misePaths = [
    `${process.env.HOME}/.local/share/mise/shims`,
    `${process.env.HOME}/.local/share/mise/installs/yt-dlp/latest`,
  ]
  const searchDirs = [...fromEnvPath, ...misePaths]
  const candidates = [
    ...baseNames,
    ...searchDirs.flatMap((dir) => baseNames.map((n) => `${dir}/${n}`)),
  ]
  const candidate = await findExecutable(candidates)
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

async function resolveDownloadUrl(url: string): Promise<string> {
  if (isUqloadEmbedUrl(url)) {
    const resolved = await resolveUqloadEmbed(url)
    console.log(`Resolved uqload embed -> ${resolved}`)
    return resolved
  }
  if (isVidzyEmbed(url)) {
    const resolved = await resolveVidzyEmbed(url)
    console.log(`Resolved vidzy embed -> ${resolved}`)
    return resolved
  }
  return url
}

export async function runYtDlp(url: string, outputFile: string, opts?: { noOverwrite?: boolean; noContinue?: boolean }): Promise<void> {
  const outDir = path.dirname(outputFile)
  await mkdir(outDir, { recursive: true })
  const bin = await resolveYtDlpBinary()
  const downloadUrl = await resolveDownloadUrl(url)
  const args = [
    bin,
    ...getPluginDirsFlag(),
    "-o",
    outputFile,
    "--merge-output-format",
    "mp4",
  ]

  if (isUqloadEmbedUrl(url) || downloadUrl.includes("uqload.")) {
    args.push("--add-header", "Referer:https://uqload.is/", "--add-header", "Origin:https://uqload.is")
  } else if (isVidzyEmbed(url) || downloadUrl.includes("vidzy.")) {
    args.push("--add-header", "Referer:https://vidzy.cc/", "--add-header", "Origin:https://vidzy.cc")
  }

  const ffmpeg = await resolveFfmpegBinary()
  if (ffmpeg) {
    args.push("--ffmpeg-location", ffmpeg)
  }
  if (isHlsUrl(downloadUrl)) {
    args.push("--downloader", "ffmpeg", "--hls-use-mpegts", "--remux-video", "mp4")
  }

  args.push(downloadUrl)
  if (opts?.noOverwrite) args.splice(3, 0, "--no-overwrites")
  if (opts?.noContinue) args.push("--no-continue")
  args.push("--no-part", "--restrict-filenames")

  const proc = Bun.spawn(args, { stdio: ["inherit", "inherit", "inherit"] })
  const code = await proc.exited
  if (code !== 0) {
    throw new Error(`${bin} exited with code ${code} for ${url}`)
  }

  if (await isMpegTsFile(outputFile)) {
    await remuxToMp4(outputFile)
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
