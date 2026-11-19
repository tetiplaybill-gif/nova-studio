import { randomUUID } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'

import { BrowserWindow, dialog, Notification, shell } from 'electron'

import { application } from '@application'
import { loggerService } from '@logger'
import { BaseService, Injectable, Phase, ServicePhase } from '@main/core/lifecycle'
import { providerService } from '@main/data/services/ProviderService'
import { NOVA_API_BASE_URL, NOVA_DEFAULT_MODEL_ID, NOVA_TRANSCRIPTION_MODEL } from '@shared/data/presets/nova'
import type {
  NovaDecisionQuestion,
  NovaExtractionField,
  NovaMediaError,
  NovaMediaUpload,
  NovaMediaModel,
  NovaSpeechItem,
  NovaStoredVideoRequest,
  NovaTranscript,
  NovaVideoCreateInput,
  NovaVideoJob,
  NovaVideoJobStatus,
  NovaVoiceSettings
} from '@shared/ipc/schemas/novaMedia'

import {
  decodeImageDataUrl,
  errorForStatus,
  errorMessage,
  imageDataUrl,
  MEDIA_TYPES,
  mediaType,
  parseCatalog,
  pcmFormat,
  pcmToWav,
  providerOptions
} from './novaMediaFormat'

const logger = loggerService.withContext('NovaMediaService')

const CATALOG_TTL_MS = 10 * 60 * 1000
const POLL_TICK_MS = 5_000
const REQUEST_TIMEOUT_MS = 120_000
const ACTIVE: NovaVideoJobStatus[] = ['pending', 'in_progress', 'downloading']

type Result<T> = { ok: true; data: T } | NovaMediaError

class NovaApiError extends Error {
  constructor(
    readonly code: NovaMediaError['error'],
    message?: string
  ) {
    super(message ?? code)
  }
}

const fail = (error: unknown): NovaMediaError => {
  if (error instanceof NovaApiError) {
    return { ok: false, error: error.code, ...(error.message !== error.code && { message: error.message }) }
  }
  logger.warn('NOVA media request failed', error as Error)
  return { ok: false, error: 'unavailable' }
}

interface Store {
  videos: NovaVideoJob[]
  speech: NovaSpeechItem[]
  transcripts: NovaTranscript[]
  settings: NovaVoiceSettings
}

/**
 * Everything NOVA Studio generates through the NOVA API besides chat and images: video jobs (submitted,
 * polled and downloaded here so they finish while the page is closed), speech, transcripts, extractions
 * and decisions. Files and the history index live under `feature.nova_media.data`.
 */
@Injectable('NovaMediaService')
@ServicePhase(Phase.WhenReady)
export class NovaMediaService extends BaseService {
  private store: Store = {
    videos: [],
    speech: [],
    transcripts: [],
    settings: { transcriptionModel: NOVA_TRANSCRIPTION_MODEL, speechModel: '', speechVoice: '' }
  }
  private catalogCache: { at: number; models: NovaMediaModel[] } | null = null
  private nextPoll = new Map<string, number>()
  private polling = false
  private saving: Promise<void> = Promise.resolve()

  protected async onInit(): Promise<void> {
    await this.load()
    // Jobs left running at the last quit carry on: NOVA kept generating them.
    this.registerInterval(() => void this.pollJobs(), POLL_TICK_MS)
  }

  // ─── Paths and persistence ───────────────────────────────────────────

  private dir(...segments: string[]): string {
    return path.join(application.getPath('feature.nova_media.data'), ...segments)
  }

  /** Only files this service wrote may be revealed, copied or read back. */
  private owned(file: string): boolean {
    const root = path.resolve(application.getPath('feature.nova_media.data')) + path.sep
    return path.resolve(file).startsWith(root)
  }

