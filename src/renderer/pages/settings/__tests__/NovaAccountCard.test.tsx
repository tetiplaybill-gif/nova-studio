import '@testing-library/jest-dom/vitest'
import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import NovaAccountCard from '../NovaAccountCard'

const { provider, requestMock } = vi.hoisted(() => ({
  provider: { id: 'nova', apiKeys: [] as Array<{ id: string; label?: string }> },
  requestMock: vi.fn()
}))

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
vi.mock('@tanstack/react-router', () => ({ useNavigate: () => vi.fn() }))
vi.mock('@renderer/ipc', () => ({ ipcApi: { request: (...args: unknown[]) => requestMock(...args) } }))
vi.mock('@renderer/hooks/useProvider', () => ({ useProviderById: () => ({ provider: { ...provider } }) }))

const account = { email: 'buyer@example.com', name: 'Buyer', balanceUsd: 12.5, group: 'Retail', keyActive: true }

describe('NovaAccountCard', () => {
  beforeEach(() => {
    provider.apiKeys = []
    requestMock.mockReset()
  })

  it('shows the account as soon as the user signs in, without leaving Settings', async () => {
    requestMock.mockResolvedValue(null)
    const view = render(<NovaAccountCard />)
    expect(await screen.findByText('nova_ui.settings.signed_out')).toBeInTheDocument()

    requestMock.mockResolvedValue(account)
    provider.apiKeys = [{ id: 'k1', label: 'NOVA Studio' }]
    view.rerender(<NovaAccountCard />)

    expect(await screen.findByText('Buyer')).toBeInTheDocument()
  })

  it('goes back to signed out when the user signs out', async () => {
    provider.apiKeys = [{ id: 'k1', label: 'NOVA Studio' }]
    requestMock.mockResolvedValue(account)
    const view = render(<NovaAccountCard />)
    expect(await screen.findByText('Buyer')).toBeInTheDocument()

    requestMock.mockResolvedValue(null)
    provider.apiKeys = []
    view.rerender(<NovaAccountCard />)

    expect(await screen.findByText('nova_ui.settings.signed_out')).toBeInTheDocument()
  })
})
