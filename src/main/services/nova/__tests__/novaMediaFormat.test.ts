import { describe, expect, it } from 'vitest'

import { parseCatalog, pcmFormat, pcmToWav, providerOptions, voiceLocale } from '../novaMediaFormat'

describe('parseCatalog', () => {
  it('reads every model type with its customer prices, voices and video capabilities, lengths in order', () => {
    const models = parseCatalog({
      data: [
        { id: 'deepseek/deepseek-v4-flash', name: 'DeepSeek V4 Flash', type: 'chat', pricing: { prompt: '0.0000003' } },
        {
          id: 'openai/tts',
          name: 'TTS',
          type: 'speech',
          pricing: { prompt: '0.00001' },
          supported_voices: ['alloy', 7]
        },
        {
          id: 'google/veo-3.1-fast',
          name: 'Veo 3.1 Fast',
          type: 'video',
          endpoints: ['/v1/videos'],
          pricing: { video: { duration_seconds_with_audio: '0.216' } },
          video: {
            supported_durations: [8, 4, -1, 6],
            supported_resolutions: ['720p', '1080p'],
            supported_aspect_ratios: ['16:9', '9:16'],
            supported_frame_images: ['first_frame', 'last_frame'],
            generate_audio: true,
            seed: true,
            allowed_passthrough_parameters: ['negativePrompt']
          }
        },
        {
          id: 'bfl/upscale',
          type: 'video',
          video: { upscale_factor: { min: 1.5, max: 3 }, creativity: [0, 1], providers: ['black-forest-labs'] }
        },
        { name: 'no id' },
        { id: 'x/unknown', type: 'hologram' }
      ]
    })
    expect(models.map((m) => [m.id, m.type])).toEqual([
      ['deepseek/deepseek-v4-flash', 'chat'],
      ['openai/tts', 'speech'],
      ['google/veo-3.1-fast', 'video'],
      ['bfl/upscale', 'video'],
      ['x/unknown', 'chat']
    ])
    expect(models[0].pricing.prompt).toBeCloseTo(0.0000003)
    expect(models[1].voices).toEqual(['alloy'])
    expect(models[2].video).toMatchObject({
      durations: [4, 6, 8],
      aspectRatios: ['16:9', '9:16'],
      frames: ['first_frame', 'last_frame'],
      audio: true,
      seed: true,
      skus: { duration_seconds_with_audio: 0.216 }
    })
    expect(models[3].video).toMatchObject({
      upscale: { min: 1.5, max: 3 },
      creativity: [0, 1],
      providers: ['black-forest-labs']
    })
    expect(models[0].video).toBeNull()
  })
})

describe('speech audio', () => {
  it('reads the sample rate NOVA reports and falls back to 24 kHz mono', () => {
    expect(pcmFormat('audio/pcm;rate=16000;channels=1')).toEqual({ sampleRate: 16_000, channels: 1 })
    expect(pcmFormat('audio/pcm')).toEqual({ sampleRate: 24_000, channels: 1 })
    expect(pcmFormat(null)).toEqual({ sampleRate: 24_000, channels: 1 })
  })

  it('wraps PCM as the canonical WAV the playback session accepts', () => {
    const wav = Buffer.from(pcmToWav(new Uint8Array([1, 0, 2, 0, 3, 0, 4]), 24_000))
    expect(wav.toString('ascii', 0, 4)).toBe('RIFF')
    expect(wav.readUInt32LE(4) + 8).toBe(wav.length)
    expect(wav.readUInt32LE(24)).toBe(24_000)
    // A trailing half sample is dropped so the data chunk holds whole 16-bit samples.
    expect(wav.readUInt32LE(40)).toBe(6)
  })

  it('guesses a voice locale from its id', () => {
    expect(voiceLocale('en_paul_neutral')).toBe('en')
    expect(voiceLocale('zh-CN-XiaoxiaoNeural')).toBe('zh-CN')
    expect(voiceLocale('alloy')).toBe('')
  })
})

describe('providerOptions', () => {
  it('keys options by every provider slug and nests them in parameters only for Veo', () => {
    expect(
      providerOptions({ model: 'google/veo-3.1', options: { negativePrompt: 'blur' }, providers: ['google-vertex'] })
    ).toEqual({ options: { 'google-vertex': { parameters: { negativePrompt: 'blur' } } } })
    expect(
      providerOptions({
        model: 'bytedance/seedance-2.5',
        options: { watermark: false },
        providers: ['seed', 'byteplus']
      })
    ).toEqual({ options: { seed: { watermark: false }, byteplus: { watermark: false } } })
  })

  it('sends nothing when every option is left empty', () => {
    expect(
      providerOptions({ model: 'kwaivgi/kling-v3.0-pro', options: { negative_prompt: '' }, providers: [] })
    ).toBeNull()
  })
})
