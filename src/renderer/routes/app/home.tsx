import { createFileRoute } from '@tanstack/react-router'

import StartPage from '@renderer/pages/start/StartPage'

export const Route = createFileRoute('/app/home')({
  component: StartPage
})
