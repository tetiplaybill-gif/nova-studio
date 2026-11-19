import { describe, expect, it } from 'vitest'

import type { NovaMediaModel } from '@shared/ipc/schemas/novaMedia'

import { pickSpeechModel } from '../novaCloud'

const speech = (id: string, voices: string[] = []): NovaMediaModel => ({
  id,
  name: id,
  type: 'speech',
  endpoints: ['/v1/audio/speech'],
  inputModalities: [],
  pricing: {},
  voices,
  video: null
})

describe('pickSpeechModel', () => {
  const catalog = [speech('vendor/plain'), speech('openai/gpt-4o-mini-tts', ['alloy']), speech('other/voiced', ['x'])]

  it('reads aloud with the model chosen on the Speech page', () => {
    expect(pickSpeechModel(catalog, 'other/voiced')?.id).toBe('other/voiced')
  })

  it('falls back to a dependable default when nothing (or a removed model) was chosen', () => {
    expect(pickSpeechModel(catalog, '')?.id).toBe('openai/gpt-4o-mini-tts')
    expect(pickSpeechModel(catalog, 'gone/model')?.id).toBe('openai/gpt-4o-mini-tts')
    expect(pickSpeechModel([speech('vendor/plain')], '')).toBeNull()
  })
})
