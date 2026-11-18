import { describe, expect, it } from 'vitest'

import { pcmToWav } from '../novaCloud'

describe('pcmToWav', () => {
  it('produces the canonical WAV the playback session accepts', () => {
    const pcm = new Uint8Array([1, 0, 2, 0, 3, 0, 4])
    const wav = Buffer.from(pcmToWav(pcm, 24_000))
    expect(wav.toString('ascii', 0, 4)).toBe('RIFF')
    expect(wav.toString('ascii', 8, 12)).toBe('WAVE')
    // The session rejects files whose RIFF size does not match the byte length.
    expect(wav.readUInt32LE(4) + 8).toBe(wav.length)
    expect(wav.readUInt32LE(24)).toBe(24_000)
    // A trailing half sample is dropped so the data chunk holds whole 16-bit samples.
    expect(wav.readUInt32LE(40)).toBe(6)
  })
})
