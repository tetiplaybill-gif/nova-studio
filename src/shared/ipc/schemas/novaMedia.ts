import * as z from 'zod'

import { defineRoute } from '../define'

/**
 * NOVA media IPC schemas: the model catalog by type, video generation jobs, speech synthesis,
 * transcription, extractions and decisions. Requests run in the main process with this computer's
 * NOVA API key; the renderer only sees results, local file paths and NOVA's own error messages.
 */

export const NOVA_MEDIA_MODEL_TYPES = [
  'chat',
  'image',
  'video',
  'speech',
  'transcription',
  'embeddings',
  'rerank',
  'decisions',
  'extractions'
] as const
export type NovaMediaModelType = (typeof NOVA_MEDIA_MODEL_TYPES)[number]

const videoCapabilitiesSchema = z.object({
  durations: z.array(z.number()),
  resolutions: z.array(z.string()),
  aspectRatios: z.array(z.string()),
  sizes: z.array(z.string()),
  /** Which frames an image can pin: `first_frame`, `last_frame`. Empty: text-to-video only. */
  frames: z.array(z.string()),
  audio: z.boolean(),
  seed: z.boolean(),
  /** Provider options the model accepts, such as `negativePrompt`. */
  passthrough: z.array(z.string()),
  /** Factor range an upscaling model accepts; null for generation models. */
  upscale: z.object({ min: z.number(), max: z.number() }).nullable(),
  /** Creativity levels an upscaling model accepts. */
  creativity: z.array(z.number()),
  /** Provider slugs serving the model; provider-specific options are keyed by them. */
  providers: z.array(z.string()),
  /** Customer prices keyed by OpenRouter's pricing SKU (per second, cents per second, per token …). */
  skus: z.record(z.string(), z.number())
})

const novaMediaModelSchema = z.object({
  id: z.string(),
  name: z.string(),
  type: z.enum(NOVA_MEDIA_MODEL_TYPES),
  endpoints: z.array(z.string()),
  inputModalities: z.array(z.string()),
  /** Customer prices in USD, per OpenRouter's pricing keys (per token, per image, per request …). */
  pricing: z.record(z.string(), z.number()),
  voices: z.array(z.string()),
  video: videoCapabilitiesSchema.nullable()
})

export type NovaVideoCapabilities = z.infer<typeof videoCapabilitiesSchema>
export type NovaMediaModel = z.infer<typeof novaMediaModelSchema>

export const NOVA_MEDIA_ERRORS = [
  'no_key',
  'insufficient_balance',
  'invalid_request',
  'rate_limited',
  'offline',
  'unavailable',
  'not_found'
] as const
const errorSchema = z.object({
  ok: z.literal(false),
  error: z.enum(NOVA_MEDIA_ERRORS),
  /** NOVA's own explanation, when the API gave one. */
  message: z.string().optional()
})
export type NovaMediaError = z.infer<typeof errorSchema>
const result = <T extends z.ZodType>(data: T) =>
  z.discriminatedUnion('ok', [z.object({ ok: z.literal(true), data }), errorSchema])

/** A data URL of an image the user picked: PNG, JPEG or WebP, at most 20 MB. */
const imageDataUrl = z
  .string()
  .max(28_000_000)
  .regex(/^data:image\/(png|jpeg|jpg|webp);base64,/)

/**
 * `text`: prompt only. `frames`: pin the first and/or last frame. `references`: images guide subject and style.
 * `extend`: continue or edit a finished clip on the same model. `edit`: change an uploaded video by instruction.
 * `upscale`: enlarge a video. `avatar`: a photo speaks a supplied audio track.
 */
export const VIDEO_MODES = ['text', 'frames', 'references', 'extend', 'edit', 'upscale', 'avatar'] as const
export type NovaVideoMode = (typeof VIDEO_MODES)[number]

/** Provider-specific option values, keyed by the model's allowed passthrough parameter names. */
const videoOptionsSchema = z.record(z.string().max(64), z.union([z.string().max(2000), z.number(), z.boolean()]))

const videoRequestBase = z.object({
  model: z.string().min(1).max(200),
  modelName: z.string().max(200),
  mode: z.enum(VIDEO_MODES),
  prompt: z.string().max(8000),
  negativePrompt: z.string().max(4000).optional(),
  duration: z.number().int().positive().max(600).optional(),
  resolution: z.string().max(20).optional(),
  aspectRatio: z.string().max(20).optional(),
  generateAudio: z.boolean().optional(),
  seed: z.number().int().min(0).max(4_294_967_295).optional(),
  upscaleFactor: z.number().positive().max(8).optional(),
  creativity: z.number().int().min(0).max(10).optional(),
  options: videoOptionsSchema.default({}),
  /** Provider slugs the options are sent under (from the model's catalog entry). */
  providers: z.array(z.string().max(64)).max(8).default([]),
  /** `extend`: the local job whose finished clip is continued. */
  sourceJobId: z.string().max(100).optional(),
  /** What the estimate showed when the job was submitted, in USD. */
  estimateUsd: z.number().nonnegative().optional()
})

