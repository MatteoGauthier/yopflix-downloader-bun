#!/usr/bin/env bun

// Multi-provider downloader using Bun + TypeScript
// Supports: Yopflix, French Stream (fs02.lol)
//
// Usage:
//   bun run index.ts <command> [--provider <name>] [options]
//
// Providers:
//   yopflix (default), frenchstream (alias: fs)
//
// Commands:
//   search   --query <text> [--limit 20]
//   info     --titleId <id>
//   list     --titleId <id>
//   download [--titleId <id> | --query <text>] [--season N] [--episode 1,2] [--max N] [--outDir DIR]
//   help     Show this help message

import { getCommandAndArgv, parseArgs } from "./utils/args.ts"
import { getProvider, listProviders } from "./providers/index.ts"
import { cmdSearch } from "./commands/search.ts"
import { cmdInfo } from "./commands/info.ts"
import { cmdList } from "./commands/list.ts"
import { cmdDownload } from "./commands/download.ts"

function printHelp() {
  const providerList = listProviders().join(", ")
  console.log(
    [
      "Usage:",
      "  bun run index.ts <command> [--provider <name>] [options]",
      "",
      `Available providers: ${providerList}`,
      "",
      "Commands:",
      "  search   --query <text> [--limit 20]",
      "  info     --titleId <id>",
      "  list     --titleId <id>",
      "  download [--titleId <id> | --query <text>] [--season N] [--episode 1,2] [--max N] [--outDir DIR]",
      "",
      "Examples:",
      "  # Search with default provider (yopflix)",
      "  bun run index.ts search --query psych",
      "",
      "  # Search with French Stream provider",
      "  bun run index.ts search --provider frenchstream --query \"loups garous\"",
      "",
      "  # List episodes from French Stream (using path-based ID)",
      "  bun run index.ts list --provider fs --titleId \"/s-tv/15123579-loups-garous-saison-2-2024.html\"",
      "",
      "  # Download from French Stream",
      "  bun run index.ts download --provider fs --query \"loups garous\" --season 2 --max 1",
      "",
      "If no command is provided, 'download' is assumed.",
    ].join("\n")
  )
}

async function main() {
  const { command, argsv } = getCommandAndArgv()
  const args = parseArgs(argsv)

  // Extract provider from args
  const providerName = typeof args.provider === "string" ? args.provider : "yopflix"
  const provider = getProvider(providerName)

  // Remove --provider from argsv for subcommands
  const cleanArgsv = argsv.filter((arg, i) => {
    if (arg === "--provider") return false
    if (i > 0 && argsv[i - 1] === "--provider") return false
    return true
  })

  try {
    switch (command) {
      case "search":
        await cmdSearch(provider, cleanArgsv)
        break
      case "info":
        await cmdInfo(provider, cleanArgsv)
        break
      case "list":
        await cmdList(provider, cleanArgsv)
        break
      case "download":
        await cmdDownload(provider, cleanArgsv)
        break
      case "help":
        printHelp()
        break
      default:
        if (command.startsWith("--")) {
          // No command provided, treat as download with args
          await cmdDownload(provider, [command, ...cleanArgsv])
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
