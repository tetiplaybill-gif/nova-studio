import {
  ArrowUpFromLine,
  Camera,
  ChevronLeft,
  ChevronRight,
  Copy,
  Download,
  Film,
  FolderOpen,
  ImageIcon,
  Images,
  Loader2,
  Maximize,
  Pause,
  Play,
  RefreshCw,
  Repeat,
  Scissors,
  SlidersHorizontal,
  Star,
  Trash2,
  Volume2,
  VolumeX
} from 'lucide-react'
import { type FC, type ReactNode, useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import {
  Button,
  ConfirmDialog,
  Dialog,
  DialogContent,
  DialogTitle,
  SegmentedControl,
  Slider,
  Tooltip
} from '@cherrystudio/ui'
import { ipcApi } from '@renderer/ipc'
import { toast } from '@renderer/services/toast'
import { cn } from '@renderer/utils/style'
import type { NovaVideoJob } from '@shared/ipc/schemas/novaMedia'

import { captureFrame, RUNNING_STATUSES, useClipUrl } from '../useVideoJobs'
import { formatElapsed, renderProgress, useNow } from './VideoCard'

export type ViewerAction =
  | { kind: 'reuse' }
  | { kind: 'retry' }
  | { kind: 'extend' }
  | { kind: 'edit'; clip: string }
  | { kind: 'upscale'; clip: string }
  | { kind: 'frame'; image: string; as: 'first' | 'reference' }

interface Props {
  job: NovaVideoJob | null
  onClose: () => void
  onPrev?: () => void
  onNext?: () => void
  onAction: (job: NovaVideoJob, action: ViewerAction) => void
  onFavorite: (job: NovaVideoJob) => void
  onDelete: (job: NovaVideoJob) => void
}

const SPEEDS = ['0.5', '1', '1.5', '2'] as const
const FRAME = 1 / 24

const VideoViewer: FC<Props> = ({ job, onClose, onPrev, onNext, onAction, onFavorite, onDelete }) => {
  const { t } = useTranslation()
  const [clipIndex, setClipIndex] = useState(0)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const clip = job?.files[clipIndex] ?? job?.files[0]
  const url = useClipUrl(clip)
  const video = useRef<HTMLVideoElement>(null)
  const [playing, setPlaying] = useState(false)
  const [time, setTime] = useState(0)
  const [length, setLength] = useState(0)
  const [loop, setLoop] = useState(true)
  const [muted, setMuted] = useState(false)
  const [speed, setSpeed] = useState<(typeof SPEEDS)[number]>('1')
  const running = job ? RUNNING_STATUSES.includes(job.status) : false
  const now = useNow(running)

  useEffect(() => setClipIndex(0), [job?.id])
  useEffect(() => {
    if (video.current) video.current.playbackRate = Number(speed)
  }, [speed, url])

  const toggle = useCallback(() => {
    const v = video.current
    if (!v) return
    if (v.paused) void v.play()
    else v.pause()
  }, [])
  const step = useCallback((seconds: number) => {
    const v = video.current
    if (!v) return
    v.pause()
    v.currentTime = Math.min(v.duration || 0, Math.max(0, v.currentTime + seconds))
  }, [])

  useEffect(() => {
    if (!job) return
    const onKey = (event: KeyboardEvent) => {
      if ((event.target as HTMLElement)?.closest('input, textarea, [role="slider"]')) return
      if (event.key === ' ') {
        event.preventDefault()
        toggle()
      } else if (event.key === ',') step(-FRAME)
      else if (event.key === '.') step(FRAME)
      else if (event.key === 'ArrowLeft' && onPrev) onPrev()
      else if (event.key === 'ArrowRight' && onNext) onNext()
      else if (event.key.toLowerCase() === 'l') setLoop((value) => !value)
      else if (event.key.toLowerCase() === 'm') setMuted((value) => !value)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [job, onNext, onPrev, step, toggle])

  if (!job) return null
  const request = job.request
  const done = job.status === 'completed' && !!clip
  const name = `${(request.prompt || request.modelName).slice(0, 40).replace(/\s+/g, '-')}-${job.id.slice(0, 6)}`

  const currentFrame = () => (video.current ? captureFrame(video.current) : null)
  const saveFrame = async () => {
    const image = currentFrame()
    if (image) await ipcApi.request('nova.media.save_image', { dataUrl: image, suggestedName: `${name}.png` })
  }
  const copyPrompt = async () => {
    await navigator.clipboard.writeText(request.prompt)
    toast.success(t('nova_media.copied'))
  }

  const details: Array<[string, ReactNode]> = [
    [t('nova_media.video.model'), request.modelName],
    [t('nova_media.video.mode.title'), t(`nova_media.video.mode.${request.mode}`)],
    ...(request.duration ? [[t('nova_media.video.duration'), `${request.duration}s`] as [string, ReactNode]] : []),
    ...(request.resolution ? [[t('nova_media.video.resolution'), request.resolution] as [string, ReactNode]] : []),
    ...(request.aspectRatio ? [[t('nova_media.video.aspect_ratio'), request.aspectRatio] as [string, ReactNode]] : []),
    ...(request.upscaleFactor
      ? [[t('nova_media.video.upscale'), `${request.upscaleFactor}×`] as [string, ReactNode]]
      : []),
    ...(request.generateAudio !== undefined
      ? [
          [t('nova_media.video.generate_audio'), t(request.generateAudio ? 'common.yes' : 'common.no')] as [
            string,
            ReactNode
          ]
        ]
      : []),
    ...(request.seed !== undefined ? [[t('nova_media.video.seed'), String(request.seed)] as [string, ReactNode]] : []),
    ...(request.estimateUsd !== undefined
      ? [[t('nova_media.video.estimated_cost'), `$${request.estimateUsd.toFixed(2)}`] as [string, ReactNode]]
      : []),
    [t('nova_media.video.created'), new Date(job.createdAt).toLocaleString()],
    ...(job.completedAt
      ? [[t('nova_media.video.render_time'), formatElapsed(job.completedAt - job.createdAt)] as [string, ReactNode]]
      : [])
  ]

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="flex h-[88vh] w-[min(1280px,94vw)] max-w-none flex-col gap-0 overflow-hidden p-0 sm:max-w-none">
        <div className="flex shrink-0 items-center gap-2 border-border-subtle border-b px-4 py-2.5 pr-12">
          <DialogTitle className="truncate font-medium text-sm">
            {request.prompt || t(`nova_media.video.mode.${request.mode}`)}
          </DialogTitle>
          <div className="ml-auto flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={t('nova_media.video.previous')}
              disabled={!onPrev}
              onClick={onPrev}>
              <ChevronLeft className="size-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={t('nova_media.video.next')}
              disabled={!onNext}
              onClick={onNext}>
              <ChevronRight className="size-4" />
            </Button>
          </div>
        </div>
        <div className="flex min-h-0 flex-1">
          <div className="flex min-w-0 flex-1 flex-col bg-background-subtle">
            <div className="relative flex min-h-0 flex-1 items-center justify-center p-4">
              {done && url ? (
                <video
                  ref={video}
                  src={url}
                  autoPlay
                  loop={loop}
                  muted={muted}
                  playsInline
                  onClick={toggle}
                  onPlay={() => setPlaying(true)}
                  onPause={() => setPlaying(false)}
                  onTimeUpdate={(event) => setTime(event.currentTarget.currentTime)}
                  onLoadedMetadata={(event) => setLength(event.currentTarget.duration)}
                  className="max-h-full max-w-full rounded-md"
                />
              ) : running ? (
                <div className="flex w-64 flex-col items-center gap-3 text-muted-foreground text-sm">
                  <Loader2 className="size-6 animate-spin" />
                  <span>{t(`nova_media.video.status.${job.status}`)}</span>
                  <div className="h-1 w-full overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-full bg-primary transition-[width] duration-1000"
                      style={{ width: `${renderProgress(job, now)}%` }}
                    />
                  </div>
                  <span className="text-xs tabular-nums">
                    {formatElapsed(now - job.createdAt)} · {t('nova_media.video.keeps_running')}
                  </span>
                </div>
              ) : (
                <div className="flex max-w-md flex-col items-center gap-2 text-center text-sm">
                  <span className="text-error">{t(`nova_media.video.status.${job.status}`)}</span>
                  {job.error && <span className="text-muted-foreground text-xs">{job.error}</span>}
                </div>
              )}
            </div>
            {done && (
              <div className="flex shrink-0 flex-col gap-2 border-border-subtle border-t px-4 py-3">
                <Slider
                  min={0}
                  max={length || 1}
                  step={0.01}
                  value={[time]}
                  onValueChange={([value]) => {
                    if (video.current) video.current.currentTime = value
                  }}
                  aria-label={t('nova_media.video.player.seek')}
                />
                <div className="flex flex-wrap items-center gap-1">
                  <PlayerButton
                    label={t(playing ? 'nova_media.video.player.pause' : 'nova_media.video.player.play')}
                    onClick={toggle}>
                    {playing ? <Pause className="size-4" /> : <Play className="size-4" />}
                  </PlayerButton>
                  <PlayerButton label={t('nova_media.video.player.prev_frame')} onClick={() => step(-FRAME)}>
                    <ChevronLeft className="size-4" />
                  </PlayerButton>
                  <PlayerButton label={t('nova_media.video.player.next_frame')} onClick={() => step(FRAME)}>
                    <ChevronRight className="size-4" />
                  </PlayerButton>
                  <span className="px-1 text-muted-foreground text-xs tabular-nums">
                    {time.toFixed(2)} / {length.toFixed(2)}s
                  </span>
                  <div className="ml-auto flex items-center gap-1">
                    <SegmentedControl
                      size="sm"
                      options={SPEEDS.map((value) => ({ value, label: `${value}×` }))}
                      value={speed}
                      onValueChange={setSpeed}
                    />
                    <PlayerButton
                      label={t('nova_media.video.player.loop')}
                      active={loop}
                      onClick={() => setLoop(!loop)}>
                      <Repeat className="size-4" />
                    </PlayerButton>
                    <PlayerButton
                      label={t(muted ? 'nova_media.video.player.unmute' : 'nova_media.video.player.mute')}
                      onClick={() => setMuted(!muted)}>
                      {muted ? <VolumeX className="size-4" /> : <Volume2 className="size-4" />}
                    </PlayerButton>
                    <PlayerButton
                      label={t('nova_media.video.player.fullscreen')}
                      onClick={() => void video.current?.requestFullscreen()}>
                      <Maximize className="size-4" />
                    </PlayerButton>
                  </div>
                </div>
                {job.files.length > 1 && (
                  <SegmentedControl
                    size="sm"
                    options={job.files.map((_, index) => ({
                      value: String(index),
                      label: t('nova_media.video.output', { index: index + 1 })
                    }))}
                    value={String(clipIndex)}
                    onValueChange={(index) => setClipIndex(Number(index))}
                  />
                )}
              </div>
            )}
          </div>

          <aside className="flex w-80 shrink-0 flex-col border-border-subtle border-l">
            <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4">
              {request.prompt && (
                <section className="flex flex-col gap-1.5">
                  <div className="flex items-center justify-between">
                    <h4 className="font-medium text-xs">{t('nova_media.video.prompt')}</h4>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={t('nova_media.video.copy_prompt')}
                      onClick={() => void copyPrompt()}>
                      <Copy className="size-3.5" />
                    </Button>
                  </div>
                  <p className="select-text whitespace-pre-wrap text-foreground text-xs leading-relaxed">
                    {request.prompt}
                  </p>
                  {request.negativePrompt && (
                    <p className="select-text text-muted-foreground text-xs">
                      {t('nova_media.video.negative')}: {request.negativePrompt}
                    </p>
                  )}
                </section>
              )}
              <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-xs">
                {details.map(([label, value]) => (
                  <div key={label} className="contents">
                    <dt className="text-muted-foreground">{label}</dt>
                    <dd className="select-text truncate text-right text-foreground">{value}</dd>
                  </div>
                ))}
              </dl>

              <section className="flex flex-col gap-1.5">
                <h4 className="font-medium text-xs">{t('nova_media.video.next_steps')}</h4>
                <ActionButton
                  icon={SlidersHorizontal}
                  label={t('nova_media.video.action.reuse')}
                  onClick={() => onAction(job, { kind: 'reuse' })}
                />
                <ActionButton
                  icon={RefreshCw}
                  label={t('nova_media.video.action.retry')}
                  onClick={() => onAction(job, { kind: 'retry' })}
                />
                {done && (
                  <>
                    {request.mode !== 'upscale' && request.mode !== 'avatar' && (
                      <ActionButton
                        icon={Film}
                        label={t('nova_media.video.action.extend')}
                        onClick={() => onAction(job, { kind: 'extend' })}
                      />
                    )}
                    <ActionButton
                      icon={ImageIcon}
                      label={t('nova_media.video.action.frame_to_video')}
                      onClick={() => {
                        const image = currentFrame()
                        if (image) onAction(job, { kind: 'frame', image, as: 'first' })
                      }}
                    />
                    <ActionButton
                      icon={Images}
                      label={t('nova_media.video.action.frame_as_reference')}
                      onClick={() => {
                        const image = currentFrame()
                        if (image) onAction(job, { kind: 'frame', image, as: 'reference' })
                      }}
                    />
                    <ActionButton
                      icon={Scissors}
                      label={t('nova_media.video.action.edit')}
                      onClick={() => onAction(job, { kind: 'edit', clip })}
                    />
                    <ActionButton
                      icon={ArrowUpFromLine}
                      label={t('nova_media.video.action.upscale')}
                      onClick={() => onAction(job, { kind: 'upscale', clip })}
                    />
                  </>
                )}
              </section>
            </div>
            <div className="flex shrink-0 flex-wrap items-center gap-1 border-border-subtle border-t p-3">
              {done && (
                <>
                  <Button
                    variant="emphasis"
                    size="sm"
                    onClick={() =>
                      void ipcApi.request('nova.media.save_as', { path: clip, suggestedName: `${name}.mp4` })
                    }>
                    <Download className="size-3.5" />
                    {t('nova_media.save_as')}
                  </Button>
                  <IconAction
                    label={t('nova_media.show_in_folder')}
                    onClick={() => void ipcApi.request('nova.media.reveal', { path: clip })}>
                    <FolderOpen className="size-4" />
                  </IconAction>
                  <IconAction label={t('nova_media.video.save_frame')} onClick={() => void saveFrame()}>
                    <Camera className="size-4" />
                  </IconAction>
                  <IconAction
                    label={t(job.favorite ? 'nova_media.video.unfavorite' : 'nova_media.video.favorite')}
                    onClick={() => onFavorite(job)}>
                    <Star className={cn('size-4', job.favorite && 'fill-current text-warning')} />
                  </IconAction>
                </>
              )}
              <IconAction label={t('common.delete')} onClick={() => setConfirmDelete(true)} className="ml-auto">
                <Trash2 className="size-4" />
              </IconAction>
            </div>
          </aside>
        </div>
        <ConfirmDialog
          open={confirmDelete}
          onOpenChange={setConfirmDelete}
          title={t('nova_media.video.delete_title', { count: 1 })}
          description={t('nova_media.video.delete_description')}
          destructive
          confirmText={t('common.delete')}
          onConfirm={() => onDelete(job)}
        />
      </DialogContent>
    </Dialog>
  )
}

const PlayerButton: FC<{ label: string; active?: boolean; onClick: () => void; children: ReactNode }> = ({
  label,
  active,
  onClick,
  children
}) => (
  <Tooltip content={label}>
    <Button
      variant={active ? 'secondary' : 'ghost'}
      size="icon-sm"
      aria-label={label}
      aria-pressed={active}
      onClick={onClick}>
      {children}
    </Button>
  </Tooltip>
)

const IconAction: FC<{ label: string; onClick: () => void; className?: string; children: ReactNode }> = ({
  label,
  onClick,
  className,
  children
}) => (
  <Tooltip content={label}>
    <Button variant="ghost" size="icon-sm" aria-label={label} onClick={onClick} className={className}>
      {children}
    </Button>
  </Tooltip>
)

const ActionButton: FC<{ icon: typeof Film; label: string; onClick: () => void }> = ({
  icon: Icon,
  label,
  onClick
}) => (
  <Button variant="outline" size="sm" className="justify-start" onClick={onClick}>
    <Icon className="size-3.5" />
    {label}
  </Button>
)

export default VideoViewer
