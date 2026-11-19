import { createFileRoute } from '@tanstack/react-router'

import CreatePage, { CREATE_TABS, type CreateTab } from '@renderer/pages/create/CreatePage'

export const Route = createFileRoute('/app/create')({
  validateSearch: (search: Record<string, unknown>): { tab?: CreateTab; prompt?: string } => ({
    tab: CREATE_TABS.includes(search.tab as CreateTab) ? (search.tab as CreateTab) : undefined,
    prompt: typeof search.prompt === 'string' ? search.prompt.slice(0, 4000) : undefined
  }),
  component: CreateRoute
})

function CreateRoute() {
  const { tab = 'video', prompt } = Route.useSearch()
  const navigate = Route.useNavigate()
  return (
    <CreatePage
      tab={tab}
      prompt={prompt}
      onTabChange={(next) => void navigate({ search: { tab: next }, replace: true })}
    />
  )
}
