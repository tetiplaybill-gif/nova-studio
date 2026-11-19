import { type FC, useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { novaErrorText, useNovaBalance, useNovaCatalog } from '@renderer/hooks/useNovaMedia'
import { ipcApi } from '@renderer/ipc'
import { toast } from '@renderer/services/toast'
import type { NovaVideoJob } from '@shared/ipc/schemas/novaMedia'

import VideoComposer from './components/VideoComposer'
import VideoLibrary from './components/VideoLibrary'
import VideoViewer, { type ViewerAction } from './components/VideoViewer'
import { useVideoJobs } from './useVideoJobs'
import {
  draftEstimateUsd,
  EMPTY_DRAFT,
  fitDraftToModel,
  modelsForMode,
  negativePromptKey,
  type VideoDraft
} from './videoDraft'

const VideoPage: FC = () => {
  const { t } = useTranslation()
  const { models, loading } = useNovaCatalog('video')
  const { balance, refresh: refreshBalance } = useNovaBalance()
  const { jobs, remove, setFavorite } = useVideoJobs()
  const [draft, setDraft] = useState<VideoDraft>(EMPTY_DRAFT)
  const [sourceSeconds, setSourceSeconds] = useState<number | undefined>()
  const [submitting, setSubmitting] = useState(false)
  const [enhancing, setEnhancing] = useState(false)
  const [viewing, setViewing] = useState<string | null>(null)

  // Pick a model once the catalog arrives.
  useEffect(() => {
    if (draft.modelId || models.length === 0) return
    setDraft((current) => fitDraftToModel(current, modelsForMode(models, current.mode)[0]))
  }, [models, draft.modelId])

  const model = models.find((m) => m.id === draft.modelId)
  const estimate = draftEstimateUsd(draft, model, sourceSeconds)
  const clips = useMemo(() => jobs.filter((job) => job.status === 'completed' && job.remoteId), [jobs])
  const viewIndex = jobs.findIndex((job) => job.id === viewing)
  const viewed = viewIndex >= 0 ? jobs[viewIndex] : null

  const submit = async () => {
    if (!model) return
    setSubmitting(true)
    const negativeKey = negativePromptKey(model)
    const source = draft.sourceVideo
    const input = {
      model: model.id,
      modelName: model.name,
      mode: draft.mode,
      prompt: draft.prompt.trim(),
      negativePrompt: negativeKey && draft.negativePrompt.trim() ? draft.negativePrompt.trim() : undefined,
      duration: draft.duration,
      resolution: draft.resolution,
      aspectRatio: draft.aspectRatio,
      generateAudio: model.video?.audio ? draft.generateAudio : undefined,
      seed: draft.seed ?? undefined,
      upscaleFactor: draft.upscaleFactor,
      creativity: draft.creativity,
      options: {
        ...draft.options,
        ...(negativeKey && draft.negativePrompt.trim() && { [negativeKey]: draft.negativePrompt.trim() })
      },
      providers: model.video?.providers ?? [],
      sourceJobId: draft.sourceJobId,
      estimateUsd: estimate ?? undefined,
      firstFrame: draft.firstFrame,
      lastFrame: draft.lastFrame,
      references: draft.references,
      sourceVideo: source && 'bytes' in source ? source : undefined,
      sourceClip: source && 'clipPath' in source ? source.clipPath : undefined,
      audio: draft.audio,
      count: draft.mode === 'extend' ? 1 : draft.count
    }
    const result = await ipcApi.request('nova.video.create', input)
    setSubmitting(false)
    if (!result.ok) {
      toast.error(novaErrorText(t, result))
      return
    }
    toast.success(t('nova_media.video.started', { count: result.data.length }))
    void refreshBalance()
  }

  const enhance = async () => {
    setEnhancing(true)
    const result = await ipcApi.request('nova.media.enhance_prompt', { prompt: draft.prompt, kind: 'video' })
    setEnhancing(false)
    if (result.ok) setDraft((current) => ({ ...current, prompt: result.data }))
    else toast.error(novaErrorText(t, result))
  }

  /** Loads a job's settings and inputs back into the composer. */
  const reuse = useCallback(
    async (job: NovaVideoJob) => {
      const r = job.request
      const image = (path?: string) =>
        path ? ipcApi.request('nova.video.input_image', { path }) : Promise.resolve(null)
      const [firstFrame, lastFrame, ...references] = await Promise.all([
        image(r.firstFrame),
        image(r.lastFrame),
        ...r.references.map((path) => image(path))
      ])
      const audioBytes = r.audio ? await ipcApi.request('nova.media.read_file', { path: r.audio }) : null
      const next: VideoDraft = {
        ...EMPTY_DRAFT,
        mode: r.mode,
        prompt: r.prompt,
        negativePrompt: r.negativePrompt ?? '',
        duration: r.duration,
        resolution: r.resolution,
        aspectRatio: r.aspectRatio,
        generateAudio: r.generateAudio ?? true,
        seed: r.seed ?? null,
        upscaleFactor: r.upscaleFactor,
        creativity: r.creativity,
        options: r.options,
        firstFrame: firstFrame ?? undefined,
        lastFrame: lastFrame ?? undefined,
        references: references.filter((ref): ref is string => !!ref),
        sourceVideo: r.sourceVideo
          ? { name: r.sourceVideo.split(/[\\/]/).pop() ?? 'video.mp4', clipPath: r.sourceVideo }
          : undefined,
        audio:
          r.audio && audioBytes
            ? { name: r.audio.split(/[\\/]/).pop() ?? 'audio', bytes: new Uint8Array(audioBytes) }
            : undefined,
        sourceJobId: r.sourceJobId
      }
      setDraft(
        fitDraftToModel(
          next,
          models.find((m) => m.id === r.model)
        )
      )
    },
    [models]
  )

  const onAction = async (job: NovaVideoJob, action: ViewerAction) => {
    const switchTo = (changes: Partial<VideoDraft>) =>
      setDraft((current) => {
        const next = { ...current, ...changes }
        const available = modelsForMode(models, next.mode)
        const preferred = available.find((m) => m.id === (changes.modelId ?? current.modelId)) ?? available[0]
        return fitDraftToModel(next, preferred)
      })
    switch (action.kind) {
      case 'reuse':
        await reuse(job)
        break
      case 'retry': {
        const result = await ipcApi.request('nova.video.retry', { id: job.id })
        if (!result.ok) {
          toast.error(novaErrorText(t, result))
          return
        }
        toast.success(t('nova_media.video.started', { count: 1 }))
        void refreshBalance()
        break
      }
      case 'extend':
        switchTo({ mode: 'extend', sourceJobId: job.id, modelId: job.request.model, prompt: '' })
        break
      case 'edit':
        switchTo({
          mode: 'edit',
          sourceVideo: { name: t('nova_media.video.this_clip'), clipPath: action.clip },
          prompt: ''
        })
        setSourceSeconds(job.request.duration)
        break
      case 'upscale':
        switchTo({ mode: 'upscale', sourceVideo: { name: t('nova_media.video.this_clip'), clipPath: action.clip } })
        setSourceSeconds(job.request.duration)
        break
      case 'frame':
        if (action.as === 'first') switchTo({ mode: 'frames', firstFrame: action.image, lastFrame: undefined })
        else switchTo({ mode: 'references', references: [action.image] })
        break
    }
    setViewing(null)
  }

  return (
    <div className="flex h-full min-h-0 w-full">
      <aside className="flex w-[360px] shrink-0 flex-col border-border-subtle border-r">
        <VideoComposer
          draft={draft}
          onChange={setDraft}
          models={models}
          loadingModels={loading}
          clips={clips}
          balance={balance}
          estimate={estimate}
          sourceSeconds={sourceSeconds}
          onSourceSeconds={setSourceSeconds}
          submitting={submitting}
          enhancing={enhancing}
          onEnhance={() => void enhance()}
          onSubmit={() => void submit()}
        />
      </aside>
      <main className="min-w-0 flex-1">
        <VideoLibrary
          jobs={jobs}
          onOpen={(job) => setViewing(job.id)}
          onFavorite={(job) => void setFavorite(job.id, !job.favorite)}
          onDelete={(ids) => void remove(ids)}
        />
      </main>
      <VideoViewer
        job={viewed}
        onClose={() => setViewing(null)}
        onPrev={viewIndex > 0 ? () => setViewing(jobs[viewIndex - 1].id) : undefined}
        onNext={viewIndex >= 0 && viewIndex < jobs.length - 1 ? () => setViewing(jobs[viewIndex + 1].id) : undefined}
        onAction={(job, action) => void onAction(job, action)}
        onFavorite={(job) => void setFavorite(job.id, !job.favorite)}
        onDelete={(job) => {
          void remove([job.id])
          setViewing(null)
        }}
      />
    </div>
  )
}

export default VideoPage
