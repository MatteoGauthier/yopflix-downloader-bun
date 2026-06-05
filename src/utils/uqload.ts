import { fetchHtml } from "./http.ts"

const PACKED_EVAL_MARKER = "eval(function(p,a,c,k,e,d)"
const PACKED_SPLIT_MARKER = "'.split('|')))"

function deobfuscatePackedJs(html: string): string | null {
  const start = html.indexOf(PACKED_EVAL_MARKER)
  if (start < 0) return null

  const end = html.indexOf(PACKED_SPLIT_MARKER, start)
  if (end < 0) return null

  const chunk = html.slice(start, end + PACKED_SPLIT_MARKER.length)
  const inner = chunk.match(/\('([\s\S]*)',(\d+),(\d+),'([\s\S]*)'\.split/)
  if (!inner) return null

  const packed = inner[1]
  const radix = Number(inner[2])
  let counter = Number(inner[3])
  const dictionary = inner[4].split("|")

  let result = packed
  while (counter--) {
    const word = dictionary[counter]
    if (word) {
      result = result.replace(new RegExp(`\\b${counter.toString(radix)}\\b`, "g"), word)
    }
  }

  return result
}

function extractStreamUrl(deobfuscated: string): string | null {
  const m3u8 = deobfuscated.match(/https?:\/\/[^\s"'<>]+\.m3u8[^\s"'<>]*/i)
  if (m3u8?.[0]) return m3u8[0]

  const mp4 = deobfuscated.match(/https?:\/\/[^\s"'<>]+\.mp4[^\s"'<>]*/i)
  return mp4?.[0] ?? null
}

export function isUqloadEmbed(url: string): boolean {
  try {
    const u = new URL(url)
    return u.hostname.includes("uqload.") && (u.pathname.startsWith("/embed-") || u.pathname.match(/^\/[a-z0-9]+$/i) !== null)
  } catch {
    return false
  }
}

export async function resolveUqloadEmbed(url: string): Promise<string> {
  const html = await fetchHtml(url)
  const deobfuscated = deobfuscatePackedJs(html)
  if (!deobfuscated) {
    throw new Error(`Could not deobfuscate uqload embed page: ${url}`)
  }

  const streamUrl = extractStreamUrl(deobfuscated)
  if (!streamUrl) {
    throw new Error(`No stream source found in uqload embed: ${url}`)
  }

  return streamUrl
}
