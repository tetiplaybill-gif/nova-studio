import {
  NOVA_MEDIA_MODEL_TYPES,
  type NovaMediaError,
  type NovaMediaModel,
  type NovaMediaModelType,
  type NovaStoredVideoRequest,
  type NovaVideoCapabilities
} from '@shared/ipc/schemas/novaMedia'

/** Pure helpers for NOVA media: catalog parsing, video price estimates, audio wrapping, error mapping. */

const asStrings = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []

const asNumber = (value: unknown): number | null => {
  const number = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN
  return Number.isFinite(number) ? number : null
}

function numericRecord(value: unknown): Record<string, number> {
  const out: Record<string, number> = {}
  if (!value || typeof value !== 'object') return out
  for (const [key, raw] of Object.entries(value)) {
    const number = asNumber(raw)
    if (number !== null) out[key] = number
  }
  return out
}

function upscaleRange(value: unknown): { min: number; max: number } | null {
  const range = value as { min?: unknown; max?: unknown } | null
  const min = asNumber(range?.min)
  const max = asNumber(range?.max)
  return min !== null && max !== null && min > 0 && max >= min ? { min, max } : null
}

function parseVideo(row: Record<string, unknown>, pricing: Record<string, unknown>): NovaVideoCapabilities | null {
  const video = row.video
  if (!video || typeof video !== 'object') return null
  const v = video as Record<string, unknown>
  return {
    durations: Array.isArray(v.supported_durations)
      ? v.supported_durations.filter((d): d is number => typeof d === 'number' && d > 0)
      : [],
    resolutions: asStrings(v.supported_resolutions),
    aspectRatios: asStrings(v.supported_aspect_ratios),
    sizes: asStrings(v.supported_sizes),
    frames: asStrings(v.supported_frame_images),
    audio: v.generate_audio === true,
    seed: v.seed === true,
    passthrough: asStrings(v.allowed_passthrough_parameters),
    upscale: upscaleRange(v.upscale_factor),
    creativity: Array.isArray(v.creativity) ? v.creativity.filter((c): c is number => typeof c === 'number') : [],
    providers: asStrings(v.providers),
    skus: numericRecord(pricing.video)
  }
}

/** Reads NOVA's `/v1/models?output_modalities=all` listing into the shape the media pages use. */
export function parseCatalog(body: unknown): NovaMediaModel[] {
  const data = (body as { data?: unknown })?.data
  if (!Array.isArray(data)) return []
  const models: NovaMediaModel[] = []
  for (const item of data) {
    if (!item || typeof item !== 'object') continue
    const row = item as Record<string, unknown>
    if (typeof row.id !== 'string' || !row.id) continue
    const type = NOVA_MEDIA_MODEL_TYPES.includes(row.type as NovaMediaModelType)
      ? (row.type as NovaMediaModelType)
      : 'chat'
    const pricing = row.pricing && typeof row.pricing === 'object' ? (row.pricing as Record<string, unknown>) : {}
    const architecture = (row.architecture ?? {}) as Record<string, unknown>
    models.push({
      id: row.id,
      name: typeof row.name === 'string' && row.name ? row.name : row.id,
      type,
      endpoints: asStrings(row.endpoints),
      inputModalities: asStrings(architecture.input_modalities),
      pricing: numericRecord(pricing),
      voices: asStrings(row.supported_voices),
      video: type === 'video' ? parseVideo(row, pricing) : null
    })
  }
  return models
}

/** Wraps raw 16-bit little-endian PCM in a WAV header. */
export function pcmToWav(pcm: Uint8Array, sampleRate: number, channels = 1): Uint8Array {
  const data = Buffer.from(pcm.buffer, pcm.byteOffset, pcm.byteLength - (pcm.byteLength % (2 * channels)))
  const header = Buffer.alloc(44)
  header.write('RIFF', 0, 'ascii')
  header.writeUInt32LE(36 + data.length, 4)
  header.write('WAVE', 8, 'ascii')
  header.write('fmt ', 12, 'ascii')
  header.writeUInt32LE(16, 16)
  header.writeUInt16LE(1, 20)
  header.writeUInt16LE(channels, 22)
  header.writeUInt32LE(sampleRate, 24)
  header.writeUInt32LE(sampleRate * 2 * channels, 28)
  header.writeUInt16LE(2 * channels, 32)
  header.writeUInt16LE(16, 34)
  header.write('data', 36, 'ascii')
  header.writeUInt32LE(data.length, 40)
  return Uint8Array.from(Buffer.concat([header, data]))
}

