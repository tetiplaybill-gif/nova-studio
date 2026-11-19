import { CheckSquare, Clapperboard, Trash2, X } from 'lucide-react'
import { type FC, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button, ConfirmDialog, EmptyState, SearchInput, SegmentedControl } from '@cherrystudio/ui'
import type { NovaVideoJob } from '@shared/ipc/schemas/novaMedia'

import { RUNNING_STATUSES } from '../useVideoJobs'
import VideoCard from './VideoCard'

const FILTERS = ['all', 'running', 'favorites', 'failed'] as const
type Filter = (typeof FILTERS)[number]

interface Props {
  jobs: NovaVideoJob[]
  onOpen: (job: NovaVideoJob) => void
  onFavorite: (job: NovaVideoJob) => void
  onDelete: (ids: string[]) => void
}

const VideoLibrary: FC<Props> = ({ jobs, onOpen, onFavorite, onDelete }) => {
  const { t } = useTranslation()
  const [filter, setFilter] = useState<Filter>('all')
  const [query, setQuery] = useState('')
  const [selecting, setSelecting] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [confirming, setConfirming] = useState(false)

  const shown = useMemo(() => {
    const words = query.trim().toLowerCase()
    return jobs.filter((job) => {
      if (filter === 'running' && !RUNNING_STATUSES.includes(job.status)) return false
      if (filter === 'favorites' && !job.favorite) return false
      if (filter === 'failed' && !['failed', 'cancelled', 'expired'].includes(job.status)) return false
      return !words || `${job.request.prompt} ${job.request.modelName}`.toLowerCase().includes(words)
    })
  }, [jobs, filter, query])
  const runningCount = jobs.filter((job) => RUNNING_STATUSES.includes(job.status)).length

  const toggle = (id: string) =>
    setSelected((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  const stopSelecting = () => {
    setSelecting(false)
    setSelected(new Set())
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-border-subtle border-b px-4 py-3">
        <SegmentedControl
          size="sm"
          options={FILTERS.map((value) => ({
            value,
            label:
              value === 'running' && runningCount
                ? `${t('nova_media.video.filter.running')} ${runningCount}`
                : t(`nova_media.video.filter.${value}`)
          }))}
          value={filter}
          onValueChange={setFilter}
        />
        <SearchInput
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onClear={() => setQuery('')}
          clearLabel={t('common.clear')}
          placeholder={t('nova_media.video.search')}
          className="w-56"
        />
        <div className="ml-auto flex items-center gap-1">
          {selecting ? (
            <>
              <span className="text-muted-foreground text-xs">
                {t('nova_media.video.selected', { count: selected.size })}
              </span>
              <Button variant="ghost" size="sm" onClick={() => setSelected(new Set(shown.map((job) => job.id)))}>
                {t('nova_media.video.select_all')}
              </Button>
              <Button
                variant="destructive"
                size="sm"
                disabled={selected.size === 0}
                onClick={() => setConfirming(true)}>
                <Trash2 className="size-3.5" />
                {t('common.delete')}
              </Button>
              <Button variant="ghost" size="icon-sm" aria-label={t('common.cancel')} onClick={stopSelecting}>
                <X className="size-4" />
              </Button>
            </>
          ) : (
            jobs.length > 0 && (
              <Button variant="ghost" size="sm" onClick={() => setSelecting(true)}>
                <CheckSquare className="size-3.5" />
                {t('nova_media.video.select')}
              </Button>
            )
          )}
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {shown.length === 0 ? (
          <div className="flex h-full items-center justify-center">
            <EmptyState
              icon={Clapperboard}
              title={t(jobs.length ? 'nova_media.video.empty_filter' : 'nova_media.video.empty_title')}
              description={jobs.length ? undefined : t('nova_media.video.empty_description')}
            />
          </div>
        ) : (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-3">
            {shown.map((job) => (
              <VideoCard
                key={job.id}
                job={job}
                selecting={selecting}
                selected={selected.has(job.id)}
                onOpen={() => onOpen(job)}
                onToggleSelect={() => toggle(job.id)}
                onFavorite={() => onFavorite(job)}
              />
            ))}
          </div>
        )}
      </div>
      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title={t('nova_media.video.delete_title', { count: selected.size })}
        description={t('nova_media.video.delete_description')}
        destructive
        confirmText={t('common.delete')}
        onConfirm={() => {
          onDelete([...selected])
          stopSelecting()
        }}
      />
    </div>
  )
}

export default VideoLibrary
