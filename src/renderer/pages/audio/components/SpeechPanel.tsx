import { Copy, Download, FolderOpen, Loader2, Play, Sparkles, Star, Trash2 } from 'lucide-react'
import { type FC, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import {
  Button,
  Combobox,
  EmptyState,
  SegmentedControl,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Slider,
  Textarea,
  Tooltip
} from '@cherrystudio/ui'
import { formatUsd, novaErrorText, useNovaCatalog } from '@renderer/hooks/useNovaMedia'
import { ipcApi } from '@renderer/ipc'
import { toast } from '@renderer/services/toast'
import type { NovaSpeechItem, NovaVoiceSettings } from '@shared/ipc/schemas/novaMedia'

import { useAudioUrl } from '../useAudioFile'

interface Props {
  settings: NovaVoiceSettings | null
  onSettings: (changes: Partial<NovaVoiceSettings>) => void
}

const SpeechPanel: FC<Props> = ({ settings, onSettings }) => {
  const { t } = useTranslation()
  const { models, loading } = useNovaCatalog('speech')
  const [items, setItems] = useState<NovaSpeechItem[]>([])
  const [modelId, setModelId] = useState('')
  const [voice, setVoice] = useState('')
  const [text, setText] = useState('')
  const [speed, setSpeed] = useState(1)
  const [format, setFormat] = useState<'mp3' | 'wav'>('mp3')
  const [busy, setBusy] = useState(false)
  const [enhancing, setEnhancing] = useState(false)
  const [playing, setPlaying] = useState<string | null>(null)

  useEffect(() => {
    void ipcApi.request('nova.speech.list').then(setItems)
  }, [])
  useEffect(() => {
    if (modelId || models.length === 0) return
    const preferred = models.find((m) => m.id === settings?.speechModel) ?? models[0]
    setModelId(preferred.id)
    setVoice(preferred.id === settings?.speechModel ? settings.speechVoice : (preferred.voices[0] ?? ''))
  }, [models, modelId, settings])

  const model = models.find((m) => m.id === modelId)
  const voices = useMemo(() => model?.voices ?? [], [model])
  // Speech is priced per input character.
  const perMillion = model?.pricing.prompt ? model.pricing.prompt * 1_000_000 : null
  const estimate = model?.pricing.prompt ? model.pricing.prompt * text.length : null

  const synthesize = async () => {
    if (!model) return
    setBusy(true)
    const result = await ipcApi.request('nova.speech.synthesize', {
      model: model.id,
      modelName: model.name,
      voice,
      text: text.trim(),
      speed,
      format
    })
    setBusy(false)
    if (!result.ok) {
      toast.error(novaErrorText(t, result))
      return
    }
    setItems((current) => [result.data, ...current])
    setPlaying(result.data.id)
  }

  const enhance = async () => {
    setEnhancing(true)
    const result = await ipcApi.request('nova.media.enhance_prompt', { prompt: text, kind: 'speech' })
    setEnhancing(false)
    if (result.ok) setText(result.data)
    else toast.error(novaErrorText(t, result))
  }

  const isDefault = settings?.speechModel === modelId && settings?.speechVoice === voice

  return (
    <div className="flex h-full min-h-0">
      <aside className="flex w-[360px] shrink-0 flex-col gap-4 overflow-y-auto border-border-subtle border-r p-4">
        <div className="flex flex-col gap-1.5">
          <span className="font-medium text-xs">{t('nova_media.video.model')}</span>
          {models.length === 0 ? (
            <p className="rounded-lg bg-background-subtle p-3 text-muted-foreground text-xs">
              {loading ? t('nova_media.loading_models') : t('nova_media.audio.no_speech_models')}
            </p>
          ) : (
            <Select
              value={modelId}
              onValueChange={(id) => {
                setModelId(id)
                setVoice(models.find((m) => m.id === id)?.voices[0] ?? '')
              }}>
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
          {perMillion !== null && (
            <span className="text-muted-foreground text-xs">
              {t('nova_media.audio.per_million_chars', { price: formatUsd(perMillion) })}
            </span>
          )}
        </div>
        <div className="flex flex-col gap-1.5">
          <span className="font-medium text-xs">{t('nova_media.audio.voice')}</span>
          {voices.length > 0 ? (
            <Combobox
              options={voices.map((value) => ({ value, label: value }))}
              value={voice}
              onChange={(value) => setVoice(typeof value === 'string' ? value : '')}
              searchable
              placeholder={t('nova_media.audio.pick_voice')}
            />
          ) : (
            <p className="text-foreground-tertiary text-xs">{t('nova_media.audio.default_voice')}</p>
          )}
        </div>
        <div className="flex flex-col gap-1.5">
          <span className="font-medium text-xs">{t('nova_media.audio.speed', { speed: speed.toFixed(2) })}</span>
          <Slider min={0.5} max={2} step={0.05} value={[speed]} onValueChange={([value]) => setSpeed(value)} />
        </div>
        <div className="flex flex-col gap-1.5">
          <span className="font-medium text-xs">{t('nova_media.audio.format')}</span>
          <SegmentedControl
            size="sm"
            options={[
              { value: 'mp3', label: 'MP3' },
              { value: 'wav', label: 'WAV' }
            ]}
            value={format}
            onValueChange={setFormat}
          />
        </div>
        <Button
          variant="outline"
          size="sm"
          disabled={!modelId || isDefault}
          onClick={() => onSettings({ speechModel: modelId, speechVoice: voice })}>
          <Star className="size-3.5" />
          {isDefault ? t('nova_media.audio.is_default_voice') : t('nova_media.audio.make_default_voice')}
        </Button>
        <p className="text-foreground-tertiary text-xs">{t('nova_media.audio.default_voice_hint')}</p>
      </aside>

      <main className="flex min-w-0 flex-1 flex-col">
        <div className="flex shrink-0 flex-col gap-2 border-border-subtle border-b p-4">
          <Textarea.Input
            value={text}
            onValueChange={setText}
            rows={6}
            maxLength={5000}
            placeholder={t('nova_media.audio.text_placeholder')}
            className="min-h-32 text-sm"
          />
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground text-xs tabular-nums">
              {text.length}/5000
              {estimate !== null && text.length > 0
                ? ` · ${t('nova_media.video.estimate', { price: formatUsd(estimate) })}`
                : ''}
            </span>
            <Button
              variant="ghost"
              size="sm"
              className="ml-auto"
              disabled={!text.trim() || enhancing}
              onClick={() => void enhance()}>
              {enhancing ? <Loader2 className="size-3.5 animate-spin" /> : <Sparkles className="size-3.5" />}
              {t('nova_media.audio.polish')}
            </Button>
            <Button variant="emphasis" disabled={!model || !text.trim() || busy} onClick={() => void synthesize()}>
              {busy ? <Loader2 className="size-4 animate-spin" /> : <Play className="size-4" />}
              {t('nova_media.audio.speak')}
            </Button>
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          {items.length === 0 ? (
            <div className="flex h-full items-center justify-center">
              <EmptyState
                title={t('nova_media.audio.speech_empty')}
                description={t('nova_media.audio.speech_empty_hint')}
              />
            </div>
          ) : (
            <ul className="flex flex-col gap-2">
              {items.map((item) => (
                <SpeechRow
                  key={item.id}
                  item={item}
                  autoPlay={playing === item.id}
                  onDelete={async () => {
                    await ipcApi.request('nova.speech.delete', { ids: [item.id] })
                    setItems((current) => current.filter((entry) => entry.id !== item.id))
                  }}
                />
              ))}
            </ul>
          )}
        </div>
      </main>
    </div>
  )
}

const SpeechRow: FC<{ item: NovaSpeechItem; autoPlay: boolean; onDelete: () => void }> = ({
  item,
  autoPlay,
  onDelete
}) => {
  const { t } = useTranslation()
  const url = useAudioUrl(item.path, item.format === 'mp3' ? 'audio/mpeg' : 'audio/wav')
  const name = `${item.text.slice(0, 30).replace(/\s+/g, '-')}.${item.format}`
  return (
    <li className="flex flex-col gap-2 rounded-lg border border-border-subtle bg-card p-3">
      <p className="line-clamp-3 select-text text-foreground text-sm">{item.text}</p>
      <div className="flex flex-wrap items-center gap-2">
        {url && <audio src={url} controls autoPlay={autoPlay} className="h-8 min-w-60 flex-1" />}
        <span className="text-foreground-tertiary text-xs">
          {item.modelName}
          {item.voice ? ` · ${item.voice}` : ''} · {item.speed}×
        </span>
        <div className="ml-auto flex items-center gap-0.5">
          <Tooltip content={t('nova_media.copy_text')}>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={t('nova_media.copy_text')}
              onClick={() => void navigator.clipboard.writeText(item.text)}>
              <Copy className="size-3.5" />
            </Button>
          </Tooltip>
          <Tooltip content={t('nova_media.save_as')}>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={t('nova_media.save_as')}
              onClick={() => void ipcApi.request('nova.media.save_as', { path: item.path, suggestedName: name })}>
              <Download className="size-3.5" />
            </Button>
          </Tooltip>
          <Tooltip content={t('nova_media.show_in_folder')}>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={t('nova_media.show_in_folder')}
              onClick={() => void ipcApi.request('nova.media.reveal', { path: item.path })}>
              <FolderOpen className="size-3.5" />
            </Button>
          </Tooltip>
          <Tooltip content={t('common.delete')}>
            <Button variant="ghost" size="icon-sm" aria-label={t('common.delete')} onClick={onDelete}>
              <Trash2 className="size-3.5" />
            </Button>
          </Tooltip>
        </div>
      </div>
    </li>
  )
}

export default SpeechPanel
