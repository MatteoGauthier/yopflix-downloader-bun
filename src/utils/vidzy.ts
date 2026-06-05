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

function extractM3u8Url(deobfuscated: string): string | null {
  const match = deobfuscated.match(/https?:\/\/[^\s"'<>]+\.m3u8[^\s"'<>]*/i)
  return match?.[0] ?? null
}

export function isVidzyEmbed(url: string): boolean {
  try {
    const u = new URL(url)
    return u.hostname.includes("vidzy.") && u.pathname.startsWith("/embed-")
  } catch {
    return false
  }
}

export async function resolveVidzyEmbed(url: string): Promise<string> {
  const html = await fetchHtml(url)
  const deobfuscated = deobfuscatePackedJs(html)
  if (!deobfuscated) {
    throw new Error(`Could not deobfuscate vidzy embed page: ${url}`)
  }

  const m3u8 = extractM3u8Url(deobfuscated)
  if (!m3u8) {
    throw new Error(`No m3u8 source found in vidzy embed: ${url}`)
  }

  return m3u8
}
