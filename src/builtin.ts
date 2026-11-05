/**
 * Keys baked in at build time (build.mjs reads .env and defines
 * __PLAYMATE_KEYS__). Never in the source; empty when built without .env.
 * A key the user types in Settings always wins over these.
 */
declare const __PLAYMATE_KEYS__: { venice?: string, abliteration?: string, fish?: string } | undefined

export const BUILTIN: { venice: string, abliteration: string, fish: string } = {
  venice: '',
  abliteration: '',
  fish: '',
  ...(typeof __PLAYMATE_KEYS__ !== 'undefined' ? __PLAYMATE_KEYS__ : {}),
}

/** The built-in key for an API provider preset, or ''. */
export const builtinApiKey = (provider: string) => (provider === 'venice' ? BUILTIN.venice : provider === 'abliteration' ? BUILTIN.abliteration : '')
