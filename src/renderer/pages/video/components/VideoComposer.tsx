import {
  ArrowUpFromLine,
  ChevronDown,
  Clapperboard,
  Dices,
  Film,
  Image as ImageIcon,
  Images,
  Loader2,
  Lock,
  Mic,
  Scissors,
  Sparkles,
  Type,
  Video
} from 'lucide-react'
import { type FC, type ReactNode, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import {
  Badge,
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  InputNumber,
  SegmentedControl,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Slider,
  Switch,
  Textarea,
  Tooltip
} from '@cherrystudio/ui'
import { formatUsd } from '@renderer/hooks/useNovaMedia'
import { cn } from '@renderer/utils/style'
import type { NovaMediaModel, NovaVideoJob, NovaVideoMode } from '@shared/ipc/schemas/novaMedia'
import { videoRatePerSecond } from '@shared/utils/novaVideo'

import { mediaSeconds, readAsDataUrl } from '../useVideoJobs'
import {
  CAMERA_MOVES,
  CAMERA_PHRASES,
  fitDraftToModel,
  missingInput,
  modelsForMode,
  negativePromptKey,
  STYLE_PHRASES,
  STYLE_PRESETS,
  togglePhrase,
  type VideoDraft
} from '../videoDraft'
import MediaDrop from './MediaDrop'

const MODES: Array<{ mode: NovaVideoMode; icon: typeof Type }> = [
  { mode: 'text', icon: Type },
  { mode: 'frames', icon: ImageIcon },
  { mode: 'references', icon: Images },
  { mode: 'extend', icon: Film },
  { mode: 'edit', icon: Scissors },
  { mode: 'upscale', icon: ArrowUpFromLine },
  { mode: 'avatar', icon: Mic }
]

/** Provider options NOVA Studio has a control for; other passthrough keys are left at the model default. */
const OPTION_CONTROLS: Record<
  string,
  { kind: 'bool' } | { kind: 'choice'; choices: string[] } | { kind: 'number'; min: number; max: number; step: number }
> = {
  enhancePrompt: { kind: 'bool' },
  prompt_enhancement: { kind: 'bool' },
  prompt_optimizer: { kind: 'bool' },
  prompt_extend: { kind: 'bool' },
  enable_prompt_expansion: { kind: 'bool' },
  watermark: { kind: 'bool' },
  aigc_watermark: { kind: 'bool' },
  draft: { kind: 'bool' },
  personGeneration: { kind: 'choice', choices: ['allow_adult', 'dont_allow', 'allow_all'] },
  cfg_scale: { kind: 'number', min: 0, max: 1, step: 0.1 },
  safety_tolerance: { kind: 'number', min: 0, max: 6, step: 1 }
}

interface Props {
  draft: VideoDraft
  onChange: (draft: VideoDraft) => void
  models: NovaMediaModel[]
  loadingModels: boolean
  /** Finished clips, for extending one. */
  clips: NovaVideoJob[]
  balance: number | null
  estimate: number | null
  sourceSeconds?: number
  onSourceSeconds: (seconds: number | undefined) => void
  submitting: boolean
  enhancing: boolean
  onEnhance: () => void
  onSubmit: () => void
}

const Section: FC<{ title: string; aside?: ReactNode; children: ReactNode }> = ({ title, aside, children }) => (
  <section className="flex flex-col gap-2">
    <div className="flex items-center justify-between gap-2">
      <h3 className="font-medium text-foreground text-xs">{title}</h3>
      {aside}
    </div>
    {children}
  </section>
)

const VideoComposer: FC<Props> = ({
  draft,
  onChange,
  models,
  loadingModels,
  clips,
  balance,
  estimate,
  sourceSeconds,
  onSourceSeconds,
  submitting,
  enhancing,
  onEnhance,
  onSubmit
}) => {
  const { t } = useTranslation()
  const [showNegative, setShowNegative] = useState(!!draft.negativePrompt)
  const [showMore, setShowMore] = useState(false)
  const modeModels = useMemo(() => modelsForMode(models, draft.mode), [models, draft.mode])
  const model = modeModels.find((m) => m.id === draft.modelId)
  const video = model?.video
  const negativeKey = negativePromptKey(model)
  const missing = missingInput(draft)
  const patch = (changes: Partial<VideoDraft>) => onChange({ ...draft, ...changes })

  const setMode = (mode: NovaVideoMode) => {
    const available = modelsForMode(models, mode)
    const next = available.find((m) => m.id === draft.modelId) ?? available[0]
    onChange(fitDraftToModel({ ...draft, mode }, next))
  }
  const setModel = (id: string) =>
    onChange(
      fitDraftToModel(
        draft,
        modeModels.find((m) => m.id === id)
      )
    )
  const setOption = (key: string, value: string | number | boolean | undefined) => {
    const options = { ...draft.options }
    if (value === undefined) delete options[key]
    else options[key] = value
    patch({ options })
  }

  const pickVideo = async (file: File) => {
    const bytes = new Uint8Array(await file.arrayBuffer())
    patch({ sourceVideo: { name: file.name, bytes } })
    const url = URL.createObjectURL(file)
    onSourceSeconds(await mediaSeconds(url))
    URL.revokeObjectURL(url)
  }

  const rate = video
    ? videoRatePerSecond(video.skus, draft.resolution, video.audio ? draft.generateAudio : undefined)
    : null
  const insufficient = estimate !== null && balance !== null && estimate > balance
  const takesPrompt = draft.mode !== 'upscale' && draft.mode !== 'avatar'

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto p-4">
        <Section title={t('nova_media.video.mode.title')}>
          <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label={t('nova_media.video.mode.title')}>
            {MODES.map(({ mode, icon: Icon }) => (
              <Tooltip key={mode} content={t(`nova_media.video.mode.${mode}_hint`)}>
                <button
                  type="button"
                  role="radio"
                  aria-checked={draft.mode === mode}
                  onClick={() => setMode(mode)}
                  className={cn(
                    'flex items-center gap-1.5 rounded-full border px-3 py-1.5 font-medium text-xs transition-colors focus-visible:border-primary focus-visible:outline-none',
                    draft.mode === mode
                      ? 'border-primary bg-primary/12 text-foreground'
                      : 'border-border text-muted-foreground hover:border-border-strong hover:text-foreground'
                  )}>
                  <Icon className="size-3.5" />
                  <span className="truncate">{t(`nova_media.video.mode.${mode}`)}</span>
                </button>
              </Tooltip>
            ))}
          </div>
        </Section>

        <Section
          title={t('nova_media.video.model')}
          aside={
            video && (
              <span className="text-muted-foreground text-xs">
                {rate !== null
                  ? t('nova_media.video.per_second', { price: formatUsd(rate) })
                  : t('nova_media.video.usage_priced')}
              </span>
            )
          }>
          {modeModels.length === 0 ? (
            <p className="rounded-lg bg-background-subtle p-3 text-muted-foreground text-xs">
              {loadingModels ? t('nova_media.loading_models') : t('nova_media.video.no_models')}
            </p>
          ) : (
            <Select value={draft.modelId} onValueChange={setModel}>
              <SelectTrigger className="w-full" aria-label={t('nova_media.video.model')}>
                <SelectValue placeholder={t('nova_media.video.pick_model')} />
              </SelectTrigger>
              <SelectContent>
                {modeModels.map((m) => (
                  <SelectItem key={m.id} value={m.id}>
                    {m.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          {video && (
            <div className="flex flex-wrap gap-1">
              {video.durations.length > 0 && (
                <Badge variant="secondary">
                  {t('nova_media.video.up_to_seconds', { seconds: Math.max(...video.durations) })}
                </Badge>
              )}
              {video.resolutions.length > 0 && <Badge variant="secondary">{video.resolutions.at(-1)}</Badge>}
              {video.audio && <Badge variant="secondary">{t('nova_media.video.badge.audio')}</Badge>}
              {video.frames.includes('last_frame') && (
                <Badge variant="secondary">{t('nova_media.video.badge.last_frame')}</Badge>
              )}
            </div>
          )}
        </Section>

        {draft.mode === 'frames' && (
          <Section title={t('nova_media.video.input.frames')}>
            <div className="grid grid-cols-2 gap-2">
              <MediaDrop
                kind="image"
                label={t('nova_media.video.input.first_frame')}
                value={draft.firstFrame}
                onPick={async (file) => patch({ firstFrame: await readAsDataUrl(file) })}
                onClear={() => patch({ firstFrame: undefined })}
              />
              {video?.frames.includes('last_frame') ? (
                <MediaDrop
                  kind="image"
                  label={t('nova_media.video.input.last_frame')}
                  value={draft.lastFrame}
                  onPick={async (file) => patch({ lastFrame: await readAsDataUrl(file) })}
                  onClear={() => patch({ lastFrame: undefined })}
                />
              ) : (
                <p className="flex items-center rounded-lg bg-background-subtle p-3 text-muted-foreground text-xs">
                  {t('nova_media.video.input.no_last_frame')}
                </p>
              )}
            </div>
          </Section>
        )}

        {(draft.mode === 'references' || draft.mode === 'edit') && (
          <Section
            title={t(
              draft.mode === 'edit' ? 'nova_media.video.input.extra_references' : 'nova_media.video.input.references'
            )}
            aside={<span className="text-muted-foreground text-xs">{draft.references.length}/4</span>}>
            <div className="grid grid-cols-4 gap-1.5">
              {draft.references.map((ref, index) => (
                <MediaDrop
                  key={index}
                  kind="image"
                  label={t('nova_media.video.input.reference')}
                  value={ref}
                  onPick={async (file) => {
                    const references = [...draft.references]
                    references[index] = await readAsDataUrl(file)
                    patch({ references })
                  }}
                  onClear={() => patch({ references: draft.references.filter((_, i) => i !== index) })}
                />
              ))}
              {draft.references.length < 4 && (
                <MediaDrop
                  kind="image"
                  label={t('nova_media.video.input.add')}
                  onPick={async (file) => patch({ references: [...draft.references, await readAsDataUrl(file)] })}
                  onClear={() => {}}
                />
              )}
            </div>
          </Section>
        )}

        {(draft.mode === 'edit' || draft.mode === 'upscale') && (
          <Section title={t('nova_media.video.input.source_video')}>
            <MediaDrop
              kind="video"
              label={t('nova_media.video.input.pick_video')}
              value={draft.sourceVideo?.name}
              onPick={(file) => void pickVideo(file)}
              onClear={() => {
                patch({ sourceVideo: undefined })
                onSourceSeconds(undefined)
              }}>
              <p className="text-foreground-tertiary text-xs">{t('nova_media.video.input.source_hint')}</p>
            </MediaDrop>
          </Section>
        )}

        {draft.mode === 'avatar' && (
          <Section title={t('nova_media.video.input.avatar')}>
            <div className="grid grid-cols-2 gap-2">
              <MediaDrop
                kind="image"
                label={t('nova_media.video.input.portrait')}
                value={draft.firstFrame}
                onPick={async (file) => patch({ firstFrame: await readAsDataUrl(file) })}
                onClear={() => patch({ firstFrame: undefined })}
              />
              <MediaDrop
                kind="audio"
                label={t('nova_media.video.input.speech_audio')}
                value={draft.audio?.name}
                onPick={async (file) =>
                  patch({ audio: { name: file.name, bytes: new Uint8Array(await file.arrayBuffer()) } })
                }
                onClear={() => patch({ audio: undefined })}
              />
            </div>
            <p className="text-foreground-tertiary text-xs">{t('nova_media.video.input.avatar_hint')}</p>
          </Section>
        )}

        {draft.mode === 'extend' && (
          <Section title={t('nova_media.video.input.clip_to_extend')}>
            {clips.length === 0 ? (
              <p className="rounded-lg bg-background-subtle p-3 text-muted-foreground text-xs">
                {t('nova_media.video.input.no_clips')}
              </p>
            ) : (
              <Select
                value={draft.sourceJobId ?? ''}
                onValueChange={(id) => {
                  const clip = clips.find((job) => job.id === id)
                  const clipModel = models.find((m) => m.id === clip?.request.model)
                  onChange(fitDraftToModel({ ...draft, sourceJobId: id }, clipModel))
                }}>
                <SelectTrigger className="w-full" aria-label={t('nova_media.video.input.clip_to_extend')}>
                  <SelectValue placeholder={t('nova_media.video.input.pick_clip')} />
                </SelectTrigger>
                <SelectContent>
                  {clips.map((job) => (
                    <SelectItem key={job.id} value={job.id}>
                      {(job.request.prompt || job.request.modelName).slice(0, 60)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            <p className="text-foreground-tertiary text-xs">{t('nova_media.video.input.extend_hint')}</p>
          </Section>
        )}

        {takesPrompt && (
          <Section
            title={t('nova_media.video.prompt')}
            aside={
              <div className="flex items-center gap-1">
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="sm">
                      <Clapperboard className="size-3.5" />
                      {t('nova_media.video.style.title')}
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    {STYLE_PRESETS.map((style) => (
                      <DropdownMenuItem
                        key={style}
                        onSelect={() => patch({ prompt: togglePhrase(draft.prompt, STYLE_PHRASES[style]) })}>
                        {t(`nova_media.video.style.${style}`)}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
                <Button variant="ghost" size="sm" disabled={!draft.prompt.trim() || enhancing} onClick={onEnhance}>
                  {enhancing ? <Loader2 className="size-3.5 animate-spin" /> : <Sparkles className="size-3.5" />}
                  {t('nova_media.enhance')}
                </Button>
              </div>
            }>
            <Textarea.Input
              value={draft.prompt}
              onValueChange={(prompt) => patch({ prompt })}
              rows={5}
              maxLength={4000}
              placeholder={t(`nova_media.video.prompt_placeholder.${draft.mode}`)}
              className="min-h-28 text-sm"
            />
            <div className="flex flex-wrap gap-1" aria-label={t('nova_media.video.camera.title')}>
              {CAMERA_MOVES.map((move) => {
                const active = draft.prompt.includes(CAMERA_PHRASES[move])
                return (
                  <button
                    key={move}
                    type="button"
                    aria-pressed={active}
                    onClick={() => patch({ prompt: togglePhrase(draft.prompt, CAMERA_PHRASES[move]) })}
                    className={cn(
                      'rounded-full border px-2 py-0.5 text-[11px] transition-colors focus-visible:border-primary focus-visible:outline-none',
                      active
                        ? 'border-border-selected bg-accent text-foreground'
                        : 'border-border-subtle text-muted-foreground hover:text-foreground'
                    )}>
                    <Video className="mr-1 inline size-3" />
                    {t(`nova_media.video.camera.${move}`)}
                  </button>
                )
              })}
            </div>
            {negativeKey &&
              (showNegative ? (
                <Textarea.Input
                  value={draft.negativePrompt}
                  onValueChange={(negativePrompt) => patch({ negativePrompt })}
                  rows={2}
                  maxLength={1000}
                  placeholder={t('nova_media.video.negative_placeholder')}
                  className="min-h-14 text-sm"
                />
              ) : (
                <Button variant="link" size="sm" className="self-start px-0" onClick={() => setShowNegative(true)}>
                  {t('nova_media.video.add_negative')}
                </Button>
              ))}
          </Section>
        )}

        {video && (
          <Section title={t('nova_media.video.settings')}>
            <div className="flex flex-col gap-3">
              {video.aspectRatios.length > 1 && (
                <Field label={t('nova_media.video.aspect_ratio')}>
                  <div className="flex flex-wrap gap-1">
                    {video.aspectRatios.map((ratio) => (
                      <AspectChip
                        key={ratio}
                        ratio={ratio}
                        active={draft.aspectRatio === ratio}
                        onClick={() => patch({ aspectRatio: ratio })}
                      />
                    ))}
                  </div>
                </Field>
              )}
              {video.resolutions.length > 1 && (
                <Field label={t('nova_media.video.resolution')}>
                  <SegmentedControl
                    size="sm"
                    options={video.resolutions.map((value) => ({ value, label: value }))}
                    value={draft.resolution}
                    onValueChange={(resolution) => patch({ resolution })}
                  />
                </Field>
              )}
              {video.durations.length > 1 && (
                <Field label={t('nova_media.video.duration_value', { seconds: draft.duration })}>
                  {video.durations.length <= 6 ? (
                    <SegmentedControl
                      size="sm"
                      options={video.durations.map((d) => ({ value: String(d), label: `${d}s` }))}
                      value={String(draft.duration)}
                      onValueChange={(d) => patch({ duration: Number(d) })}
                    />
                  ) : (
                    <Slider
                      min={Math.min(...video.durations)}
                      max={Math.max(...video.durations)}
                      step={1}
                      value={[draft.duration ?? video.durations[0]]}
                      onValueChange={([d]) => {
                        // Some models skip lengths: snap to the nearest one they offer.
                        const nearest = video.durations.reduce((a, b) => (Math.abs(b - d) < Math.abs(a - d) ? b : a))
                        patch({ duration: nearest })
                      }}
                    />
                  )}
                </Field>
              )}
              {video.upscale && (
                <Field label={t('nova_media.video.upscale_factor', { factor: draft.upscaleFactor })}>
                  <Slider
                    min={video.upscale.min}
                    max={video.upscale.max}
                    step={0.5}
                    value={[draft.upscaleFactor ?? video.upscale.min]}
                    onValueChange={([upscaleFactor]) => patch({ upscaleFactor })}
                  />
                </Field>
              )}
              {video.creativity.length > 1 && (
                <Field label={t('nova_media.video.creativity')}>
                  <SegmentedControl
                    size="sm"
                    options={video.creativity.map((c) => ({
                      value: String(c),
                      label: t(`nova_media.video.creativity_level.${c}`, String(c))
                    }))}
                    value={String(draft.creativity)}
                    onValueChange={(c) => patch({ creativity: Number(c) })}
                  />
                </Field>
              )}
              {video.audio && (
                <ToggleRow
                  label={t('nova_media.video.generate_audio')}
                  hint={t('nova_media.video.generate_audio_hint')}
                  checked={draft.generateAudio}
                  onChange={(generateAudio) => patch({ generateAudio })}
                />
              )}
              <button
                type="button"
                aria-expanded={showMore}
                onClick={() => setShowMore((open) => !open)}
                className="flex items-center gap-1 self-start rounded-md font-medium text-muted-foreground text-xs transition-colors hover:text-foreground focus-visible:text-foreground focus-visible:outline-none">
                <ChevronDown className={cn('size-3.5 transition-transform', showMore && 'rotate-180')} />
                {t('nova_ui.video.more_settings')}
              </button>
              {showMore && (
                <>
                  {draft.mode !== 'extend' && (
                    <Field label={t('nova_media.video.count')}>
                      <SegmentedControl
                        size="sm"
                        options={['1', '2', '3', '4'].map((value) => ({ value, label: value }))}
                        value={String(draft.count)}
                        onValueChange={(count) => patch({ count: Number(count) })}
                      />
                    </Field>
                  )}
                  {video.seed && (
                    <Field label={t('nova_media.video.seed')}>
                      <div className="flex items-center gap-2">
                        <InputNumber
                          size="small"
                          min={0}
                          max={4_294_967_295}
                          step={1}
                          value={draft.seed}
                          placeholder={t('nova_media.video.seed_random')}
                          onValueChange={(seed) => patch({ seed })}
                          className="flex-1"
                        />
                        <Tooltip content={t('nova_media.video.seed_roll')}>
                          <Button
                            variant="outline"
                            size="icon-sm"
                            aria-label={t('nova_media.video.seed_roll')}
                            onClick={() => patch({ seed: Math.floor(Math.random() * 4_294_967_295) })}>
                            <Dices className="size-3.5" />
                          </Button>
                        </Tooltip>
                        <Tooltip content={t('nova_media.video.seed_clear')}>
                          <Button
                            variant={draft.seed === null ? 'secondary' : 'outline'}
                            size="icon-sm"
                            aria-label={t('nova_media.video.seed_clear')}
                            onClick={() => patch({ seed: null })}>
                            <Lock className="size-3.5" />
                          </Button>
                        </Tooltip>
                      </div>
                    </Field>
                  )}
                  {video.passthrough
                    .filter((key) => OPTION_CONTROLS[key])
                    .map((key) => {
                      const control = OPTION_CONTROLS[key]
                      const label = t(`nova_media.video.option.${key}`)
                      const value = draft.options[key]
                      if (control.kind === 'bool') {
                        return (
                          <ToggleRow
                            key={key}
                            label={label}
                            checked={value === true}
                            onChange={(checked) => setOption(key, checked)}
                          />
                        )
                      }
                      if (control.kind === 'choice') {
                        return (
                          <Field key={key} label={label}>
                            <Select
                              value={typeof value === 'string' ? value : ''}
                              onValueChange={(v) => setOption(key, v)}>
                              <SelectTrigger size="sm" className="w-full">
                                <SelectValue placeholder={t('nova_media.video.option.model_default')} />
                              </SelectTrigger>
                              <SelectContent>
                                {control.choices.map((choice) => (
                                  <SelectItem key={choice} value={choice}>
                                    {t(`nova_media.video.option.${key}_${choice}`)}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </Field>
                        )
                      }
                      return (
                        <Field key={key} label={label}>
                          <InputNumber
                            size="small"
                            min={control.min}
                            max={control.max}
                            step={control.step}
                            value={typeof value === 'number' ? value : null}
                            placeholder={t('nova_media.video.option.model_default')}
                            onValueChange={(v) => setOption(key, v ?? undefined)}
                          />
                        </Field>
                      )
                    })}
                </>
              )}
            </div>
          </Section>
        )}
      </div>

      <div className="flex flex-col gap-2 border-border-subtle border-t p-4">
        <div className="flex items-center justify-between text-xs">
          <span className="text-muted-foreground">
            {estimate !== null
              ? t('nova_media.video.estimate', { price: formatUsd(estimate) })
              : model
                ? t('nova_media.video.estimate_unknown')
                : ''}
            {sourceSeconds && (draft.mode === 'edit' || draft.mode === 'upscale') ? ` · ${sourceSeconds}s` : ''}
          </span>
          {balance !== null && (
            <span className={cn(insufficient ? 'text-error' : 'text-muted-foreground')}>
              {t('nova_media.balance', { balance: formatUsd(balance) })}
            </span>
          )}
        </div>
        <Button
          variant="emphasis"
          size="lg"
          disabled={!model || missing !== null || submitting || insufficient}
          onClick={onSubmit}
          className="w-full">
          {submitting ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
          {missing && model
            ? t(`nova_media.video.missing.${missing}`)
            : t('nova_media.video.generate', { count: draft.count })}
        </Button>
      </div>
    </div>
  )
}

const Field: FC<{ label: string; children: ReactNode }> = ({ label, children }) => (
  <div className="flex flex-col gap-1.5">
    <span className="text-muted-foreground text-xs">{label}</span>
    {children}
  </div>
)

const ToggleRow: FC<{ label: string; hint?: string; checked: boolean; onChange: (checked: boolean) => void }> = ({
  label,
  hint,
  checked,
  onChange
}) => (
  <label className="flex cursor-pointer items-center justify-between gap-3">
    <span className="flex flex-col">
      <span className="text-foreground text-xs">{label}</span>
      {hint && <span className="text-foreground-tertiary text-[11px]">{hint}</span>}
    </span>
    <Switch checked={checked} onCheckedChange={onChange} />
  </label>
)

/** A ratio button with a small frame drawn in that shape. */
const AspectChip: FC<{ ratio: string; active: boolean; onClick: () => void }> = ({ ratio, active, onClick }) => {
  const [w, h] = ratio.split(':').map(Number)
  const scale = 14 / Math.max(w || 1, h || 1)
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        'flex items-center gap-1.5 rounded-md border px-2 py-1 text-[11px] transition-colors focus-visible:border-primary focus-visible:outline-none',
        active
          ? 'border-border-selected bg-accent text-foreground'
          : 'border-border-subtle text-muted-foreground hover:text-foreground'
      )}>
      <span
        className="inline-block rounded-[2px] border border-current"
        style={{ width: (w || 1) * scale, height: (h || 1) * scale }}
      />
      {ratio}
    </button>
  )
}

export default VideoComposer
