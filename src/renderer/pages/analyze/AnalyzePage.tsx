import { Copy, ImagePlus, Loader2, Plus, Sparkles, Trash2, X } from 'lucide-react'
import { type FC, type ReactNode, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  EmptyState,
  Input,
  SegmentedControl,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Textarea
} from '@cherrystudio/ui'
import { byEndpoint, novaErrorText, useNovaCatalog } from '@renderer/hooks/useNovaMedia'
import { ipcApi } from '@renderer/ipc'
import { toast } from '@renderer/services/toast'
import type { NovaDecisionQuestion, NovaExtractionField, NovaMediaModel } from '@shared/ipc/schemas/novaMedia'

import { readAsDataUrl } from '../video/useVideoJobs'
import {
  DECISION_PRESETS,
  DECISION_QUESTION_TYPES,
  EXTRACTION_FIELD_TYPES,
  EXTRACTION_PRESETS,
  toKey
} from './analyzePresets'

type Tab = 'extract' | 'decide'
type Answers = Record<string, Record<string, unknown>>

/** NOVA's extraction and decision models: typed fields and calibrated judgments from text and images. */
const AnalyzePage: FC = () => {
  const { t } = useTranslation()
  const [tab, setTab] = useState<Tab>('extract')
  const extractModels = useNovaCatalog(byEndpoint('/v1/extractions'))
  const decideModels = useNovaCatalog(byEndpoint('/v1/decisions'))
  const catalog = tab === 'extract' ? extractModels : decideModels
  const [modelId, setModelId] = useState('')
  const [text, setText] = useState('')
  const [images, setImages] = useState<string[]>([])
  const [fields, setFields] = useState<NovaExtractionField[]>(EXTRACTION_PRESETS.invoice)
  const [questions, setQuestions] = useState<NovaDecisionQuestion[]>(DECISION_PRESETS.triage)
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<{ tab: Tab; answers: Answers; raw: Record<string, unknown> } | null>(null)
  const imageInput = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!catalog.models.some((m) => m.id === modelId)) setModelId(catalog.models[0]?.id ?? '')
  }, [catalog.models, modelId])

  const run = async () => {
    setBusy(true)
    const response =
      tab === 'extract'
        ? await ipcApi.request('nova.extraction.run', { model: modelId, text, fields, images })
        : await ipcApi.request('nova.decision.run', { model: modelId, text, questions, images })
    setBusy(false)
    if (!response.ok) {
      toast.error(novaErrorText(t, response))
      return
    }
    setResult({ tab, answers: (response.data.answers ?? {}) as Answers, raw: response.data })
  }

  const items = tab === 'extract' ? fields : questions
  const ready = !!modelId && (text.trim() || images.length > 0) && items.length > 0

  return (
    <div className="flex h-full min-h-0 w-full flex-col">
      <div className="flex shrink-0 items-center gap-3 border-border-subtle border-b px-4 py-2.5">
        <SegmentedControl
          size="sm"
          options={[
            { value: 'extract', label: t('nova_media.analyze.tab.extract') },
            { value: 'decide', label: t('nova_media.analyze.tab.decide') }
          ]}
          value={tab}
          onValueChange={(next) => {
            setTab(next)
            setResult(null)
          }}
        />
        <span className="text-muted-foreground text-xs">{t(`nova_media.analyze.${tab}_hint`)}</span>
      </div>
      <div className="flex min-h-0 flex-1">
        <aside className="flex w-[420px] shrink-0 flex-col border-border-subtle border-r">
          <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4">
            <ModelSelect models={catalog.models} loading={catalog.loading} value={modelId} onChange={setModelId} />
            <div className="flex flex-col gap-1.5">
              <span className="font-medium text-xs">{t('nova_media.analyze.input')}</span>
              <Textarea.Input
                value={text}
                onValueChange={setText}
                rows={7}
                maxLength={200_000}
                placeholder={t(`nova_media.analyze.${tab}_placeholder`)}
                className="min-h-36 text-sm"
              />
              <div className="flex flex-wrap items-center gap-1.5">
                {images.map((image, index) => (
                  <div
                    key={index}
                    className="group relative size-14 overflow-hidden rounded-md border border-border-subtle">
                    <img src={image} alt="" className="size-full object-cover" />
                    <button
                      type="button"
                      aria-label={t('common.delete')}
                      onClick={() => setImages(images.filter((_, i) => i !== index))}
                      className="absolute top-0.5 right-0.5 hidden size-5 items-center justify-center rounded bg-popover group-hover:flex">
                      <X className="size-3" />
                    </button>
                  </div>
                ))}
                {images.length < 8 && (
                  <Button variant="outline" size="sm" onClick={() => imageInput.current?.click()}>
                    <ImagePlus className="size-3.5" />
                    {t('nova_media.analyze.add_image')}
                  </Button>
                )}
                <input
                  ref={imageInput}
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  className="hidden"
                  onChange={async (event) => {
                    const file = event.target.files?.[0]
                    event.target.value = ''
                    if (file) setImages([...images, await readAsDataUrl(file)])
                  }}
                />
              </div>
            </div>
            {tab === 'extract' ? (
              <FieldList fields={fields} onChange={setFields} />
            ) : (
              <QuestionList questions={questions} onChange={setQuestions} />
            )}
          </div>
          <div className="border-border-subtle border-t p-4">
            <Button
              variant="emphasis"
              size="lg"
              className="w-full"
              disabled={!ready || busy}
              onClick={() => void run()}>
              {busy ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
              {t(`nova_media.analyze.run_${tab}`)}
            </Button>
          </div>
        </aside>
        <main className="min-w-0 flex-1 overflow-y-auto p-4">
          {!result || result.tab !== tab ? (
            <div className="flex h-full items-center justify-center">
              <EmptyState title={t('nova_media.analyze.empty')} description={t(`nova_media.analyze.${tab}_empty`)} />
            </div>
          ) : (
            <Results answers={result.answers} raw={result.raw} image={images[0]} />
          )}
        </main>
      </div>
    </div>
  )
}

