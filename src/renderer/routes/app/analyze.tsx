import { createFileRoute } from '@tanstack/react-router'

import AnalyzePage from '@renderer/pages/analyze/AnalyzePage'

export const Route = createFileRoute('/app/analyze')({
  component: AnalyzePage
})
