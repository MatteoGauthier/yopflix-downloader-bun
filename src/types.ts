// Shared type definitions for all providers

export interface Episode {
  id: string | number
  name: string
  season?: number
  episode?: number
  url: string // The download/embed URL
  language?: string // 'vf', 'vostfr', etc.
}

export interface Title {
  id: string | number
  name: string
  year?: number
  type: "movie" | "series"
  posterUrl?: string
}

export interface TitleDetails extends Title {
  episodes: Episode[]
  seasonCount?: number
  episodeCount?: number
}

// Yopflix-specific API types
export interface YopflixSearchResultTitle {
  id: number
  name: string
  type: string
  year?: number | null
  is_series?: boolean
  model_type?: string
}

export interface YopflixSearchResponse {
  results: YopflixSearchResultTitle[]
  query: string
  status: string
}

export interface YopflixTitleVideo {
  id: number
  name: string // often like "S01 E01"
  url: string // uqload embed URL
  type: string // "embed"
  language?: string | null
  category?: string | null
}

export interface YopflixTitleDetails {
  title: {
    id: number
    name: string
    is_series: boolean
    season_count?: number
    episode_count?: number
    language?: string
    videos?: YopflixTitleVideo[]
  }
  status: string
  videos?: YopflixTitleVideo[]
  [key: string]: unknown
}
