/** Video price estimates for NOVA video models, shared by the video page and its tests. */

const RESOLUTION_TOKENS = ['360p', '480p', '720p', '768p', '1080p', '1k', '2k', '4k']

const resolutionOf = (key: string) =>
  RESOLUTION_TOKENS.find((token) => new RegExp(`(^|[_-])${token}($|[_-])`).test(key))

/**
 * USD per second for the chosen resolution and audio setting. SKU names differ by model
 * (`duration_seconds_with_audio_720p`, `cents_per_second_output` …); when several fit, the dearest
 * is used so the estimate never undershoots what NOVA reserves. Token-priced models have no
 * per-second rate and return null.
 */
export function videoRatePerSecond(
  skus: Record<string, number>,
  resolution: string | undefined,
  audio: boolean | undefined
): number | null {
  const entries = Object.entries(skus)
    .map(([key, rate]) => [key.toLowerCase(), rate] as const)
    .filter(([key]) => key.includes('second') && !key.startsWith('minimum'))
    .map(([key, rate]) => [key, key.includes('cents') ? rate / 100 : rate] as const)
  if (entries.length === 0) return null
  const wanted = resolution?.toLowerCase()
  let candidates = entries.filter(([key]) => wanted && resolutionOf(key) === wanted)
  if (candidates.length === 0) candidates = entries.filter(([key]) => !resolutionOf(key))
  if (candidates.length === 0) candidates = entries
  if (audio !== undefined) {
    const marker = audio ? 'with_audio' : 'without_audio'
    const matching = candidates.filter(([key]) => key.includes(marker))
    if (matching.length > 0) candidates = matching
  }
  return Math.max(...candidates.map(([, rate]) => rate))
}

/** Estimated USD for `count` clips of `seconds` each, or null when the model is not priced per second. */
export function videoEstimateUsd(
  skus: Record<string, number>,
  settings: { resolution?: string; audio?: boolean; seconds: number; count: number }
): number | null {
  const rate = videoRatePerSecond(skus, settings.resolution, settings.audio)
  if (rate === null) return null
  const minimum = (skus.minimum_cents_per_generation ?? 0) / 100
  return Math.max(rate * settings.seconds, minimum) * settings.count
}
