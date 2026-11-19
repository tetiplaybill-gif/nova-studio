import { describe, expect, it } from 'vitest'

import type { NovaMediaModel, NovaVideoCapabilities } from '@shared/ipc/schemas/novaMedia'

import {
  draftEstimateUsd,
  EMPTY_DRAFT,
  fitDraftToModel,
  missingInput,
  modelsForMode,
  togglePhrase
} from '../videoDraft'

const caps = (over: Partial<NovaVideoCapabilities> = {}): NovaVideoCapabilities => ({
  durations: [],
  resolutions: [],
  aspectRatios: [],
  sizes: [],
  frames: [],
  audio: false,
  seed: false,
  passthrough: [],
  upscale: null,
  creativity: [],
  providers: [],
  skus: {},
  ...over
})
const model = (id: string, video: Partial<NovaVideoCapabilities>): NovaMediaModel => ({
  id,
  name: id,
  type: 'video',
  endpoints: ['/v1/videos'],
  inputModalities: [],
  pricing: {},
  voices: [],
  video: caps(video)
})

const veo = model('google/veo-3.1', {
  durations: [4, 6, 8],
  resolutions: ['720p', '1080p', '4K'],
  aspectRatios: ['16:9', '9:16'],
  frames: ['first_frame', 'last_frame'],
  audio: true,
  seed: true,
  passthrough: ['negativePrompt', 'enhancePrompt'],
  skus: { duration_seconds_with_audio: 0.4, duration_seconds_without_audio: 0.2 }
})
const textOnly = model('x/text-only', { durations: [5, 10] })
const upscaler = model('bfl/flux-video-upscale', { upscale: { min: 1.5, max: 3 }, creativity: [0, 1] })
const editor = model('bfl/flux-video-edit', {})
const avatar = model('heygen/heygen-avatar-6', { resolutions: ['1080p'] })
const all = [veo, textOnly, upscaler, editor, avatar]

describe('modelsForMode', () => {
  it('offers each mode only the models that can do it', () => {
    const ids = (mode: Parameters<typeof modelsForMode>[1]) => modelsForMode(all, mode).map((m) => m.id)
    expect(ids('text')).toEqual(['google/veo-3.1', 'x/text-only'])
    expect(ids('frames')).toEqual(['google/veo-3.1'])
    expect(ids('upscale')).toEqual(['bfl/flux-video-upscale'])
    expect(ids('edit')).toEqual(['bfl/flux-video-edit'])
    expect(ids('avatar')).toEqual(['heygen/heygen-avatar-6'])
  })
})

describe('fitDraftToModel', () => {
  it('keeps settings the new model supports and replaces the rest with its defaults', () => {
    const draft = fitDraftToModel(
      {
        ...EMPTY_DRAFT,
        duration: 6,
        resolution: '2K',
        aspectRatio: '1:1',
        seed: 42,
        options: { negativePrompt: 'x', cfg_scale: 1 }
      },
      veo
    )
    expect(draft).toMatchObject({ duration: 6, resolution: '720p', aspectRatio: '16:9', seed: 42 })
    // Options the model does not accept are never sent.
    expect(draft.options).toEqual({ negativePrompt: 'x' })
    expect(fitDraftToModel(draft, textOnly)).toMatchObject({ duration: 5, resolution: undefined, seed: null })
  })

  it('clamps the upscale factor to the model range', () => {
    expect(fitDraftToModel({ ...EMPTY_DRAFT, upscaleFactor: 8 }, upscaler)).toMatchObject({
      upscaleFactor: 3,
      creativity: 0
    })
  })
})

describe('draftEstimateUsd', () => {
  it('prices every variation at the audio rate the draft asks for', () => {
    const draft = fitDraftToModel({ ...EMPTY_DRAFT, duration: 8, count: 2 }, veo)
    expect(draftEstimateUsd(draft, veo)).toBeCloseTo(6.4)
    expect(draftEstimateUsd({ ...draft, generateAudio: false }, veo)).toBeCloseTo(3.2)
  })
})

describe('missingInput', () => {
  it('names what each mode still needs', () => {
    expect(missingInput({ ...EMPTY_DRAFT, mode: 'text' })).toBe('prompt')
    expect(missingInput({ ...EMPTY_DRAFT, mode: 'frames', prompt: 'go' })).toBe('first_frame')
    expect(missingInput({ ...EMPTY_DRAFT, mode: 'avatar', firstFrame: 'data:image/png;base64,AA' })).toBe('audio')
    expect(
      missingInput({ ...EMPTY_DRAFT, mode: 'upscale', sourceVideo: { name: 'a.mp4', clipPath: '/v.mp4' } })
    ).toBeNull()
    expect(missingInput({ ...EMPTY_DRAFT, mode: 'extend' })).toBe('clip')
  })
})

describe('togglePhrase', () => {
  it('adds a direction once and removes it on the second click', () => {
    const once = togglePhrase('A fox in snow.', 'Aerial drone fly-over.')
    expect(once).toBe('A fox in snow. Aerial drone fly-over.')
    expect(togglePhrase(once, 'Aerial drone fly-over.')).toBe('A fox in snow.')
  })
})