/** An uploaded video or audio file: at most 20 MB, which keeps the request within NOVA's limit. */
const mediaUpload = z.object({
  name: z.string().min(1).max(300),
  bytes: z.instanceof(Uint8Array).refine((bytes) => bytes.byteLength > 0 && bytes.byteLength <= 20 * 1024 * 1024)
})
export type NovaMediaUpload = z.infer<typeof mediaUpload>

export const novaVideoCreateSchema = videoRequestBase.extend({
  firstFrame: imageDataUrl.optional(),
  lastFrame: imageDataUrl.optional(),
  references: z.array(imageDataUrl).max(4).default([]),
  /** `edit` / `upscale`: a video file, or a clip NOVA Studio generated (`sourceClip`). */
  sourceVideo: mediaUpload.optional(),
  sourceClip: z.string().max(4096).optional(),
  /** `avatar`: the speech the photo performs. */
  audio: mediaUpload.optional(),
  /** Variations to generate from the same settings; each is a separate job. */
  count: z.number().int().min(1).max(4).default(1)
})
export type NovaVideoCreateInput = z.input<typeof novaVideoCreateSchema>

/** A stored request: inputs live as local files so a job can be retried or reused. */
const storedVideoRequestSchema = videoRequestBase.extend({
  firstFrame: z.string().optional(),
  lastFrame: z.string().optional(),
  references: z.array(z.string()),
  sourceVideo: z.string().optional(),
  audio: z.string().optional(),
  /** `extend`: NOVA's id of the clip being continued. */
  previousJobId: z.string().optional()
})
export type NovaStoredVideoRequest = z.infer<typeof storedVideoRequestSchema>

export const VIDEO_JOB_STATUSES = [
  'submitting',
  'pending',
  'in_progress',
  'downloading',
  'completed',
  'failed',
  'cancelled',
  'expired'
] as const
export type NovaVideoJobStatus = (typeof VIDEO_JOB_STATUSES)[number]

const videoJobSchema = z.object({
  id: z.string(),
  remoteId: z.string().nullable(),
  status: z.enum(VIDEO_JOB_STATUSES),
  request: storedVideoRequestSchema,
  createdAt: z.number(),
  updatedAt: z.number(),
  completedAt: z.number().nullable(),
  error: z.string().nullable(),
  /** Local paths of the finished clips. */
  files: z.array(z.string()),
  favorite: z.boolean()
})
export type NovaVideoJob = z.infer<typeof videoJobSchema>

const speechItemSchema = z.object({
  id: z.string(),
  model: z.string(),
  modelName: z.string(),
  voice: z.string(),
  text: z.string(),
  speed: z.number(),
  format: z.enum(['mp3', 'wav']),
  path: z.string(),
  createdAt: z.number()
})
export type NovaSpeechItem = z.infer<typeof speechItemSchema>

const transcriptSchema = z.object({
  id: z.string(),
  model: z.string(),
  modelName: z.string(),
  sourceName: z.string(),
  language: z.string().nullable(),
  text: z.string(),
  durationSeconds: z.number().nullable(),
  createdAt: z.number()
})
export type NovaTranscript = z.infer<typeof transcriptSchema>

const voiceSettingsSchema = z.object({
  /** Model behind NOVA cloud dictation. */
  transcriptionModel: z.string(),
  /** Model and voice behind NOVA cloud read-aloud. */
  speechModel: z.string(),
  speechVoice: z.string()
})
export type NovaVoiceSettings = z.infer<typeof voiceSettingsSchema>

export const EXTRACTION_FIELD_TYPES = [
  'text',
  'number',
  'date',
  'time',
  'datetime',
  'duration',
  'list',
  'estimate'
] as const
const extractionFieldSchema = z.object({
  name: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[A-Za-z_][A-Za-z0-9_]*$/),
  type: z.enum(EXTRACTION_FIELD_TYPES),
  instructions: z.string().max(2000).optional(),
  unit: z.string().max(40).optional(),
  items: z.enum(['text', 'number', 'date']).optional(),
  min: z.union([z.number(), z.string()]).optional(),
  max: z.union([z.number(), z.string()]).optional()
})
export type NovaExtractionField = z.infer<typeof extractionFieldSchema>