  private async load(): Promise<void> {
    try {
      const raw = JSON.parse(await fs.readFile(this.dir('index.json'), 'utf8')) as Partial<Store>
      this.store = {
        videos: Array.isArray(raw.videos) ? raw.videos : [],
        speech: Array.isArray(raw.speech) ? raw.speech : [],
        transcripts: Array.isArray(raw.transcripts) ? raw.transcripts : [],
        settings: { ...this.store.settings, ...raw.settings }
      }
      // A download cut short by quitting starts over.
      for (const job of this.store.videos) if (job.status === 'downloading') job.status = 'in_progress'
      for (const job of this.store.videos) if (job.status === 'submitting') job.status = 'failed'
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT')
        logger.warn('Could not read the NOVA media index', error as Error)
    }
  }

  private save(): Promise<void> {
    const snapshot = JSON.stringify(this.store)
    this.saving = this.saving.then(async () => {
      const target = this.dir('index.json')
      await fs.mkdir(path.dirname(target), { recursive: true })
      await fs.writeFile(`${target}.tmp`, snapshot)
      await fs.rename(`${target}.tmp`, target)
    })
    return this.saving.catch((error) => logger.error('Could not save the NOVA media index', error as Error))
  }

  // ─── NOVA API ────────────────────────────────────────────────────────

  private key(): string {
    let key: string | null = null
    try {
      key = providerService.getRotatedApiKey('nova') || null
    } catch {
      key = null
    }
    if (!key) throw new NovaApiError('no_key')
    return key
  }

  private async request(apiPath: string, init: RequestInit = {}, timeoutMs = REQUEST_TIMEOUT_MS): Promise<Response> {
    const headers = { ...(init.headers as Record<string, string>), Authorization: `Bearer ${this.key()}` }
    let response: Response
    try {
      response = await fetch(`${NOVA_API_BASE_URL}${apiPath}`, {
        ...init,
        headers,
        signal: AbortSignal.timeout(timeoutMs)
      })
    } catch (error) {
      throw new NovaApiError((error as Error).name === 'TimeoutError' ? 'unavailable' : 'offline')
    }
    if (!response.ok) {
      const body = await response.json().catch(() => null)
      throw new NovaApiError(errorForStatus(response.status), errorMessage(body))
    }
    return response
  }

