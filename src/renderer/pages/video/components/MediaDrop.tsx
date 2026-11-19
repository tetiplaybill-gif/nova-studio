import { FileAudio, FileVideo, ImagePlus, X } from 'lucide-react'
import { type DragEvent, type FC, type ReactNode, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { cn } from '@renderer/utils/style'

const ACCEPT = {
  image: 'image/png,image/jpeg,image/webp',
  video: 'video/mp4,video/quicktime,video/webm',
  audio: 'audio/mpeg,audio/wav,audio/x-wav,audio/mp4,audio/ogg'
} as const

const MAX_BYTES = { image: 20, video: 20, audio: 20 }

interface Props {
  kind: keyof typeof ACCEPT
  label: string
  /** Image data URL, or the file name of a video or audio file. */
  value?: string
  onPick: (file: File) => void
  onClear: () => void
  className?: string
  children?: ReactNode
}

/** A drop zone for one input file; shows the image itself, or the file's name for video and audio. */
const MediaDrop: FC<Props> = ({ kind, label, value, onPick, onClear, className, children }) => {
  const { t } = useTranslation()
  const input = useRef<HTMLInputElement>(null)
  const [over, setOver] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const take = (file: File | undefined) => {
    if (!file) return
    if (!ACCEPT[kind].split(',').includes(file.type)) return setError(t('nova_media.video.input.wrong_type'))
    if (file.size > MAX_BYTES[kind] * 1024 * 1024)
      return setError(t('nova_media.video.input.too_large', { mb: MAX_BYTES[kind] }))
    setError(null)
    onPick(file)
  }

  const onDrop = (event: DragEvent) => {
    event.preventDefault()
    setOver(false)
    take(event.dataTransfer.files[0])
  }

  const Icon = kind === 'image' ? ImagePlus : kind === 'video' ? FileVideo : FileAudio
  return (
    <div className={cn('flex flex-col gap-1', className)}>
      <div
        role="button"
        tabIndex={0}
        aria-label={label}
        onClick={() => input.current?.click()}
        onKeyDown={(event) => (event.key === 'Enter' || event.key === ' ') && input.current?.click()}
        onDragOver={(event) => {
          event.preventDefault()
          setOver(true)
        }}
        onDragLeave={() => setOver(false)}
        onDrop={onDrop}
        className={cn(
          'group relative flex min-h-24 cursor-pointer items-center justify-center overflow-hidden rounded-lg border border-border border-dashed bg-background-subtle text-muted-foreground text-xs transition-colors hover:border-border-strong focus-visible:border-primary focus-visible:outline-none',
          over && 'border-primary',
          value && 'border-solid'
        )}>
        {value && kind === 'image' ? (
          <img src={value} alt={label} className="max-h-40 w-full object-contain" />
        ) : value ? (
          <div className="flex items-center gap-2 px-3 py-4 text-foreground">
            <Icon className="size-4 shrink-0" />
            <span className="truncate">{value}</span>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-1.5 px-3 py-4 text-center">
            <Icon className="size-5" />
            <span>{label}</span>
            <span className="text-foreground-tertiary">{t('nova_media.video.input.drop_hint')}</span>
          </div>
        )}
        {value && (
          <button
            type="button"
            aria-label={t('common.delete')}
            onClick={(event) => {
              event.stopPropagation()
              onClear()
            }}
            className="absolute top-1.5 right-1.5 flex size-6 items-center justify-center rounded-md bg-popover text-foreground opacity-0 shadow-sm transition-opacity focus-visible:opacity-100 group-hover:opacity-100">
            <X className="size-3.5" />
          </button>
        )}
        <input
          ref={input}
          type="file"
          accept={ACCEPT[kind]}
          className="hidden"
          onChange={(event) => {
            take(event.target.files?.[0])
            event.target.value = ''
          }}
        />
      </div>
      {children}
      {error && <p className="text-error text-xs">{error}</p>}
    </div>
  )
}

export default MediaDrop
