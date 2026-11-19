import { Copy, FileAudio, Loader2, Mic, Square, Star, Trash2, Upload } from 'lucide-react'
import { type FC, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import {
  Button,
  EmptyState,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Tooltip
} from '@cherrystudio/ui'
import { novaErrorText, useNovaCatalog } from '@renderer/hooks/useNovaMedia'
import { ipcApi } from '@renderer/ipc'
import { toast } from '@renderer/services/toast'
import { cn } from '@renderer/utils/style'
import type { NovaTranscript, NovaVoiceSettings } from '@shared/ipc/schemas/novaMedia'

import { useRecorder } from '../useAudioFile'

const LANGUAGES = ['auto', 'zh', 'en', 'ja', 'ko', 'es', 'fr', 'de', 'ru', 'pt', 'it', 'vi', 'th', 'tr', 'ar'] as const
const MAX_BYTES = 25 * 1024 * 1024
const AUDIO_TYPES = /\.(mp3|wav|m4a|ogg|webm|flac|mp4|mpeg|mpga)$/i

interface Props {
  settings: NovaVoiceSettings | null
  onSettings: (changes: Partial<NovaVoiceSettings>) => void
}

const TranscribePanel: FC<Props> = ({ settings, onSettings }) => {
  const { t } = useTranslation()
  const { models, loading } = useNovaCatalog('transcription')
  const [items, setItems] = useState<NovaTranscript[]>([])
  const [modelId, setModelId] = useState('')
  const [language, setLanguage] = useState<string>('auto')
  const [busy, setBusy] = useState(false)
  const [over, setOver] = useState(false)
  const input = useRef<HTMLInputElement>(null)
  const recorder = useRecorder()

  useEffect(() => {
    void ipcApi.request('nova.transcription.list').then(setItems)
  }, [])
  useEffect(() => {
    if (modelId || models.length === 0) return
    setModelId((models.find((m) => m.id === settings?.transcriptionModel) ?? models[0]).id)
  }, [models, modelId, settings])
  const model = models.find((m) => m.id === modelId)

  const run = async (sourceName: string, audio: Uint8Array<ArrayBuffer>) => {
    if (!model) return
    if (audio.byteLength === 0) return
    if (audio.byteLength > MAX_BYTES) {
      toast.error(t('nova_media.audio.too_large'))
      return
    }
    setBusy(true)
    const result = await ipcApi.request('nova.transcription.run', {
      model: model.id,
      modelName: model.name,
      language: language === 'auto' ? undefined : language,
      sourceName,
      audio
    })
    setBusy(false)
    if (!result.ok) {
      toast.error(novaErrorText(t, result))
      return
    }
    setItems((current) => [result.data, ...current])
  }

  const takeFile = async (file: File | undefined) => {
    if (!file) return
    if (!AUDIO_TYPES.test(file.name)) {
      toast.error(t('nova_media.video.input.wrong_type'))
      return
    }
    await run(file.name, new Uint8Array(await file.arrayBuffer()))
  }

  const toggleRecording = async () => {
    if (recorder.recording) {
      const audio = await recorder.stop()
      await run(`${t('nova_media.audio.recording')} ${new Date().toLocaleTimeString()}.webm`, audio)
    } else {
      await recorder.start().catch(() => toast.error(t('nova_media.audio.mic_denied')))
    }
  }

  const isDefault = settings?.transcriptionModel === modelId

  return (
    <div className="flex h-full min-h-0">
      <aside className="flex w-[360px] shrink-0 flex-col gap-4 overflow-y-auto border-border-subtle border-r p-4">
        <div className="flex flex-col gap-1.5">
          <span className="font-medium text-xs">{t('nova_media.video.model')}</span>
          {models.length === 0 ? (
            <p className="rounded-lg bg-background-subtle p-3 text-muted-foreground text-xs">
              {loading ? t('nova_media.loading_models') : t('nova_media.audio.no_transcription_models')}
            </p>
          ) : (
            <Select value={modelId} onValueChange={setModelId}>
              <SelectTrigger className="w-full" aria-label={t('nova_media.video.model')}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {models.map((m) => (
                  <SelectItem key={m.id} value={m.id}>
                    {m.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>
        <div className="flex flex-col gap-1.5">
          <span className="font-medium text-xs">{t('nova_media.audio.language')}</span>
          <Select value={language} onValueChange={setLanguage}>
            <SelectTrigger className="w-full" aria-label={t('nova_media.audio.language')}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {LANGUAGES.map((code) => (
                <SelectItem key={code} value={code}>
                  {t(`nova_media.audio.lang.${code}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <Button
          variant="outline"
          size="sm"
          disabled={!modelId || isDefault}
          onClick={() => onSettings({ transcriptionModel: modelId })}>
          <Star className="size-3.5" />
          {isDefault ? t('nova_media.audio.is_default_dictation') : t('nova_media.audio.make_default_dictation')}
        </Button>
        <p className="text-foreground-tertiary text-xs">{t('nova_media.audio.default_dictation_hint')}</p>
      </aside>

      <main className="flex min-w-0 flex-1 flex-col">
        <div className="flex shrink-0 gap-3 border-border-subtle border-b p-4">
          <div
            role="button"
            tabIndex={0}
            aria-label={t('nova_media.audio.drop_audio')}
            onClick={() => input.current?.click()}
            onKeyDown={(event) => (event.key === 'Enter' || event.key === ' ') && input.current?.click()}
            onDragOver={(event) => {
              event.preventDefault()
              setOver(true)
            }}
            onDragLeave={() => setOver(false)}
            onDrop={(event) => {
              event.preventDefault()
              setOver(false)
              void takeFile(event.dataTransfer.files[0])
            }}
            className={cn(
              'flex flex-1 cursor-pointer flex-col items-center justify-center gap-1.5 rounded-lg border border-border border-dashed bg-background-subtle p-6 text-muted-foreground text-sm transition-colors hover:border-border-strong focus-visible:border-primary focus-visible:outline-none',
              over && 'border-primary'
            )}>
            {busy ? <Loader2 className="size-5 animate-spin" /> : <Upload className="size-5" />}
            <span>{busy ? t('nova_media.audio.transcribing') : t('nova_media.audio.drop_audio')}</span>
            <span className="text-foreground-tertiary text-xs">{t('nova_media.audio.drop_hint')}</span>
            <input
              ref={input}
              type="file"
              accept="audio/*,video/mp4"
              className="hidden"
              onChange={(event) => {
                void takeFile(event.target.files?.[0])
                event.target.value = ''
              }}
            />
          </div>
          <Button
            variant={recorder.recording ? 'destructive' : 'outline'}
            className="h-auto w-36 flex-col gap-1.5 py-4"
            disabled={!model || busy}
            onClick={() => void toggleRecording()}>
            {recorder.recording ? <Square className="size-5" /> : <Mic className="size-5" />}
            <span>{recorder.recording ? t('nova_media.audio.stop_recording') : t('nova_media.audio.record')}</span>
            {recorder.recording && (
              <span className="text-xs tabular-nums">
                {Math.floor(recorder.seconds / 60)}:{String(recorder.seconds % 60).padStart(2, '0')}
              </span>
            )}
          </Button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          {items.length === 0 ? (
            <div className="flex h-full items-center justify-center">
              <EmptyState
                title={t('nova_media.audio.transcripts_empty')}
                description={t('nova_media.audio.transcripts_empty_hint')}
              />
            </div>
          ) : (
            <ul className="flex flex-col gap-2">
              {items.map((item) => (
                <li key={item.id} className="flex flex-col gap-2 rounded-lg border border-border-subtle bg-card p-3">
                  <div className="flex items-center gap-2 text-foreground-tertiary text-xs">
                    <FileAudio className="size-3.5" />
                    <span className="truncate">{item.sourceName}</span>
                    <span>
                      · {item.modelName}
                      {item.language ? ` · ${item.language}` : ''}
                      {item.durationSeconds ? ` · ${Math.round(item.durationSeconds)}s` : ''}
                    </span>
                    <div className="ml-auto flex items-center gap-0.5">
                      <Tooltip content={t('nova_media.copy_text')}>
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          aria-label={t('nova_media.copy_text')}
                          onClick={() => {
                            void navigator.clipboard.writeText(item.text)
                            toast.success(t('nova_media.copied'))
                          }}>
                          <Copy className="size-3.5" />
                        </Button>
                      </Tooltip>
                      <Tooltip content={t('common.delete')}>
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          aria-label={t('common.delete')}
                          onClick={async () => {
                            await ipcApi.request('nova.transcription.delete', { ids: [item.id] })
                            setItems((current) => current.filter((entry) => entry.id !== item.id))
                          }}>
                          <Trash2 className="size-3.5" />
                        </Button>
                      </Tooltip>
                    </div>
                  </div>
                  <p className="select-text whitespace-pre-wrap text-foreground text-sm leading-relaxed">
                    {item.text || t('nova_media.audio.no_speech')}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </div>
      </main>
    </div>
  )
}

export default TranscribePanel
