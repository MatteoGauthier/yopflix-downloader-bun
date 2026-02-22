// French Stream (fs02.lol) provider implementation

import type { Provider } from "./base.ts"
import type { Title, TitleDetails, Episode } from "../types.ts"
import { fetchHtml, getJson, postForm } from "../utils/http.ts"

const BASE_URL = "https://fs02.lol"

// Preferred player order (first available wins)
const PLAYER_ORDER = ["uqload", "vidzy", "voe", "netu"] as const
type PlayerKey = (typeof PLAYER_ORDER)[number]

interface EpPlayerMap {
  uqload?: string
  vidzy?: string
  netu?: string
  voe?: string
}

interface EpDataResponse {
  vf?: Record<string, EpPlayerMap>
  vostfr?: Record<string, EpPlayerMap>
  vo?: Record<string, EpPlayerMap>
}

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
    const path = String(titleId)
    const url = path.startsWith("http") ? path : `${BASE_URL}${path}`
    const html = await fetchHtml(url)

    const newsId = this.extractNewsId(path)
    const seasonNumber = this.extractSeasonNumber(path)

    let episodes: Episode[] = []
    if (newsId) {
      episodes = await this.fetchEpisodes(newsId, seasonNumber, path)
    }

    return this.parseMediaPage(html, path, episodes)
  }

  async getEpisodes(titleId: string | number): Promise<Episode[]> {
    const path = String(titleId)
    const newsId = this.extractNewsId(path)
    if (!newsId) throw new Error(`Cannot extract news ID from path: ${path}`)

    const seasonNumber = this.extractSeasonNumber(path)
    return this.fetchEpisodes(newsId, seasonNumber, path)
  }

  private extractNewsId(path: string): string | null {
    // path like "/15108580-game-of-thrones-saison-1-..."
    const match = path.match(/(?:^|\/)(\d+)-/)
    return match?.[1] ?? null
  }

  private extractSeasonNumber(path: string): number {
    const match = path.match(/saison-(\d+)/i)
    return match ? Number(match[1]) : 1
  }

  private async fetchEpisodes(newsId: string, seasonNumber: number, refererPath: string): Promise<Episode[]> {
    const referer = `${BASE_URL}${refererPath.startsWith("/") ? refererPath : `/${refererPath}`}`
    const data = await getJson<EpDataResponse>(`${BASE_URL}/ep-data.php?id=${newsId}`, {
      referer,
    })

    const episodes: Episode[] = []
    const seen = new Set<string>()

    // Process each language track; VF overwrites VOSTFR for same episode
    for (const lang of ["vostfr", "vf"] as const) {
      const langData = data[lang]
      if (!langData) continue

      for (const [epNumStr, players] of Object.entries(langData)) {
        const epNum = Number(epNumStr)
        if (!Number.isFinite(epNum) || epNum <= 0) continue

        const url = this.pickPlayerUrl(players)
        if (!url) continue

        const key = `S${seasonNumber}E${epNum}`
        seen.add(key)
        const existing = episodes.findIndex((e) => e.season === seasonNumber && e.episode === epNum)
        const ep: Episode = {
          id: `${lang}-s${seasonNumber}e${epNum}`,
          name: `S${String(seasonNumber).padStart(2, "0")} E${String(epNum).padStart(2, "0")}`,
          season: seasonNumber,
          episode: epNum,
          url,
          language: lang,
        }

        if (existing >= 0) {
          episodes[existing] = ep // VF overwrites VOSTFR
        } else {
          episodes.push(ep)
        }
      }
    }

    episodes.sort((a, b) => (a.season ?? 0) - (b.season ?? 0) || (a.episode ?? 0) - (b.episode ?? 0))
    return episodes
  }

  private pickPlayerUrl(players: EpPlayerMap): string | null {
    for (const key of PLAYER_ORDER) {
      const url = players[key as PlayerKey]
      if (url && url.length > 0) return url
    }
    return null
  }

  private parseSearchResults(html: string): Title[] {
    const results: Title[] = []

    const itemRegex =
      /<div[^>]*class=['"]search-item['"][^>]*onclick="location\.href='([^']+)'"[^>]*>[\s\S]*?<div[^>]*class=['"]search-title['"][^>]*>([^<]+)<\/div>/gi

    let match
    while ((match = itemRegex.exec(html)) !== null) {
      const path = match[1]
      const rawTitle = match[2]
      if (!path || !rawTitle) continue

      const yearMatch = rawTitle.match(/\((\d{4})\)/)
      const year = yearMatch ? Number(yearMatch[1]) : undefined
      const name = rawTitle.replace(/\s*\(\d{4}\)\s*$/, "").trim()

      const type = rawTitle.toLowerCase().includes("saison") || path.includes("-saison-") ? "series" : "movie"

      results.push({ id: path, name, year, type })
    }

    return results
  }

  private parseMediaPage(html: string, path: string, episodes: Episode[]): TitleDetails {
    const titleMatch = html.match(/<h1[^>]*>([^<]+)<\/h1>/i) || html.match(/<title>[^<]*?([^<|]+)/i)
    let name =
      titleMatch?.[1]
        ?.trim()
        .replace(/série\s*/i, "")
        .replace(/\s*en streaming complet.*$/i, "")
        .trim() ?? "Unknown"

    const isSeries = path.includes("-saison-") || name.toLowerCase().includes("saison")
    const type = isSeries ? "series" : "movie"

    name = name.replace(/\s*-?\s*saison\s*\d+/i, "").trim()

    return {
      id: path,
      name,
      type,
      episodes,
      seasonCount: isSeries ? 1 : undefined,
      episodeCount: episodes.length,
    }
  }
}
