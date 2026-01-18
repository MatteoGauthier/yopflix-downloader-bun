// Provider registry

import type { Provider } from "./base.ts"
import { YopflixProvider } from "./yopflix.ts"
import { FrenchStreamProvider } from "./frenchstream.ts"

export type { Provider } from "./base.ts"

const yopflix = new YopflixProvider()
const frenchstream = new FrenchStreamProvider()

export const providers: Record<string, Provider> = {
  yopflix,
  frenchstream,
  fs: frenchstream, // alias
}

export function getProvider(name: string): Provider {
  return providers[name] ?? yopflix
}

export function listProviders(): string[] {
  return Object.keys(providers).filter(k => k !== "fs") // exclude alias
}
