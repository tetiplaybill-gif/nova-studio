import { describe, expect, it } from 'vitest'

import { videoEstimateUsd, videoRatePerSecond } from '../novaVideo'

describe('videoRatePerSecond', () => {
  const veo = {
    duration_seconds_with_audio: 0.12,
    duration_seconds_with_audio_4k: 0.3,
    duration_seconds_without_audio: 0.1,
    duration_seconds_with_audio_720p: 0.1,
    duration_seconds_without_audio_4k: 0.25,
    duration_seconds_without_audio_720p: 0.08
  }

  it('picks the SKU for the chosen resolution and audio setting', () => {
    expect(videoRatePerSecond(veo, '4K', true)).toBe(0.3)
    expect(videoRatePerSecond(veo, '720p', false)).toBe(0.08)
    // 1080p has no SKU of its own: it is the resolution-free rate.
    expect(videoRatePerSecond(veo, '1080p', true)).toBe(0.12)
    expect(videoRatePerSecond(veo, '1080p', false)).toBe(0.1)
  })

  it('never undershoots when the setting does not decide between rates', () => {
    expect(videoRatePerSecond({ 'per-video-second': 0.05, 'per-video-second-1080p': 0.09 }, undefined, undefined)).toBe(
      0.05
    )
    expect(
      videoRatePerSecond({ 'per-video-second-720p': 0.05, 'per-video-second-1080p': 0.09 }, undefined, undefined)
    ).toBe(0.09)
    expect(videoRatePerSecond({}, '720p', true)).toBeNull()
  })
})

describe('videoEstimateUsd', () => {
  it('reads cents-per-second SKUs as dollars and applies the per-generation minimum', () => {
    const aleph = { cents_per_second_output: 28, minimum_cents_per_generation: 56 }
    expect(videoEstimateUsd(aleph, { seconds: 5, count: 1 })).toBeCloseTo(1.4)
    // 1 s would cost 0.28, below the 0.56 minimum.
    expect(videoEstimateUsd(aleph, { seconds: 1, count: 2 })).toBeCloseTo(1.12)
  })

  it('gives no estimate for token-priced models instead of guessing', () => {
    expect(videoEstimateUsd({ video_tokens: 0.000007 }, { resolution: '720p', seconds: 5, count: 1 })).toBeNull()
  })
})
