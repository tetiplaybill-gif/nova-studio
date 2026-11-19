import type { NovaMediaModel, NovaVideoMode } from '@shared/ipc/schemas/novaMedia'
import { videoEstimateUsd } from '@shared/utils/novaVideo'

/** Everything the composer holds before a job is submitted. */
export interface VideoDraft {
  mode: NovaVideoMode
  modelId: string
  prompt: string
  negativePrompt: string
  duration?: number
  resolution?: string
  aspectRatio?: string
  generateAudio: boolean
  /** `null`: a new random seed per job. */
  seed: number | null
  count: number
  upscaleFactor?: number
  creativity?: number
  options: Record<string, string | number | boolean>
  firstFrame?: string
  lastFrame?: string
  references: string[]
  /** A local file the user picked, or a clip NOVA Studio made (`clipPath`). */
  sourceVideo?: { name: string; bytes: Uint8Array<ArrayBuffer> } | { name: string; clipPath: string }
  audio?: { name: string; bytes: Uint8Array<ArrayBuffer> }
  /** `extend`: the job whose clip is continued. */
  sourceJobId?: string
}

export const EMPTY_DRAFT: VideoDraft = {
  mode: 'text',
  modelId: '',
  prompt: '',
  negativePrompt: '',
  generateAudio: true,
  seed: null,
  count: 1,
  options: {},
  references: []
}

const isUpscaler = (model: NovaMediaModel) => !!model.video?.upscale
const isAvatar = (model: NovaMediaModel) => /avatar/i.test(model.id)
const isEditor = (model: NovaMediaModel) => /video-edit|aleph/i.test(model.id)
/** Models that make a new clip from a prompt; editors, upscalers and avatars list no durations. */
const isGenerator = (model: NovaMediaModel) =>
  !!model.video && model.video.durations.length > 0 && !isUpscaler(model) && !isAvatar(model) && !isEditor(model)

/** The video models that can do what a mode asks for. */
export function modelsForMode(models: readonly NovaMediaModel[], mode: NovaVideoMode): NovaMediaModel[] {
  const fits: Record<NovaVideoMode, (model: NovaMediaModel) => boolean> = {
    text: isGenerator,
    frames: (model) => isGenerator(model) && (model.video?.frames.includes('first_frame') ?? false),
    references: isGenerator,
    extend: isGenerator,
    edit: isEditor,
    upscale: isUpscaler,
    avatar: isAvatar
  }
  return models.filter((model) => model.type === 'video' && fits[mode](model))
}

/** Settings a model does not offer are dropped, and missing ones get the model's first choice. */
export function fitDraftToModel(draft: VideoDraft, model: NovaMediaModel | undefined): VideoDraft {
  const video = model?.video
  if (!video) return draft
  const pick = <T>(value: T | undefined, choices: readonly T[], preferred?: T) =>
    value !== undefined && choices.includes(value)
      ? value
      : preferred !== undefined && choices.includes(preferred)
        ? preferred
        : choices[0]
  const durations = video.durations.filter((d) => d > 0)
  const upscale = video.upscale
  return {
    ...draft,
    modelId: model.id,
    duration: durations.length ? pick(draft.duration, durations, durations.includes(5) ? 5 : undefined) : undefined,
    resolution: video.resolutions.length ? pick(draft.resolution, video.resolutions, '720p') : undefined,
    aspectRatio: video.aspectRatios.length ? pick(draft.aspectRatio, video.aspectRatios, '16:9') : undefined,
    seed: video.seed ? draft.seed : null,
    upscaleFactor: upscale
      ? Math.min(upscale.max, Math.max(upscale.min, draft.upscaleFactor ?? Math.min(2, upscale.max)))
      : undefined,
    creativity: video.creativity.length ? pick(draft.creativity, video.creativity) : undefined,
    options: Object.fromEntries(Object.entries(draft.options).filter(([key]) => video.passthrough.includes(key)))
  }
}

/** The passthrough parameter a model takes a negative prompt in, if any. */
export function negativePromptKey(model: NovaMediaModel | undefined): string | undefined {
  return model?.video?.passthrough.find((key) => key === 'negative_prompt' || key === 'negativePrompt')
}

