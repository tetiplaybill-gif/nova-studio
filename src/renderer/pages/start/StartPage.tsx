import { useNavigate } from '@tanstack/react-router'
import { ArrowUp, AudioLines, Clapperboard, Image as ImageIcon, Loader2, MessageSquare, ScanSearch } from 'lucide-react'
import { type FC, type KeyboardEvent, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '@cherrystudio/ui'
import { NovaMark } from '@renderer/components/app/NovaMark'
import { writeChatDraftCache } from '@renderer/components/composer/variants/chat/chatDraftCache'
import { formatUsd, useNovaBalance } from '@renderer/hooks/useNovaMedia'
import { useTopicMutations, useTopics } from '@renderer/hooks/useTopic'
import { ipcApi } from '@renderer/ipc'
import { toast } from '@renderer/services/toast'
import { openExternalWebsite } from '@renderer/services/website'
import { cn } from '@renderer/utils/style'
import { NOVA_WEBSITE_URL } from '@shared/data/presets/nova'
import type { NovaVideoJob } from '@shared/ipc/schemas/novaMedia'
import { conversationRouteUrl } from '@shared/utils/conversationRoute'

import type { CreateTab } from '../create/CreatePage'

type Mode = 'chat' | 'image' | 'video' | 'speech' | 'analyze'

const MODES: Array<{ mode: Mode; icon: typeof MessageSquare }> = [
  { mode: 'chat', icon: MessageSquare },
  { mode: 'image', icon: ImageIcon },
  { mode: 'video', icon: Clapperboard },
  { mode: 'speech', icon: AudioLines },
  { mode: 'analyze', icon: ScanSearch }
]

const STARTERS: Array<{ id: 'reply' | 'animate' | 'transcribe' | 'invoice'; mode: Mode; tab?: CreateTab }> = [
  { id: 'reply', mode: 'chat' },
  { id: 'animate', mode: 'video' },
  { id: 'transcribe', mode: 'speech', tab: 'speech' },
  { id: 'invoice', mode: 'analyze' }
]

/** NOVA Studio's start screen: one box for anything, quick starts, and what you did last. */
const StartPage: FC = () => {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [mode, setMode] = useState<Mode>('chat')
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const { balance } = useNovaBalance()
  const { createTopic } = useTopicMutations()
  const { topics } = useTopics({ pageSize: 5 })
  const [videos, setVideos] = useState<NovaVideoJob[]>([])

  useEffect(() => {
    void ipcApi.request('nova.video.list').then((jobs) => setVideos(jobs.filter((job) => job.status === 'completed').slice(0, 3)))
  }, [])

  const openCreate = (tab: CreateTab, prompt?: string) =>
    void navigate({ to: '/app/create', search: { tab, ...(prompt ? { prompt } : {}) } })

  const go = async (target: Mode, prompt: string) => {
    if (target === 'chat') {
      setBusy(true)
      try {
        const topic = await createTopic({})
        // The new chat opens with the message ready; Enter sends it.
        writeChatDraftCache(topic.id, {
          text: prompt,
          tokens: [],
          files: [],
          knowledgeBaseIds: [],
          mentionedModelIds: [],
          modelMultiSelectMode: false
        })
        const url = new URL(conversationRouteUrl({ conversationType: 'assistant', conversationId: topic.id }), 'app://x')
        await navigate({ to: url.pathname, search: Object.fromEntries(url.searchParams.entries()) })
      } catch {
        toast.error(t('common.error'))
      } finally {
        setBusy(false)
      }
      return
    }
    if (target === 'image') return void navigate({ to: '/app/paintings' })
    openCreate(target, prompt.trim() || undefined)
  }

  const submit = () => {
    if (mode === 'chat' && !text.trim()) return
    void go(mode, text.trim())
  }
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault()
      submit()
    }
  }

  return (
    <div className="flex h-full min-h-0 w-full flex-col overflow-y-auto">
      <header className="flex shrink-0 items-center gap-3 px-7 py-4">
        <span className="font-[family-name:var(--font-family-display)] font-semibold text-[15px] tracking-wide">NOVA Studio</span>
        <div className="flex-1" />
        {balance !== null && (
          <button
            type="button"
            onClick={() => void openExternalWebsite(`${NOVA_WEBSITE_URL}/console`)}
            className="flex items-center gap-2 rounded-full border border-border px-3 py-1.5 text-[13px] transition-colors hover:bg-accent focus-visible:border-primary focus-visible:outline-none">
            <span className="text-muted-foreground">{t('nova_ui.home.balance')}</span>
            <span className="font-semibold">{formatUsd(balance)}</span>
            <span className="font-semibold text-link">{t('nova_ui.home.top_up')}</span>
          </button>
        )}
      </header>

      <section className="flex flex-col items-center gap-7 px-7 pt-12 pb-8">
        <NovaMark size={44} />
        <h1 className="m-0 text-center font-[family-name:var(--font-family-display)] font-semibold text-[40px] leading-tight tracking-tight">
          {t('nova_ui.home.title')}
        </h1>
        <div className="w-full max-w-[760px] rounded-2xl border border-border bg-card p-2.5 shadow-sm">
          <div role="tablist" aria-label={t('nova_ui.home.mode')} className="flex flex-wrap gap-0.5 px-0.5 pb-2">
            {MODES.map(({ mode: value, icon: Icon }) => (
              <button
                key={value}
                type="button"
                role="tab"
                aria-selected={mode === value}
                onClick={() => setMode(value)}
                className={cn(
                  'flex items-center gap-1.5 rounded-lg px-3 py-1.5 font-medium text-[13px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                  mode === value ? 'bg-accent text-foreground' : 'text-muted-foreground hover:text-foreground'
                )}>
                <Icon className="size-3.5" />
                {t(`nova_ui.home.modes.${value}`)}
              </button>
            ))}
          </div>
          <label htmlFor="nova-home-input" className="sr-only">
            {t('nova_ui.home.input_label')}
          </label>
          <textarea
            id="nova-home-input"
            rows={3}
            value={text}
            onChange={(event) => setText(event.target.value)}
            onKeyDown={onKeyDown}
            placeholder={t(`nova_ui.home.placeholder.${mode}`)}
            className="w-full resize-none border-0 bg-transparent px-2.5 py-1.5 text-base leading-relaxed outline-none placeholder:text-foreground-tertiary"
          />
          <div className="flex items-center gap-2 px-1 pt-1">
            <span className="text-foreground-tertiary text-xs">{t(`nova_ui.home.hint.${mode}`)}</span>
            <div className="flex-1" />
            <Button
              size="icon"
              aria-label={t('nova_ui.home.go')}
              disabled={busy || (mode === 'chat' && !text.trim())}
              onClick={submit}
              className="rounded-xl">
              {busy ? <Loader2 className="size-4 animate-spin" /> : <ArrowUp className="size-4" strokeWidth={2.2} />}
            </Button>
          </div>
        </div>
        <div className="grid w-full max-w-[760px] grid-cols-2 gap-2.5 md:grid-cols-4">
          {STARTERS.map((starter) => (
            <button
              key={starter.id}
              type="button"
              onClick={() =>
                starter.mode === 'chat'
                  ? (setMode('chat'), setText(t('nova_ui.home.starter.reply_prompt')))
                  : starter.tab
                    ? openCreate(starter.tab, undefined)
                    : void go(starter.mode, '')
              }
              className="flex flex-col gap-1.5 rounded-2xl border border-border bg-card p-3.5 text-left transition-colors hover:border-border-strong focus-visible:border-primary focus-visible:outline-none">
              <span className="font-semibold text-[13px]">{t(`nova_ui.home.starter.${starter.id}`)}</span>
              <span className="text-muted-foreground text-xs">{t(`nova_ui.home.starter.${starter.id}_hint`)}</span>
            </button>
          ))}
        </div>
      </section>

      <section className="flex flex-wrap justify-center gap-4 px-7 pb-8">
        <div className="flex min-w-[280px] max-w-[372px] flex-1 flex-col gap-1.5">
          <h2 className="m-0 mb-1 font-semibold text-[13px] text-muted-foreground">{t('nova_ui.home.recent_chats')}</h2>
          {topics.length === 0 ? (
            <p className="text-foreground-tertiary text-xs">{t('nova_ui.home.no_chats')}</p>
          ) : (
            topics.slice(0, 4).map((topic) => (
              <button
                key={topic.id}
                type="button"
                onClick={() => {
                  const url = new URL(conversationRouteUrl({ conversationType: 'assistant', conversationId: topic.id }), 'app://x')
                  void navigate({ to: url.pathname, search: Object.fromEntries(url.searchParams.entries()) })
                }}
                className="flex items-center justify-between gap-3 rounded-lg px-3 py-2.5 text-left text-[13px] transition-colors hover:bg-accent focus-visible:bg-accent focus-visible:outline-none">
                <span className="truncate">{topic.name || t('nova_ui.home.untitled')}</span>
                <span className="shrink-0 text-foreground-tertiary text-xs">
                  {new Date(topic.lastActivityAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                </span>
              </button>
            ))
          )}
        </div>
        <div className="flex min-w-[280px] max-w-[372px] flex-1 flex-col gap-1.5">
          <h2 className="m-0 mb-1 font-semibold text-[13px] text-muted-foreground">{t('nova_ui.home.recent_creations')}</h2>
          {videos.length === 0 ? (
            <p className="text-foreground-tertiary text-xs">{t('nova_ui.home.no_creations')}</p>
          ) : (
            videos.map((job) => (
              <button
                key={job.id}
                type="button"
                onClick={() => openCreate('video')}
                className="flex items-center gap-3 rounded-lg px-3 py-2.5 text-left text-[13px] transition-colors hover:bg-accent focus-visible:bg-accent focus-visible:outline-none">
                <Clapperboard className="size-4 shrink-0 text-muted-foreground" />
                <span className="truncate">{job.request.prompt || job.request.modelName}</span>
                <span className="ml-auto shrink-0 text-foreground-tertiary text-xs">{job.request.duration ? `${job.request.duration}s` : ''}</span>
              </button>
            ))
          )}
        </div>
      </section>
    </div>
  )
}

export default StartPage