const ModelSelect: FC<{
  models: NovaMediaModel[]
  loading: boolean
  value: string
  onChange: (id: string) => void
}> = ({ models, loading, value, onChange }) => {
  const { t } = useTranslation()
  return (
    <div className="flex flex-col gap-1.5">
      <span className="font-medium text-xs">{t('nova_media.video.model')}</span>
      {models.length === 0 ? (
        <p className="rounded-lg bg-background-subtle p-3 text-muted-foreground text-xs">
          {loading ? t('nova_media.loading_models') : t('nova_media.analyze.no_models')}
        </p>
      ) : (
        <Select value={value} onValueChange={onChange}>
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
  )
}

const ListHeader: FC<{
  title: string
  presets: string[]
  presetLabel: (key: string) => string
  onPreset: (key: string) => void
  onAdd: () => void
}> = ({ title, presets, presetLabel, onPreset, onAdd }) => {
  const { t } = useTranslation()
  return (
    <div className="flex items-center justify-between">
      <span className="font-medium text-xs">{title}</span>
      <div className="flex items-center gap-1">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="sm">
              {t('nova_media.analyze.templates')}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {presets.map((key) => (
              <DropdownMenuItem key={key} onSelect={() => onPreset(key)}>
                {presetLabel(key)}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
        <Button variant="ghost" size="icon-sm" aria-label={t('nova_media.analyze.add')} onClick={onAdd}>
          <Plus className="size-4" />
        </Button>
      </div>
    </div>
  )
}

const Row: FC<{ onRemove: () => void; children: ReactNode }> = ({ onRemove, children }) => {
  const { t } = useTranslation()
  return (
    <div className="relative flex flex-col gap-1.5 rounded-lg border border-border-subtle bg-card p-2.5 pr-9">
      {children}
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label={t('common.delete')}
        onClick={onRemove}
        className="absolute top-1.5 right-1.5">
        <Trash2 className="size-3.5" />
      </Button>
    </div>
  )
}

const FieldList: FC<{ fields: NovaExtractionField[]; onChange: (fields: NovaExtractionField[]) => void }> = ({
  fields,
  onChange
}) => {
  const { t } = useTranslation()
  const update = (index: number, changes: Partial<NovaExtractionField>) =>
    onChange(fields.map((field, i) => (i === index ? { ...field, ...changes } : field)))
  return (
    <div className="flex flex-col gap-2">
      <ListHeader
        title={t('nova_media.analyze.fields')}
        presets={Object.keys(EXTRACTION_PRESETS)}
        presetLabel={(key) => t(`nova_media.analyze.preset.${key}`)}
        onPreset={(key) => onChange(EXTRACTION_PRESETS[key as keyof typeof EXTRACTION_PRESETS])}
        onAdd={() => onChange([...fields, { name: `field_${fields.length + 1}`, type: 'text' }])}
      />
      {fields.map((field, index) => (
        <Row key={index} onRemove={() => onChange(fields.filter((_, i) => i !== index))}>
          <div className="flex gap-1.5">
            <Input
              value={field.name}
              onChange={(event) => update(index, { name: toKey(event.target.value) })}
              aria-label={t('nova_media.analyze.field_name')}
              className="h-8 flex-1 font-mono text-xs"
            />
            <Select
              value={field.type}
              onValueChange={(type) => update(index, { type: type as NovaExtractionField['type'] })}>
              <SelectTrigger size="sm" className="w-28" aria-label={t('nova_media.analyze.type')}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {EXTRACTION_FIELD_TYPES.map((type) => (
                  <SelectItem key={type} value={type}>
                    {t(`nova_media.analyze.field_type.${type}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Input
            value={field.instructions ?? ''}
            onChange={(event) => update(index, { instructions: event.target.value || undefined })}
            placeholder={t('nova_media.analyze.instructions_placeholder')}
            className="h-8 text-xs"
          />
          {field.type === 'estimate' && (
            <div className="flex gap-1.5">
              <Input
                value={String(field.min ?? '')}
                onChange={(event) => update(index, { min: Number(event.target.value) })}
                placeholder={t('nova_media.analyze.min')}
                className="h-8 text-xs"
              />
              <Input
                value={String(field.max ?? '')}
                onChange={(event) => update(index, { max: Number(event.target.value) })}
                placeholder={t('nova_media.analyze.max')}
                className="h-8 text-xs"
              />
            </div>
          )}
        </Row>
      ))}
    </div>
  )
}

const QuestionList: FC<{
  questions: NovaDecisionQuestion[]
  onChange: (questions: NovaDecisionQuestion[]) => void
}> = ({ questions, onChange }) => {
  const { t } = useTranslation()
  const update = (index: number, changes: Partial<NovaDecisionQuestion>) =>
    onChange(questions.map((question, i) => (i === index ? { ...question, ...changes } : question)))
  return (
    <div className="flex flex-col gap-2">
      <ListHeader
        title={t('nova_media.analyze.questions')}
        presets={Object.keys(DECISION_PRESETS)}
        presetLabel={(key) => t(`nova_media.analyze.preset.${key}`)}
        onPreset={(key) => onChange(DECISION_PRESETS[key as keyof typeof DECISION_PRESETS])}
        onAdd={() =>
          onChange([
            ...questions,
            { key: `question_${questions.length + 1}`, type: 'noul', instructions: '', options: [] }
          ])
        }
      />
      {questions.map((question, index) => (
        <Row key={index} onRemove={() => onChange(questions.filter((_, i) => i !== index))}>
          <div className="flex gap-1.5">
            <Input
              value={question.key}
              onChange={(event) => update(index, { key: toKey(event.target.value) })}
              aria-label={t('nova_media.analyze.question_key')}
              className="h-8 flex-1 font-mono text-xs"
            />
            <Select
              value={question.type}
              onValueChange={(type) => update(index, { type: type as NovaDecisionQuestion['type'] })}>
              <SelectTrigger size="sm" className="w-32" aria-label={t('nova_media.analyze.type')}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {DECISION_QUESTION_TYPES.map((type) => (
                  <SelectItem key={type} value={type}>
                    {t(`nova_media.analyze.question_type.${type}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Input
            value={question.instructions}
            onChange={(event) => update(index, { instructions: event.target.value })}
            placeholder={t('nova_media.analyze.question_placeholder')}
            className="h-8 text-xs"
          />
          {(question.type === 'choice' || question.type === 'score') && (
            <div className="flex flex-col gap-1">
              {question.options.map((option, optionIndex) => (
                <div key={optionIndex} className="flex gap-1.5">
                  {question.type === 'choice' && (
                    <Input
                      value={option.key}
                      onChange={(event) =>
                        update(index, {
                          options: question.options.map((o, i) =>
                            i === optionIndex ? { ...o, key: toKey(event.target.value) } : o
                          )
                        })
                      }
                      aria-label={t('nova_media.analyze.option_key')}
                      className="h-7 w-24 font-mono text-xs"
                    />
                  )}
                  <Input
                    value={option.description}
                    onChange={(event) =>
                      update(index, {
                        options: question.options.map((o, i) =>
                          i === optionIndex ? { ...o, description: event.target.value } : o
                        )
                      })
                    }
                    placeholder={t(
                      question.type === 'score'
                        ? 'nova_media.analyze.level_placeholder'
                        : 'nova_media.analyze.option_placeholder'
                    )}
                    className="h-7 flex-1 text-xs"
                  />
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={t('common.delete')}
                    onClick={() => update(index, { options: question.options.filter((_, i) => i !== optionIndex) })}>
                    <X className="size-3" />
                  </Button>
                </div>
              ))}
              <Button
                variant="link"
                size="sm"
                className="self-start px-0"
                onClick={() =>
                  update(index, {
                    options: [...question.options, { key: `option_${question.options.length + 1}`, description: '' }]
                  })
                }>
                {t(question.type === 'score' ? 'nova_media.analyze.add_level' : 'nova_media.analyze.add_option')}
              </Button>
            </div>
          )}
        </Row>
      ))}
    </div>
  )
}

const percent = (value: unknown) => (typeof value === 'number' ? `${Math.round(value * 100)}%` : '')

/** One card per answer, drawn for its type; the raw response stays one click away. */
const Results: FC<{ answers: Answers; raw: Record<string, unknown>; image?: string }> = ({ answers, raw, image }) => {
  const { t } = useTranslation()
  const [showRaw, setShowRaw] = useState(false)
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <h3 className="font-medium text-sm">{t('nova_media.analyze.results')}</h3>
        <Button variant="ghost" size="sm" className="ml-auto" onClick={() => setShowRaw(!showRaw)}>
          {t(showRaw ? 'nova_media.analyze.hide_json' : 'nova_media.analyze.show_json')}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            void navigator.clipboard.writeText(JSON.stringify(raw, null, 2))
            toast.success(t('nova_media.copied'))
          }}>
          <Copy className="size-3.5" />
          {t('nova_media.analyze.copy_json')}
        </Button>
      </div>
      {showRaw ? (
        <pre className="select-text overflow-x-auto rounded-lg bg-background-subtle p-3 text-xs">
          {JSON.stringify(raw, null, 2)}
        </pre>
      ) : (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-3">
          {Object.entries(answers).map(([key, answer]) => (
            <div key={key} className="flex flex-col gap-2 rounded-lg border border-border-subtle bg-card p-3">
              <div className="flex items-center justify-between gap-2">
                <span className="font-mono text-muted-foreground text-xs">{key}</span>
                {answer.confidence !== undefined && (
                  <span className="text-foreground-tertiary text-xs">
                    {t('nova_media.analyze.confidence', { value: percent(answer.confidence) })}
                  </span>
                )}
              </div>
              <AnswerView answer={answer} image={image} />
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

const Bar: FC<{ label: string; value: number }> = ({ label, value }) => (
  <div className="flex items-center gap-2 text-xs">
    <span className="w-24 truncate text-muted-foreground">{label}</span>
    <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
      <div className="h-full bg-primary" style={{ width: `${Math.round(value * 100)}%` }} />
    </div>
    <span className="w-10 text-right tabular-nums">{Math.round(value * 100)}%</span>
  </div>
)

const AnswerView: FC<{ answer: Record<string, unknown>; image?: string }> = ({ answer, image }) => {
  const { t } = useTranslation()
  const probabilities = (answer.probabilities ?? {}) as Record<string, number>
  switch (answer.type) {
    case 'refusal':
      return <p className="text-warning text-sm">{t('nova_media.analyze.refused')}</p>
    case 'noul':
      return <Bar label={t('nova_media.analyze.probability_true')} value={Number(answer.noul ?? 0)} />
    case 'choice':
      return (
        <div className="flex flex-col gap-1">
          <p className="font-medium text-sm">{String(answer.choice)}</p>
          {Object.entries(probabilities).map(([key, value]) => (
            <Bar key={key} label={key} value={value} />
          ))}
        </div>
      )
    case 'score':
      return (
        <div className="flex flex-col gap-1">
          <p className="font-medium text-sm">{Number(answer.score).toFixed(2)}</p>
          {Object.entries(probabilities).map(([key, value]) => (
            <Bar key={key} label={t('nova_media.analyze.level', { level: key })} value={value} />
          ))}
        </div>
      )
    case 'box': {
      const box = answer.box as { top: number; bottom: number; left: number; right: number } | undefined
      if (!box) return null
      return image ? (
        <div className="relative">
          <img src={image} alt="" className="w-full rounded-md" />
          <div
            className="absolute rounded-sm border-2 border-primary"
            style={{
              top: `${box.top * 100}%`,
              left: `${box.left * 100}%`,
              width: `${(box.right - box.left) * 100}%`,
              height: `${(box.bottom - box.top) * 100}%`
            }}
          />
        </div>
      ) : (
        <p className="font-mono text-xs">{JSON.stringify(box)}</p>
      )
    }
    default: {
      const value = answer.value
      return (
        <p className="select-text break-words font-medium text-sm">
          {value === null || value === undefined
            ? t('nova_media.analyze.not_found')
            : Array.isArray(value)
              ? value.join(', ')
              : String(value)}
        </p>
      )
    }
  }
}

export default AnalyzePage
