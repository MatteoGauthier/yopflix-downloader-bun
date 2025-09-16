# yopflix-downloader-bun

To install dependencies:

```bash
bun install
```

## Quickstart

```bash
# Download by search (defaults to first match)
bun run index.ts download --query "psych"

# Or download by title id
bun run index.ts download --titleId 3235
```

## Subcommands

```bash
# Search titles
bun run index.ts search --query "psych" --limit 20

# Show info for a title id
bun run index.ts info --titleId 3235

# List available uqload videos for a title id (SxxEyy + URL)
bun run index.ts list --titleId 3235

# Download with filters (season / episodes / limit / output dir)
bun run index.ts download --titleId 3235 --season 1 --episode 1,2,5 --max 3 --outDir ./downloads

# Help
bun run index.ts help
```

You can also use package scripts:

```bash
bun run search -- --query "psych"
bun run info -- --titleId 3235
bun run list -- --titleId 3235
bun run download -- --titleId 3235 --season 1
```

### Notes
- The script fetches JSON from `https://yopflix.my/secure/search/...` and `https://yopflix.my/secure/titles/...` and extracts `uqload` embed links.
- Downloads use `yt-dlp` and produce Jellyfin-friendly names: `Show Name/Season 01/Show Name - S01E01.mp4`.
- Ensure `yt-dlp` is installed and available on your PATH.

This project was created using `bun init` in bun v1.2.20. [Bun](https://bun.com) is a fast all-in-one JavaScript runtime.
