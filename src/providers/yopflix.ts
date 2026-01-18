// Yopflix provider implementation

import type { Provider } from "./base.ts"
import type { Title, TitleDetails, Episode, YopflixSearchResponse, YopflixTitleDetails, YopflixTitleVideo } from "../types.ts"
import { getJson } from "../utils/http.ts"
import { isUqloadEmbed, parseSeasonEpisode } from "../utils/download.ts"

export class YopflixProvider implements Provider {
  name = "yopflix"

  async search(query: string, limit = 20): Promise<Title[]> {
    const url = `https://yopflix.my/secure/search/${encodeURIComponent(query)}?limit=${encodeURIComponent(String(limit))}`
    const json = await getJson<YopflixSearchResponse>(url)
    if (json.status !== "success") throw new Error(`Search failed for query=${query}`)
    return (json.results ?? []).map((r) => ({
      id: r.id,
      name: r.name,
      year: r.year ?? undefined,
      type: r.is_series ? "series" : "movie",
    }))
  }

  async getDetails(titleId: string | number, titleName?: string): Promise<TitleDetails> {
    const qp = new URLSearchParams({ titleId: String(titleId) })
    if (titleName) qp.set("titleName", titleName)
    const url = `https://yopflix.my/secure/titles/${titleId}?${qp.toString()}`
    const details = await getJson<YopflixTitleDetails>(url)
    const episodes = this.extractEpisodes(details)
    return {
      id: details.title.id,
      name: details.title.name,
      type: details.title.is_series ? "series" : "movie",
      episodes,
      seasonCount: details.title.season_count,
      episodeCount: details.title.episode_count ?? episodes.length,
    }
  }

  async getEpisodes(titleId: string | number): Promise<Episode[]> {
    const details = await this.getDetails(titleId)
    return details.episodes
  }

  private extractEpisodes(details: YopflixTitleDetails): Episode[] {
    const t = details.title
    const direct = (details.videos ?? []) as YopflixTitleVideo[]
    const nested = (t?.videos ?? []) as YopflixTitleVideo[]
    const all = [...direct, ...nested]

    return all
      .filter((v) => typeof v.url === "string" && isUqloadEmbed(v.url))
      .map((v) => {
        const { season, episode } = parseSeasonEpisode(v.name ?? "")
        return {
          id: v.id,
          name: v.name,
          url: v.url,
          season,
          episode,
          language: v.language ?? undefined,
        }
      })
  }
}