/** Reads `audio/pcm;rate=24000;channels=1`; OpenRouter's PCM default is 24 kHz mono. */
export function pcmFormat(contentType: string | null): { sampleRate: number; channels: number } {
  const rate = /rate=(\d+)/i.exec(contentType ?? '')?.[1]
  const channels = /channels=(\d+)/i.exec(contentType ?? '')?.[1]
  const sampleRate = rate ? Number(rate) : 24_000
  const count = channels ? Number(channels) : 1
  return {
    sampleRate: sampleRate >= 8_000 && sampleRate <= 192_000 ? sampleRate : 24_000,
    channels: count >= 1 && count <= 2 ? count : 1
  }
}

/** Maps an HTTP status to the error the pages explain to the user. */
export function errorForStatus(status: number): NovaMediaError['error'] {
  if (status === 401 || status === 403) return 'no_key'
  if (status === 402) return 'insufficient_balance'
  if (status === 404) return 'not_found'
  if (status === 429) return 'rate_limited'
  if (status >= 400 && status < 500) return 'invalid_request'
  return 'unavailable'
}

/** NOVA's error message from an API error body, if it has one. */
export function errorMessage(body: unknown): string | undefined {
  const error = (body as { error?: unknown })?.error
  const message =
    typeof error === 'string'
      ? error
      : ((error as { message?: unknown } | undefined)?.message ?? (body as { message?: unknown })?.message)
  return typeof message === 'string' && message.trim() ? message.trim().slice(0, 500) : undefined
}

/** Locale guessed from a voice id such as `en_paul_neutral` or `zh-CN-XiaoxiaoNeural`. */
export function voiceLocale(voice: string): string {
  const match = /^([a-z]{2})(?:[-_]([A-Z]{2}))?(?=[-_]|$)/.exec(voice)
  if (!match) return ''
  return match[2] ? `${match[1]}-${match[2]}` : match[1]
}

const IMAGE_EXT: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/webp': 'webp'
}

/** Splits a validated image data URL into its bytes and file extension. */
export function decodeImageDataUrl(dataUrl: string): { bytes: Buffer; ext: string } | null {
  const match = /^data:(image\/[a-z]+);base64,(.+)$/s.exec(dataUrl)
  const ext = match && IMAGE_EXT[match[1]]
  if (!match || !ext) return null
  return { bytes: Buffer.from(match[2], 'base64'), ext }
}

export function imageDataUrl(bytes: Buffer, ext: string): string {
  const mime = ext === 'jpg' ? 'image/jpeg' : `image/${ext}`
  return `data:${mime};base64,${bytes.toString('base64')}`
}

/** Media types of the input files a video request can carry, by extension. */
export const MEDIA_TYPES: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  mp4: 'video/mp4',
  mov: 'video/quicktime',
  webm: 'video/webm',
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  m4a: 'audio/mp4',
  ogg: 'audio/ogg'
}

export function mediaType(file: string): string {
  return MEDIA_TYPES[file.split('.').pop()?.toLowerCase() ?? ''] ?? 'application/octet-stream'
}

/**
 * `provider.options` for the model's provider-specific settings. Options are keyed by the slug of
 * the provider serving the model; only Veo nests them in `parameters`.
 */
export function providerOptions(request: Pick<NovaStoredVideoRequest, 'model' | 'options' | 'providers'>) {
  const entries = Object.entries(request.options).filter(([, value]) => value !== '')
  if (entries.length === 0) return null
  const values = Object.fromEntries(entries)
  const slugs = request.providers.length > 0 ? request.providers : [request.model.split('/')[0]]
  const nested = request.model.startsWith('google/veo')
  return { options: Object.fromEntries(slugs.map((slug) => [slug, nested ? { parameters: values } : values])) }
}
