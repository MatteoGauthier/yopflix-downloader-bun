// Provider interface for different streaming sources

import type { Title, TitleDetails, Episode } from "../types.ts"

export interface Provider {
  name: string
  search(query: string, limit?: number): Promise<Title[]>
  getDetails(titleId: string | number): Promise<TitleDetails>
  getEpisodes(titleId: string | number): Promise<Episode[]>
}
