import { setTimeout as nextTimer } from 'node:timers/promises'

import { afterAll } from 'vitest'

if (typeof window !== 'undefined') {
  // React Testing Library unmounts in afterEach. Radix restores focus one timer turn later
  // and must dispatch its event while the originating jsdom window still owns the DOM.
  afterAll(async () => {
    await nextTimer(0)
  })
}