export const DECISION_QUESTION_TYPES = ['noul', 'choice', 'score', 'box'] as const
const decisionQuestionSchema = z.object({
  key: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[A-Za-z_][A-Za-z0-9_]*$/),
  type: z.enum(DECISION_QUESTION_TYPES),
  instructions: z.string().min(1).max(2000),
  /** `choice`: option key → description. `score`: levels from lowest to highest. `noul`: optional true/false. `box`: none. */
  options: z.array(z.object({ key: z.string().max(64), description: z.string().max(1000) })).max(20)
})
export type NovaDecisionQuestion = z.infer<typeof decisionQuestionSchema>

/** Free-form JSON the API answered; the renderer only displays it. */
const jsonRecord = z.record(z.string(), z.unknown())

export const novaMediaRequestSchemas = {
  'nova.media.catalog': defineRoute({
    input: z.object({ refresh: z.boolean().optional() }),
    output: result(z.array(novaMediaModelSchema))
  }),
  'nova.media.enhance_prompt': defineRoute({
    input: z.object({ prompt: z.string().min(1).max(8000), kind: z.enum(['video', 'speech']) }),
    output: result(z.string())
  }),
  'nova.media.reveal': defineRoute({ input: z.object({ path: z.string().max(4096) }), output: z.void() }),
  'nova.media.save_as': defineRoute({
    input: z.object({ path: z.string().max(4096), suggestedName: z.string().max(200) }),
    output: z.object({ saved: z.boolean() })
  }),
  /** Saves a still captured from a clip (a PNG data URL) where the user picks. */
  'nova.media.save_image': defineRoute({
    input: z.object({ dataUrl: imageDataUrl, suggestedName: z.string().max(200) }),
    output: z.object({ saved: z.boolean() })
  }),
  'nova.media.read_file': defineRoute({
    input: z.object({ path: z.string().max(4096) }),
    output: z.instanceof(Uint8Array).nullable()
  }),

  'nova.video.list': defineRoute({ input: z.void(), output: z.array(videoJobSchema) }),
  'nova.video.create': defineRoute({ input: novaVideoCreateSchema, output: result(z.array(videoJobSchema)) }),
  'nova.video.retry': defineRoute({ input: z.object({ id: z.string() }), output: result(videoJobSchema) }),
  'nova.video.update': defineRoute({
    input: z.object({ id: z.string(), favorite: z.boolean() }),
    output: videoJobSchema.nullable()
  }),
  'nova.video.delete': defineRoute({ input: z.object({ ids: z.array(z.string()).max(500) }), output: z.void() }),
  /** Reads a stored input image back as a data URL, to reuse a job's settings. */
  'nova.video.input_image': defineRoute({
    input: z.object({ path: z.string().max(4096) }),
    output: z.string().nullable()
  }),

  'nova.speech.list': defineRoute({ input: z.void(), output: z.array(speechItemSchema) }),
  'nova.speech.synthesize': defineRoute({
    input: z.object({
      model: z.string().min(1).max(200),
      modelName: z.string().max(200),
      voice: z.string().max(200),
      text: z.string().min(1).max(5000),
      speed: z.number().min(0.25).max(4),
      format: z.enum(['mp3', 'wav'])
    }),
    output: result(speechItemSchema)
  }),
  'nova.speech.delete': defineRoute({ input: z.object({ ids: z.array(z.string()).max(500) }), output: z.void() }),

  'nova.transcription.list': defineRoute({ input: z.void(), output: z.array(transcriptSchema) }),
  'nova.transcription.run': defineRoute({
    input: z.object({
      model: z.string().min(1).max(200),
      modelName: z.string().max(200),
      language: z.string().max(20).optional(),
      sourceName: z.string().max(300),
      audio: z.instanceof(Uint8Array).refine((bytes) => bytes.byteLength > 0 && bytes.byteLength <= 25 * 1024 * 1024)
    }),
    output: result(transcriptSchema)
  }),
  'nova.transcription.delete': defineRoute({
    input: z.object({ ids: z.array(z.string()).max(500) }),
    output: z.void()
  }),

  'nova.voice.settings': defineRoute({ input: z.void(), output: voiceSettingsSchema }),
  'nova.voice.update_settings': defineRoute({ input: voiceSettingsSchema.partial(), output: voiceSettingsSchema }),

  'nova.extraction.run': defineRoute({
    input: z.object({
      model: z.string().min(1).max(200),
      text: z.string().max(200_000),
      fields: z.array(extractionFieldSchema).min(1).max(50),
      images: z.array(imageDataUrl).max(8).default([])
    }),
    output: result(jsonRecord)
  }),
  'nova.decision.run': defineRoute({
    input: z.object({
      model: z.string().min(1).max(200),
      text: z.string().max(200_000),
      questions: z.array(decisionQuestionSchema).min(1).max(30),
      images: z.array(imageDataUrl).max(8).default([])
    }),
    output: result(jsonRecord)
  })
}

export type NovaMediaEventSchemas = {
  'nova.video.job_updated': NovaVideoJob
}