export const CAMERA_MOVES = [
  'static',
  'push_in',
  'pull_out',
  'pan_left',
  'pan_right',
  'tilt_up',
  'orbit',
  'crane_up',
  'tracking',
  'handheld',
  'drone',
  'zoom_in'
] as const
export type CameraMove = (typeof CAMERA_MOVES)[number]

/** English camera directions: video models follow English shot language most reliably. */
export const CAMERA_PHRASES: Record<CameraMove, string> = {
  static: 'Locked-off static camera.',
  push_in: 'Slow dolly push-in toward the subject.',
  pull_out: 'Slow dolly pull-out revealing the scene.',
  pan_left: 'Smooth pan to the left.',
  pan_right: 'Smooth pan to the right.',
  tilt_up: 'Camera tilts up slowly.',
  orbit: 'Camera orbits around the subject.',
  crane_up: 'Crane shot rising upward.',
  tracking: 'Tracking shot following the subject.',
  handheld: 'Handheld camera with natural shake.',
  drone: 'Aerial drone fly-over.',
  zoom_in: 'Gradual zoom in.'
}

export const STYLE_PRESETS = [
  'cinematic',
  'anime',
  'render_3d',
  'documentary',
  'product',
  'vintage',
  'noir',
  'claymation'
] as const
export type StylePreset = (typeof STYLE_PRESETS)[number]

export const STYLE_PHRASES: Record<StylePreset, string> = {
  cinematic: 'Cinematic, shallow depth of field, anamorphic lens, film grain, dramatic lighting.',
  anime: 'Anime style, cel shading, vibrant colors, expressive motion.',
  render_3d: 'Stylized 3D animation, soft global illumination, Pixar-like detail.',
  documentary: 'Natural documentary look, available light, realistic textures.',
  product: 'Premium product commercial, studio lighting, clean background, slow reveal.',
  vintage: '1970s 16mm film look, warm tones, light leaks.',
  noir: 'Black-and-white film noir, high contrast, hard shadows.',
  claymation: 'Stop-motion claymation, handmade textures, slightly jerky motion.'
}

/** Adds a direction sentence to the prompt, or removes it when it is already there. */
export function togglePhrase(prompt: string, phrase: string): string {
  if (prompt.includes(phrase))
    return prompt
      .replace(phrase, '')
      .replace(/\s{2,}/g, ' ')
      .trim()
  return prompt.trim() ? `${prompt.trim()} ${phrase}` : phrase
}

/**
 * Seconds a job will produce, for the estimate. Editors and upscalers bill the output length,
 * which is the source clip's: `sourceSeconds` when known.
 */
export function draftSeconds(draft: VideoDraft, model: NovaMediaModel | undefined, sourceSeconds?: number): number {
  if (draft.duration) return draft.duration
  if (sourceSeconds) return sourceSeconds
  const durations = model?.video?.durations ?? []
  return durations.length ? Math.max(...durations) : 8
}

export function draftEstimateUsd(draft: VideoDraft, model: NovaMediaModel | undefined, sourceSeconds?: number) {
  if (!model?.video) return null
  return videoEstimateUsd(model.video.skus, {
    resolution: draft.resolution,
    audio: model.video.audio ? draft.generateAudio : undefined,
    seconds: draftSeconds(draft, model, sourceSeconds),
    count: draft.count
  })
}

/** What a mode still needs before it can be submitted; `null` when ready. */
export function missingInput(
  draft: VideoDraft
): 'prompt' | 'first_frame' | 'image' | 'video' | 'audio' | 'clip' | null {
  switch (draft.mode) {
    case 'text':
    case 'references':
      if (draft.mode === 'references' && draft.references.length === 0) return 'image'
      return draft.prompt.trim() ? null : 'prompt'
    case 'frames':
      if (!draft.firstFrame) return 'first_frame'
      return null
    case 'extend':
      return draft.sourceJobId ? null : 'clip'
    case 'edit':
      if (!draft.sourceVideo) return 'video'
      return draft.prompt.trim() ? null : 'prompt'
    case 'upscale':
      return draft.sourceVideo ? null : 'video'
    case 'avatar':
      if (!draft.firstFrame) return 'image'
      return draft.audio ? null : 'audio'
  }
}
