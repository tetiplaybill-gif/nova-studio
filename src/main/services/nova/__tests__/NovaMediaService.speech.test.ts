import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { application } from '@application'

import { NovaMediaService } from '../NovaMediaService'

vi.mock('@application', async () => {
  const { mockApplicationFactory } = await import('@test-mocks/main/application')
  return mockApplicationFactory()
})
vi.mock('electron', () => ({ BrowserWindow: {}, dialog: {}, Notification: vi.fn(), shell: {} }))
vi.mock('@main/data/services/ProviderService', () => ({
  providerService: { getRotatedApiKey: () => 'sk-test' }
}))

const speech = { model: 'google/gemini-2.5-pro-tts', modelName: 'Gemini', voice: 'Zephyr', text: 'Hi', speed: 1 }
const rejectMp3 = () =>
  new Response(JSON.stringify({ error: { message: 'Gemini TTS only supports pcm' } }), { status: 400 })
const pcm = () => new Response(new Uint8Array(480), { headers: { 'content-type': 'audio/pcm;rate=24000' } })

describe('NovaMediaService speech', () => {
  const service = new NovaMediaService()
  let dir: string
  const fetchMock = vi.fn()

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'nova-speech-'))
    vi.mocked(application.getPath).mockImplementation((_key: string, filename?: string) =>
      path.join(dir, filename ?? '')
    )
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(async () => {
    fetchMock.mockReset()
    vi.unstubAllGlobals()
    await fs.rm(dir, { recursive: true, force: true })
  })

  it('saves WAV when a voice cannot produce MP3, instead of failing', async () => {
    fetchMock.mockResolvedValueOnce(rejectMp3()).mockResolvedValueOnce(pcm())

    const result = await service.synthesize({ ...speech, format: 'mp3' })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.data.format).toBe('wav')
    expect(result.data.path.endsWith('.wav')).toBe(true)
    expect((await fs.readFile(result.data.path)).subarray(0, 4).toString('ascii')).toBe('RIFF')
  })

  it('does not retry when the request fails for another reason', async () => {
    fetchMock.mockResolvedValueOnce(new Response('{}', { status: 402 }))

    const result = await service.synthesize({ ...speech, format: 'mp3' })

    expect(result).toMatchObject({ ok: false, error: 'insufficient_balance' })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})
