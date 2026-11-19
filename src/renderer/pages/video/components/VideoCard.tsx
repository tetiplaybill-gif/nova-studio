import { AlertTriangle, Check, Loader2, Star } from 'lucide-react'
import { type FC, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { cn } from '@renderer/utils/style'
import type { NovaVideoJob } from '@shared/ipc/schemas/novaMedia'

import { RUNNING_STATUSES, useClipUrl } from '../useVideoJobs'

/** Typical render time: about a minute plus ten seconds per second of video. */
export function expectedSeconds(job: NovaVideoJob): number {
  return 60 + 10 * (job.request.duration ?? 8)
}

/** Progress shown while NOVA renders; the API reports no percentage, so it eases toward 95 %. */
export function renderProgress(job: NovaVideoJob, now: number): number {
  if (job.status === 'downloading') return 97
  const elapsed = (now - job.createdAt) / 1000
  return Math.min(95, Math.round((elapsed / expectedSeconds(job)) * 90))
}

export function useNow(active: boolean): number {
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    if (!active) return
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [active])
  return now
}

export function formatElapsed(ms: number): string {
  const seconds = Math.max(0, Math.round(ms / 1000))
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
}

interface Props {
  job: NovaVideoJob
  selecting: boolean
  selected: boolean
  onOpen: () => void
  onToggleSelect: () => void
  onFavorite: () => void
}

const VideoCard: FC<Props> = ({ job, selecting, selected, onOpen, onToggleSelect, onFavorite }) => {
  const { t } = useTranslation()
  const running = RUNNING_STATUSES.includes(job.status)
  const done = job.status === 'completed'
  const url = useClipUrl(done ? job.files[0] : undefined)
  const video = useRef<HTMLVideoElement>(null)
  const now = useNow(running)
  const [w, h] = (job.request.aspectRatio ?? '16:9').split(':').map(Number)

  return (
    <div
      className={cn(
        'group relative overflow-hidden rounded-lg border bg-card transition-colors',
        selected ? 'border-border-selected' : 'border-border-subtle hover:border-border'
      )}>
      <button
        type="button"
        onClick={selecting ? onToggleSelect : onOpen}
        aria-label={job.request.prompt || job.request.modelName}
        onMouseEnter={() => void video.current?.play().catch(() => {})}
        onMouseLeave={() => {
          video.current?.pause()
          if (video.current) video.current.currentTime = 0
        }}
        className="relative block w-full bg-background-subtle focus-visible:outline-none"
        style={{ aspectRatio: `${w || 16} / ${h || 9}` }}>
        {url && (
          <video ref={video} src={url} muted loop playsInline preload="metadata" className="size-full object-cover" />
        )}
        {running && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 p-3 text-muted-foreground text-xs">
            <Loader2 className="size-5 animate-spin" />
            <span>{t(`nova_media.video.status.${job.status}`)}</span>
            <span className="tabular-nums">{formatElapsed(now - job.createdAt)}</span>
            <div className="absolute inset-x-0 bottom-0 h-1 bg-muted">
              <div
                className="h-full bg-primary transition-[width] duration-1000"
                style={{ width: `${renderProgress(job, now)}%` }}
              />
            </div>
          </div>
        )}
        {!running && !done && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-1.5 p-3 text-center text-error text-xs">
            <AlertTriangle className="size-5" />
            <span>{t(`nova_media.video.status.${job.status}`)}</span>
          </div>
        )}
        {done && job.request.duration && (
          <span className="absolute right-1.5 bottom-1.5 rounded bg-popover px-1.5 py-0.5 text-[10px] text-popover-foreground tabular-nums">
            {job.request.duration}s
          </span>
        )}
      </button>
      {selecting && (
        <span
          aria-hidden
          className={cn(
            'pointer-events-none absolute top-1.5 left-1.5 flex size-5 items-center justify-center rounded-md border bg-popover',
            selected ? 'border-border-selected text-foreground' : 'border-border text-transparent'
          )}>
          <Check className="size-3.5" />
        </span>
      )}
      {!selecting && done && (
        <button
          type="button"
          aria-label={t(job.favorite ? 'nova_media.video.unfavorite' : 'nova_media.video.favorite')}
          aria-pressed={job.favorite}
          onClick={onFavorite}
          className={cn(
            'absolute top-1.5 right-1.5 flex size-6 items-center justify-center rounded-md bg-popover text-foreground transition-opacity focus-visible:opacity-100',
            job.favorite ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
          )}>
          <Star className={cn('size-3.5', job.favorite && 'fill-current text-warning')} />
        </button>
      )}
      <div className="flex flex-col gap-0.5 p-2">
        <p className="line-clamp-2 text-foreground text-xs" title={job.request.prompt}>
          {job.request.prompt || t(`nova_media.video.mode.${job.request.mode}`)}
        </p>
        <p className="truncate text-[11px] text-foreground-tertiary">
          {job.request.modelName}
          {job.request.resolution ? ` · ${job.request.resolution}` : ''}
        </p>
      </div>
    </div>
  )
}

export default VideoCard