  private async json<T = Record<string, unknown>>(apiPath: string, body: unknown, timeoutMs?: number): Promise<T> {
    const response = await this.request(
      apiPath,
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) },
      timeoutMs
    )
    return (await response.json()) as T
  }

  async catalog(refresh = false): Promise<Result<NovaMediaModel[]>> {
    try {
      if (!refresh && this.catalogCache && Date.now() - this.catalogCache.at < CATALOG_TTL_MS) {
        return { ok: true, data: this.catalogCache.models }
      }
      const response = await this.request('/models?output_modalities=all', {}, 30_000)
      const models = parseCatalog(await response.json())
      this.catalogCache = { at: Date.now(), models }
      return { ok: true, data: models }
    } catch (error) {
      if (this.catalogCache) return { ok: true, data: this.catalogCache.models }
      return fail(error)
    }
  }

  /** Rewrites a short idea as a detailed prompt with NOVA's default chat model. */
  async enhancePrompt(prompt: string, kind: 'video' | 'speech'): Promise<Result<string>> {
    const instruction =
      kind === 'video'
        ? 'Rewrite the user idea as one vivid prompt for an AI video model: subject, action, setting, camera movement, lighting and style, in under 120 words. Keep the language the user wrote in. Reply with the prompt only.'
        : 'Polish the text so it reads naturally aloud. Keep its meaning and language. Reply with the text only.'
    try {
      const body = await this.json<{ choices?: Array<{ message?: { content?: unknown } }> }>('/chat/completions', {
        model: NOVA_DEFAULT_MODEL_ID,
        messages: [
          { role: 'system', content: instruction },
          { role: 'user', content: prompt }
        ],
        max_tokens: 600
      })
      const text = body.choices?.[0]?.message?.content
      return typeof text === 'string' && text.trim()
        ? { ok: true, data: text.trim() }
        : fail(new NovaApiError('unavailable'))
    } catch (error) {
      return fail(error)
    }
  }

  // ─── Files ───────────────────────────────────────────────────────────

  reveal(file: string): void {
    if (this.owned(file)) shell.showItemInFolder(file)
  }

  async saveAs(file: string, suggestedName: string): Promise<{ saved: boolean }> {
    if (!this.owned(file)) return { saved: false }
    const window = BrowserWindow.getFocusedWindow()
    const options = {
      defaultPath: path.join(application.getPath('sys.downloads'), suggestedName.replace(/[\\/:*?"<>|]/g, '_'))
    }
    const choice = window ? await dialog.showSaveDialog(window, options) : await dialog.showSaveDialog(options)
    if (choice.canceled || !choice.filePath) return { saved: false }
    await fs.copyFile(file, choice.filePath)
    return { saved: true }
  }

  async saveImage(dataUrl: string, suggestedName: string): Promise<{ saved: boolean }> {
    const image = decodeImageDataUrl(dataUrl)
    if (!image) return { saved: false }
    const window = BrowserWindow.getFocusedWindow()
    const options = {
      defaultPath: path.join(application.getPath('sys.downloads'), suggestedName.replace(/[\\/:*?"<>|]/g, '_'))
    }
    const choice = window ? await dialog.showSaveDialog(window, options) : await dialog.showSaveDialog(options)
    if (choice.canceled || !choice.filePath) return { saved: false }
    await fs.writeFile(choice.filePath, image.bytes)
    return { saved: true }
  }

  async readFile(file: string): Promise<Uint8Array<ArrayBuffer> | null> {
    if (!this.owned(file)) return null
    return fs
      .readFile(file)
      .then((buffer) => new Uint8Array(buffer))
      .catch(() => null)
  }

  private async writeFile(folder: string, name: string, bytes: Uint8Array): Promise<string> {
    const target = this.dir(folder, name)
    await fs.mkdir(path.dirname(target), { recursive: true })
    await fs.writeFile(target, bytes)
    return target
  }

  private async removeFiles(files: Array<string | undefined>): Promise<void> {
    await Promise.all(
      files.filter((file): file is string => !!file && this.owned(file)).map((file) => fs.rm(file, { force: true }))
    )
  }

  // ─── Video ───────────────────────────────────────────────────────────

  listVideos(): NovaVideoJob[] {
    return [...this.store.videos].sort((a, b) => b.createdAt - a.createdAt)
  }

  private publish(job: NovaVideoJob): void {
    application.get('IpcApiService').broadcast('nova.video.job_updated', job)
  }

  private updateJob(job: NovaVideoJob, changes: Partial<NovaVideoJob>): void {
    Object.assign(job, changes, { updatedAt: Date.now() })
    void this.save()
    this.publish(job)
  }

  private async storeImage(dataUrl: string | undefined): Promise<string | undefined> {
    if (!dataUrl) return undefined
    const image = decodeImageDataUrl(dataUrl)
    if (!image) throw new NovaApiError('invalid_request')
    return this.writeFile('inputs', `${randomUUID()}.${image.ext}`, image.bytes)
  }

  async inputImage(file: string): Promise<string | null> {
    if (!this.owned(file)) return null
    const ext = path.extname(file).slice(1).toLowerCase()
    return fs
      .readFile(file)
      .then((bytes) => imageDataUrl(bytes, ext))
      .catch(() => null)
  }

  /** Reads a stored input back as a data URL for the API. */
  private async asset(file: string | undefined, kind: 'image' | 'video' | 'audio'): Promise<Record<string, unknown>> {
    const bytes = file && this.owned(file) ? await fs.readFile(file).catch(() => null) : null
    if (!bytes) throw new NovaApiError('invalid_request', 'An input file is missing.')
    const url = `data:${mediaType(file!)};base64,${bytes.toString('base64')}`
    return { type: `${kind}_url`, [`${kind}_url`]: { url } }
  }

  private async videoBody(request: NovaStoredVideoRequest): Promise<Record<string, unknown>> {
    const body: Record<string, unknown> = { model: request.model }
    if (request.prompt) body.prompt = request.prompt
    if (request.duration) body.duration = request.duration
    if (request.resolution) body.resolution = request.resolution
    if (request.aspectRatio) body.aspect_ratio = request.aspectRatio
    if (request.generateAudio !== undefined) body.generate_audio = request.generateAudio
    if (request.seed !== undefined) body.seed = request.seed
    switch (request.mode) {
      case 'frames': {
        const frames: Array<Record<string, unknown>> = []
        if (request.firstFrame)
          frames.push({ ...(await this.asset(request.firstFrame, 'image')), frame_type: 'first_frame' })
        if (request.lastFrame)
          frames.push({ ...(await this.asset(request.lastFrame, 'image')), frame_type: 'last_frame' })
        if (frames.length) body.frame_images = frames
        break
      }
      case 'references':
        if (request.references.length) {
          body.input_references = await Promise.all(request.references.map((file) => this.asset(file, 'image')))
        }
        break
      case 'extend':
        if (!request.previousJobId) throw new NovaApiError('invalid_request', 'The clip to continue is missing.')
        body.previous_job_id = request.previousJobId
        break
      case 'edit':
      case 'upscale':
        body.input_references = [
          await this.asset(request.sourceVideo, 'video'),
          ...(await Promise.all(request.references.map((file) => this.asset(file, 'image'))))
        ]
        if (request.mode === 'upscale') {
          if (request.upscaleFactor) body.upscale_factor = request.upscaleFactor
          if (request.creativity !== undefined) body.creativity = request.creativity
        }
        break
      case 'avatar':
        body.input_references = [
          await this.asset(request.firstFrame, 'image'),
          await this.asset(request.audio, 'audio'),
          ...(request.sourceVideo ? [await this.asset(request.sourceVideo, 'video')] : [])
        ]
        break
    }
    const provider = providerOptions(request)
    if (provider) body.provider = provider
    return body
  }

  private async submit(job: NovaVideoJob): Promise<void> {
    const response = await this.json<{ id?: unknown; status?: unknown }>(
      '/videos',
      await this.videoBody(job.request),
      60_000
    )
    if (typeof response.id !== 'string') throw new NovaApiError('unavailable')
    this.nextPoll.set(job.id, Date.now() + 8_000)
    this.updateJob(job, {
      remoteId: response.id,
      status: response.status === 'in_progress' ? 'in_progress' : 'pending'
    })
  }

  private async storeUpload(upload: NovaMediaUpload | undefined): Promise<string | undefined> {
    if (!upload) return undefined
    const ext = path.extname(upload.name).slice(1).toLowerCase()
    if (!MEDIA_TYPES[ext]) throw new NovaApiError('invalid_request', 'This file type is not supported.')
    return this.writeFile('inputs', `${randomUUID()}.${ext}`, upload.bytes)
  }

  async createVideos(input: NovaVideoCreateInput): Promise<Result<NovaVideoJob[]>> {
    try {
      this.key()
      const { firstFrame, lastFrame, references = [], sourceVideo, sourceClip, audio, count = 1, ...rest } = input
      const mode = rest.mode
      const previous = mode === 'extend' ? this.store.videos.find((job) => job.id === rest.sourceJobId) : undefined
      if (mode === 'extend' && !previous?.remoteId) return { ok: false, error: 'not_found' }
      const usesReferences = mode === 'references' || mode === 'edit' || mode === 'upscale'
      const request: NovaStoredVideoRequest = {
        ...rest,
        options: rest.options ?? {},
        providers: rest.providers ?? [],
        firstFrame: mode === 'frames' || mode === 'avatar' ? await this.storeImage(firstFrame) : undefined,
        lastFrame: mode === 'frames' ? await this.storeImage(lastFrame) : undefined,
        references: usesReferences
          ? ((await Promise.all(references.map((ref) => this.storeImage(ref)))) as string[])
          : [],
        sourceVideo:
          mode === 'edit' || mode === 'upscale' || mode === 'avatar'
            ? sourceClip && this.owned(sourceClip)
              ? sourceClip
              : await this.storeUpload(sourceVideo)
            : undefined,
        audio: mode === 'avatar' ? await this.storeUpload(audio) : undefined,
        previousJobId: previous?.remoteId ?? undefined
      }
      const created: NovaVideoJob[] = []
      for (let i = 0; i < count; i++) {
        const seed = request.seed !== undefined && i > 0 ? (request.seed + i) % 4_294_967_296 : request.seed
        const job = this.newJob({ ...request, seed })
        try {
          await this.submit(job)
          created.push(job)
        } catch (error) {
          this.dropJob(job)
          if (created.length === 0) {
            await this.removeFiles(this.inputsOf(request).filter((file) => file !== sourceClip))
            return fail(error)
          }
          break
        }
      }
      return { ok: true, data: created }
    } catch (error) {
      return fail(error)
    }
  }

  private newJob(request: NovaStoredVideoRequest): NovaVideoJob {
    const now = Date.now()
    const job: NovaVideoJob = {
      id: randomUUID(),
      remoteId: null,
      status: 'submitting',
      request,
      createdAt: now,
      updatedAt: now,
      completedAt: null,
      error: null,
      files: [],
      favorite: false
    }
    this.store.videos.push(job)
    this.publish(job)
    return job
  }

  private dropJob(job: NovaVideoJob): void {
    this.store.videos = this.store.videos.filter((entry) => entry.id !== job.id)
    void this.save()
  }

  async retryVideo(id: string): Promise<Result<NovaVideoJob>> {
    const source = this.store.videos.find((job) => job.id === id)
    if (!source) return { ok: false, error: 'not_found' }
    try {
      this.key()
      const job = this.newJob({ ...source.request })
      try {
        await this.submit(job)
        return { ok: true, data: job }
      } catch (error) {
        this.dropJob(job)
        return fail(error)
      }
    } catch (error) {
      return fail(error)
    }
  }

  updateVideo(id: string, favorite: boolean): NovaVideoJob | null {
    const job = this.store.videos.find((entry) => entry.id === id)
    if (!job) return null
    this.updateJob(job, { favorite })
    return job
  }

  /** Input files a request uses: images, an uploaded or generated source video, avatar audio. */
  private inputsOf(request: NovaStoredVideoRequest): string[] {
    return [request.firstFrame, request.lastFrame, request.sourceVideo, request.audio, ...request.references].filter(
      (file): file is string => !!file
    )
  }

  async deleteVideos(ids: string[]): Promise<void> {
    const removed = this.store.videos.filter((job) => ids.includes(job.id))
    this.store.videos = this.store.videos.filter((job) => !ids.includes(job.id))
    // A clip another job was made from, or an input it shares, stays until that job goes too.
    const stillUsed = new Set(this.store.videos.flatMap((job) => [...this.inputsOf(job.request), ...job.files]))
    const files = removed.flatMap((job) => [...job.files, ...this.inputsOf(job.request)])
    await this.removeFiles(files.filter((file) => !stillUsed.has(file)))
    await this.save()
  }

  /** Polls each running job about every 10 s at first, then every 20 s; downloads finished clips. */
  private async pollJobs(): Promise<void> {
    if (this.polling) return
    const due = this.store.videos.filter(
      (job) => job.remoteId && ACTIVE.includes(job.status) && (this.nextPoll.get(job.id) ?? 0) <= Date.now()
    )
    if (due.length === 0) return
    this.polling = true
    try {
      for (const job of due) await this.pollJob(job)
    } finally {
      this.polling = false
    }
  }

  private async pollJob(job: NovaVideoJob): Promise<void> {
    const age = Date.now() - job.createdAt
    this.nextPoll.set(job.id, Date.now() + (age < 3 * 60_000 ? 10_000 : 20_000))
    let state: { status?: unknown; error?: unknown; unsigned_urls?: unknown }
    try {
      const response = await this.request(`/videos/${encodeURIComponent(job.remoteId!)}`, {}, 30_000)
      state = (await response.json()) as typeof state
    } catch (error) {
      if (error instanceof NovaApiError && error.code === 'not_found') {
        this.updateJob(job, { status: 'expired', error: null })
      }
      return
    }
    const status = state.status
    if (status === 'pending' || status === 'in_progress') {
      if (job.status !== status) this.updateJob(job, { status })
      return
    }
    if (status === 'failed' || status === 'cancelled' || status === 'expired') {
      const message = typeof state.error === 'string' ? state.error : errorMessage(state)
      this.updateJob(job, { status, error: message ?? null, completedAt: Date.now() })
      this.notify(job)
      return
    }
    if (status === 'completed') {
      const clips =
        Array.isArray(state.unsigned_urls) && state.unsigned_urls.length > 0 ? state.unsigned_urls.length : 1
      await this.download(job, clips)
    }
  }

  private async download(job: NovaVideoJob, clips: number): Promise<void> {
    this.updateJob(job, { status: 'downloading' })
    try {
      const files: string[] = []
      for (let index = 0; index < clips; index++) {
        const response = await this.request(
          `/videos/${encodeURIComponent(job.remoteId!)}/content?index=${index}`,
          {},
          10 * 60_000
        )
        files.push(
          await this.writeFile('videos', `${job.id}-${index}.mp4`, new Uint8Array(await response.arrayBuffer()))
        )
      }
      this.updateJob(job, { status: 'completed', files, completedAt: Date.now(), error: null })
      this.notify(job)
    } catch (error) {
      logger.warn('Could not download a finished NOVA video; will retry', error as Error)
      this.updateJob(job, { status: 'in_progress' })
    }
  }

  /** A system notification when a video finishes while NOVA Studio is in the background. */
  private notify(job: NovaVideoJob): void {
    if (BrowserWindow.getFocusedWindow() || !Notification.isSupported()) return
    const done = job.status === 'completed'
    new Notification({
      title: done ? 'NOVA Studio · Video ready' : 'NOVA Studio · Video failed',
      body: job.request.prompt.slice(0, 120) || job.request.modelName
    }).show()
  }

  // ─── Speech and transcription ────────────────────────────────────────

  listSpeech(): NovaSpeechItem[] {
    return [...this.store.speech].sort((a, b) => b.createdAt - a.createdAt)
  }

  /** Raw audio from NOVA: MP3 as served, or PCM wrapped as WAV. */
  async speechAudio(input: {
    model: string
    voice: string
    text: string
    speed: number
    format: 'mp3' | 'wav'
  }): Promise<Uint8Array> {
    const response = await this.request(
      '/audio/speech',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: input.model,
          input: input.text,
          ...(input.voice && { voice: input.voice }),
          response_format: input.format === 'wav' ? 'pcm' : 'mp3',
          ...(input.speed !== 1 && { speed: input.speed })
        })
      },
      180_000
    )
    const bytes = new Uint8Array(await response.arrayBuffer())
    if (bytes.length < 2) throw new NovaApiError('unavailable')
    if (input.format === 'mp3') return bytes
    const { sampleRate, channels } = pcmFormat(response.headers.get('content-type'))
    return pcmToWav(bytes, sampleRate, channels)
  }

  async synthesize(input: {
    model: string
    modelName: string
    voice: string
    text: string
    speed: number
    format: 'mp3' | 'wav'
  }): Promise<Result<NovaSpeechItem>> {
    try {
      const audio = await this.speechAudio(input)
      const id = randomUUID()
      const item: NovaSpeechItem = {
        id,
        ...input,
        path: await this.writeFile('speech', `${id}.${input.format}`, audio),
        createdAt: Date.now()
      }
      this.store.speech.push(item)
      await this.save()
      return { ok: true, data: item }
    } catch (error) {
      return fail(error)
    }
  }

  async deleteSpeech(ids: string[]): Promise<void> {
    const removed = this.store.speech.filter((item) => ids.includes(item.id))
    this.store.speech = this.store.speech.filter((item) => !ids.includes(item.id))
    await this.removeFiles(removed.map((item) => item.path))
    await this.save()
  }

  listTranscripts(): NovaTranscript[] {
    return [...this.store.transcripts].sort((a, b) => b.createdAt - a.createdAt)
  }

  /** Transcribes audio bytes; the file name's extension tells NOVA the format. */
  async transcribeAudio(
    model: string,
    audio: Uint8Array,
    fileName: string,
    language?: string
  ): Promise<{ text: string; language: string | null; durationSeconds: number | null }> {
    const form = new FormData()
    form.append('model', model)
    if (language) form.append('language', language)
    form.append('file', new Blob([new Uint8Array(audio)]), fileName)
    const response = await this.request('/audio/transcriptions', { method: 'POST', body: form }, 300_000)
    const body = (await response.json()) as { text?: unknown; language?: unknown; duration?: unknown }
    return {
      text: typeof body.text === 'string' ? body.text : '',
      language: typeof body.language === 'string' ? body.language : (language ?? null),
      durationSeconds: typeof body.duration === 'number' ? body.duration : null
    }
  }

  async transcribe(input: {
    model: string
    modelName: string
    language?: string
    sourceName: string
    audio: Uint8Array
  }): Promise<Result<NovaTranscript>> {
    try {
      const result = await this.transcribeAudio(input.model, input.audio, input.sourceName, input.language)
      const item: NovaTranscript = {
        id: randomUUID(),
        model: input.model,
        modelName: input.modelName,
        sourceName: input.sourceName,
        ...result,
        createdAt: Date.now()
      }
      this.store.transcripts.push(item)
      await this.save()
      return { ok: true, data: item }
    } catch (error) {
      return fail(error)
    }
  }

  async deleteTranscripts(ids: string[]): Promise<void> {
    this.store.transcripts = this.store.transcripts.filter((item) => !ids.includes(item.id))
    await this.save()
  }

  voiceSettings(): NovaVoiceSettings {
    return { ...this.store.settings }
  }

  async updateVoiceSettings(changes: Partial<NovaVoiceSettings>): Promise<NovaVoiceSettings> {
    this.store.settings = { ...this.store.settings, ...changes }
    await this.save()
    return this.voiceSettings()
  }

  // ─── Extractions and decisions ───────────────────────────────────────

  async extract(input: {
    model: string
    text: string
    fields: NovaExtractionField[]
    images: string[]
  }): Promise<Result<Record<string, unknown>>> {
    try {
      const fields: Record<string, Record<string, unknown>> = {}
      for (const field of input.fields) {
        const spec: Record<string, unknown> = { type: field.type }
        if (field.instructions) spec.instructions = field.instructions
        if (field.unit) spec.unit = field.unit
        if (field.type === 'list') spec.items = field.items ?? 'text'
        if (field.type === 'estimate') Object.assign(spec, { min: field.min ?? 0, max: field.max ?? 100 })
        fields[field.name] = spec
      }
      const assets: Record<string, unknown> = {}
      input.images.forEach((url, index) => {
        const image = decodeImageDataUrl(url)
        if (image)
          assets[`image_${index + 1}`] = {
            type: 'image',
            format: image.ext,
            data_base64: image.bytes.toString('base64')
          }
      })
      // Every asset must be named in the state, or the API rejects the request.
      const names = Object.keys(assets)
      const state =
        names.length === 0 ? input.text : [input.text, `Attached: ${names.join(', ')}`].filter(Boolean).join('\n\n')
      const body = await this.json('/extractions', {
        model: input.model,
        ...(state && { state }),
        fields,
        ...(names.length > 0 && { assets })
      })
      return { ok: true, data: body }
    } catch (error) {
      return fail(error)
    }
  }

  async decide(input: {
    model: string
    text: string
    questions: NovaDecisionQuestion[]
    images: string[]
  }): Promise<Result<Record<string, unknown>>> {
    try {
      const questions: Record<string, Record<string, unknown>> = {}
      for (const question of input.questions) {
        const spec: Record<string, unknown> = { type: question.type, instructions: question.instructions }
        const options = question.options.filter((option) => option.description.trim())
        if (question.type === 'choice') {
          spec.criteria = Object.fromEntries(options.map((option) => [option.key, option.description]))
        } else if (question.type === 'score' && options.length > 0) {
          spec.criteria = options.map((option) => option.description)
        } else if (question.type === 'noul' && options.length === 2) {
          spec.criteria = { true: options[0].description, false: options[1].description }
        }
        questions[question.key] = spec
      }
      const state =
        input.images.length > 0
          ? [input.text, ...input.images.map((url) => ({ type: 'image_url', image_url: { url } }))]
          : input.text
      return { ok: true, data: await this.json('/decisions', { model: input.model, state, questions }) }
    } catch (error) {
      return fail(error)
    }
  }
}
