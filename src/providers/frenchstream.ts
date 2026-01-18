// French Stream (fs02.lol) provider implementation

import type { Provider } from "./base.ts"
import type { Title, TitleDetails, Episode } from "../types.ts"
import { fetchHtml, postForm } from "../utils/http.ts"

const BASE_URL = "https://fs02.lol"

export class FrenchStreamProvider implements Provider {
  name = "frenchstream"

  async search(query: string, limit = 20): Promise<Title[]> {
    const html = await postForm(`${BASE_URL}/engine/ajax/search.php`, {
      query,
      page: "1",
    })
    return this.parseSearchResults(html).slice(0, limit)
  }

  async getDetails(titleId: string | number): Promise<TitleDetails> {
    // titleId is the path like "/s-tv/15123579-loups-garous-saison-2-2024.html"
    const path = String(titleId)
    const url = path.startsWith("http") ? path : `${BASE_URL}${path}`
    const html = await fetchHtml(url)
    return this.parseMediaPage(html, path)
  }

  async getEpisodes(titleId: string | number): Promise<Episode[]> {
    const details = await this.getDetails(titleId)
    return details.episodes
  }

  private parseSearchResults(html: string): Title[] {
    const results: Title[] = []

    // Parse HTML search results
    // Format: <div class='search-item' onclick="location.href='/15123579-...'">
    //         <div class='search-title'>Title Name (Year)</div>
    const itemRegex = /<div[^>]*class=['"]search-item['"][^>]*onclick="location\.href='([^']+)'"[^>]*>[\s\S]*?<div[^>]*class=['"]search-title['"][^>]*>([^<]+)<\/div>/gi

    let match
    while ((match = itemRegex.exec(html)) !== null) {
      const path = match[1]
      const rawTitle = match[2]
      if (!path || !rawTitle) continue

      // Extract year from title like "Title Name (2024)"
      const yearMatch = rawTitle.match(/\((\d{4})\)/)
      const year = yearMatch ? Number(yearMatch[1]) : undefined
      const name = rawTitle.replace(/\s*\(\d{4}\)\s*$/, "").trim()

      // Determine type: "Saison" in name suggests series
      const type = rawTitle.toLowerCase().includes("saison") || path.includes("-saison-") ? "series" : "movie"

      results.push({
        id: path,
        name,
        year,
        type,
      })
    }

    return results
  }

  private parseMediaPage(html: string, path: string): TitleDetails {
    // Extract title from page
    const titleMatch = html.match(/<h1[^>]*>([^<]+)<\/h1>/i) ||
                       html.match(/<title>[^<]*?([^<|]+)/i)
    let name = titleMatch?.[1]?.trim().replace(/série\s*/i, "").replace(/\s*en streaming complet.*$/i, "").trim() ?? "Unknown"

    // Determine type
    const isSeries = path.includes("-saison-") || name.toLowerCase().includes("saison")
    const type = isSeries ? "series" : "movie"

    // Extract season number from path or name (e.g., "saison-2" or "Saison 2")
    const seasonFromPath = path.match(/saison-(\d+)/i)
    const seasonFromName = name.match(/saison\s*(\d+)/i)
    const seasonNumber = seasonFromPath ? Number(seasonFromPath[1]) : seasonFromName ? Number(seasonFromName[1]) : 1

    // Parse episodes from hidden divs with the season number
    const episodes = this.parseEpisodes(html, seasonNumber)

    // Clean up name (remove season info for cleaner display)
    name = name.replace(/\s*-?\s*saison\s*\d+/i, "").trim()

    return {
      id: path,
      name,
      type,
      episodes,
      seasonCount: isSeries ? 1 : undefined, // This page represents one season
      episodeCount: episodes.length,
    }
  }

  private parseEpisodes(html: string, seasonNumber: number): Episode[] {
    const episodes: Episode[] = []

    // Parse VF episodes first (preferred)
    const vfEpisodes = this.parseEpisodeBlock(html, "vf", seasonNumber)
    // Parse VOSTFR episodes as fallback
    const vostfrEpisodes = this.parseEpisodeBlock(html, "vostfr", seasonNumber)

    // Create a map to merge - VF takes priority
    const episodeMap = new Map<string, Episode>()

    // Add VOSTFR first (will be overwritten by VF if available)
    for (const ep of vostfrEpisodes) {
      const key = `S${ep.season ?? 0}E${ep.episode ?? 0}`
      episodeMap.set(key, ep)
    }

    // Add VF (overwrites VOSTFR)
    for (const ep of vfEpisodes) {
      const key = `S${ep.season ?? 0}E${ep.episode ?? 0}`
      episodeMap.set(key, ep)
    }

    // Convert to array and sort
    episodes.push(...episodeMap.values())
    episodes.sort((a, b) =>
      (a.season ?? 0) - (b.season ?? 0) ||
      (a.episode ?? 0) - (b.episode ?? 0)
    )

    return episodes
  }

  private parseEpisodeBlock(html: string, language: "vf" | "vostfr", seasonNumber: number): Episode[] {
    const episodes: Episode[] = []

    // Look for #episodes-vf-data or #episodes-vostfr-data div
    const blockId = `episodes-${language}-data`
    // Match until the closing </div> of this container
    const blockRegex = new RegExp(`id="${blockId}"[^>]*>([\\s\\S]*?)</div>\\s*(?:<div id=|$)`, "i")
    const blockMatch = html.match(blockRegex)

    if (!blockMatch) {
      return episodes
    }

    const blockContent = blockMatch[1] ?? ""

    // Parse individual episode divs within the block
    // Pattern: <div data-ep="1" data-vidzy="..." data-uqload="..." data-netu="..." data-voe="...">
    const episodeRegex = /<div\s+data-ep="(\d+)"\s+([^>]*)>/gi

    let match
    while ((match = episodeRegex.exec(blockContent)) !== null) {
      const epNum = match[1]
      const attrs = match[2] ?? ""
      if (!epNum || epNum === "0") continue // Skip episode 0 (placeholder)

      // Extract uqload URL (preferred)
      const uqloadMatch = attrs.match(/data-uqload="([^"]+)"/)
      const uqloadUrl = uqloadMatch?.[1]
      if (!uqloadUrl || uqloadUrl.length === 0) continue

      const url = this.normalizeUqloadUrl(uqloadUrl)
      if (!url) continue

      episodes.push({
        id: `${language}-s${seasonNumber}e${epNum}`,
        name: `S${String(seasonNumber).padStart(2, "0")} E${String(epNum).padStart(2, "0")}`,
        season: seasonNumber,
        episode: Number(epNum),
        url,
        language,
      })
    }

    return episodes
  }

  private normalizeUqloadUrl(url: string): string | null {
    if (!url) return null

    // Handle various URL formats
    // Could be: "xxx" (just the ID), "embed-xxx.html", "https://uqload.bz/embed-xxx.html"
    let normalized = url.trim()

    if (!normalized.includes("://")) {
      // If it's just an ID or partial path
      if (normalized.startsWith("embed-")) {
        normalized = `https://uqload.bz/${normalized}`
      } else if (/^[a-zA-Z0-9]+\.html$/.test(normalized)) {
        normalized = `https://uqload.bz/embed-${normalized}`
      } else if (/^[a-zA-Z0-9]+$/.test(normalized)) {
        normalized = `https://uqload.bz/embed-${normalized}.html`
      } else {
        return null
      }
    }

    // Validate it's a uqload URL
    try {
      const u = new URL(normalized)
      if (u.hostname.includes("uqload") && u.pathname.includes("embed")) {
        return normalized
      }
    } catch {
      return null
    }

    return null
  }
}
