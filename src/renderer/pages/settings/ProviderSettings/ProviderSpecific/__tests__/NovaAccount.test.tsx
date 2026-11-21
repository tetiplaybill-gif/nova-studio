import { MockUsePreferenceUtils } from '@test-mocks/renderer/usePreference'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ComponentProps, ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { popup } from '@renderer/services/popup'
import { toast } from '@renderer/services/toast'

import NovaAccount from '../NovaAccount'

const { requestMock, provider, addApiKey, deleteApiKey, updateProvider, openWebsite } = vi.hoisted(() => ({
  requestMock: vi.fn(),
  provider: { id: 'nova', name: 'NOVA', apiKeys: [] as Array<{ id: string; label?: string; isEnabled: boolean }> },
  addApiKey: vi.fn().mockResolvedValue(undefined),
  deleteApiKey: vi.fn().mockResolvedValue(undefined),
  updateProvider: vi.fn().mockResolvedValue(undefined),
  openWebsite: vi.fn()
}))

vi.mock('@logger', () => ({
  loggerService: { withContext: () => ({ error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() }) }
}))
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
vi.mock('@renderer/ipc', () => ({ ipcApi: { request: (...args: unknown[]) => requestMock(...args) } }))
vi.mock('@renderer/hooks/useProvider', () => ({
  useProvider: () => ({ provider, addApiKey, deleteApiKey, updateProvider })
}))
vi.mock('@renderer/services/website', () => ({ openExternalWebsite: openWebsite }))
vi.mock('@renderer/assets/images/logo.png', () => ({ default: 'logo.png' }))
vi.mock('@cherrystudio/ui', () => ({
  Button: ({ children, type = 'button', ...props }: ComponentProps<'button'> & { variant?: string; size?: string }) => {
    const { variant: _variant, size: _size, ...rest } = props as Record<string, unknown>
    return (
      <button type={type} {...(rest as ComponentProps<'button'>)}>
        {children as ReactNode}
      </button>
    )
  },
  Input: (props: ComponentProps<'input'>) => <input {...props} />,
  Skeleton: () => <div data-testid="skeleton" />
}))

type Routes = Record<string, unknown | ((input: unknown) => unknown)>

function site(routes: Routes) {
  requestMock.mockImplementation(async (channel: string, input: unknown) => {
    if (!(channel in routes)) throw new Error(`unexpected channel ${channel}`)
    const answer = routes[channel]
    return typeof answer === 'function' ? answer(input) : answer
  })
}

const summary = (overrides = {}) => ({
  email: 'buyer@example.com',
  name: 'Buyer',
  balanceUsd: 12.5,
  group: 'Retail',
  keyActive: true,
  ...overrides
})

beforeEach(() => {
  vi.clearAllMocks()
  provider.apiKeys = []
})

describe('NovaAccount', () => {
  it('signs in with an authenticator code, stores this computer’s key and shows the balance', async () => {
    const signIn = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, error: 'otp_required' })
      .mockResolvedValueOnce({ ok: true, email: 'buyer@example.com', name: 'Buyer' })
    site({
      'nova.status': { signedIn: false },
      'nova.sign_in': signIn,
      'nova.create_key': { ok: true, key: 'sk-nova-abc' },
      'nova.summary': summary()
    })
    const user = userEvent.setup()
    render(<NovaAccount providerId="nova" />)

    await user.type(await screen.findByLabelText('settings.provider.nova.email'), 'buyer@example.com')
    await user.type(screen.getByLabelText('settings.provider.nova.password'), 'secret')
    await user.click(screen.getByText('settings.provider.nova.sign_in'))

    await user.type(await screen.findByLabelText('settings.provider.nova.otp'), '12a3456')
    await user.click(screen.getByText('settings.provider.nova.sign_in'))

    expect(signIn).toHaveBeenNthCalledWith(1, { email: 'buyer@example.com', password: 'secret', otp: '' })
    expect(signIn).toHaveBeenNthCalledWith(2, { email: 'buyer@example.com', password: 'secret', otp: '123456' })
    await waitFor(() => expect(addApiKey).toHaveBeenCalledWith('sk-nova-abc', 'NOVA Studio'))
    expect(updateProvider).toHaveBeenCalledWith({ isEnabled: true })
    expect(toast.success).toHaveBeenCalledWith('settings.provider.nova.key_ready')
    expect(await screen.findByText('$12.50')).toBeInTheDocument()
    expect(screen.getByText('Retail')).toBeInTheDocument()
    expect(requestMock.mock.calls.filter(([channel]) => channel === 'nova.create_key')).toHaveLength(1)
  })

  it('shows why sign-in failed', async () => {
    site({ 'nova.status': { signedIn: false }, 'nova.sign_in': { ok: false, error: 'wrong_credentials' } })
    const user = userEvent.setup()
    render(<NovaAccount providerId="nova" />)

    await user.type(await screen.findByLabelText('settings.provider.nova.email'), 'buyer@example.com')
    await user.type(screen.getByLabelText('settings.provider.nova.password'), 'nope')
    await user.click(screen.getByText('settings.provider.nova.sign_in'))

    expect(await screen.findByRole('alert')).toHaveTextContent('settings.provider.nova.error.wrong_credentials')
    expect(addApiKey).not.toHaveBeenCalled()
  })

  it('replaces this computer’s key when it was revoked on the website, keeping the user’s own keys', async () => {
    provider.apiKeys = [
      { id: 'old-nova', label: 'NOVA Studio', isEnabled: true },
      { id: 'manual', label: 'mine', isEnabled: true }
    ]
    site({
      'nova.status': { signedIn: true, email: 'buyer@example.com', name: 'Buyer' },
      'nova.summary': summary({ keyActive: false }),
      'nova.create_key': { ok: true, key: 'sk-nova-new' }
    })
    render(<NovaAccount providerId="nova" />)

    await waitFor(() => expect(addApiKey).toHaveBeenCalledWith('sk-nova-new', 'NOVA Studio'))
    await waitFor(() => expect(deleteApiKey).toHaveBeenCalledWith('old-nova'))
    expect(deleteApiKey).not.toHaveBeenCalledWith('manual')
  })

  it('asks the user to verify their email and lets them retry', async () => {
    const createKey = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, error: 'email_unverified' })
      .mockResolvedValueOnce({ ok: true, key: 'sk-nova-later' })
    site({
      'nova.status': { signedIn: true, email: 'buyer@example.com', name: 'Buyer' },
      'nova.summary': summary({ keyActive: false }),
      'nova.create_key': createKey
    })
    const user = userEvent.setup()
    render(<NovaAccount providerId="nova" />)

    expect(await screen.findByRole('alert')).toHaveTextContent('settings.provider.nova.error.email_unverified')
    await user.click(screen.getByText('settings.provider.nova.open_site'))
    expect(openWebsite).toHaveBeenCalledWith('https://cdkai.cc/console')

    await user.click(screen.getByText('settings.provider.nova.retry'))
    await waitFor(() => expect(addApiKey).toHaveBeenCalledWith('sk-nova-later', 'NOVA Studio'))
  })

  it('opens the top-up page and refreshes the balance on return', async () => {
    const getSummary = vi
      .fn()
      .mockResolvedValueOnce(summary())
      .mockResolvedValue(summary({ balanceUsd: 32.5 }))
    provider.apiKeys = [{ id: 'nova', label: 'NOVA Studio', isEnabled: true }]
    site({ 'nova.status': { signedIn: true, email: 'buyer@example.com', name: 'Buyer' }, 'nova.summary': getSummary })
    const user = userEvent.setup()
    render(<NovaAccount providerId="nova" />)

    await user.click(await screen.findByText('settings.provider.nova.topup'))
    expect(openWebsite).toHaveBeenCalledWith('https://cdkai.cc/console')
    window.dispatchEvent(new Event('focus'))
    expect(await screen.findByText('$32.50')).toBeInTheDocument()
  })

  it('signs out after confirmation and removes only the NOVA Studio key', async () => {
    vi.mocked(popup.confirm).mockResolvedValue(true)
    provider.apiKeys = [
      { id: 'nova', label: 'NOVA Studio', isEnabled: true },
      { id: 'manual', label: 'mine', isEnabled: true }
    ]
    site({
      'nova.status': { signedIn: true, email: 'buyer@example.com', name: 'Buyer' },
      'nova.summary': summary(),
      'nova.sign_out': undefined
    })
    const user = userEvent.setup()
    render(<NovaAccount providerId="nova" />)

    await user.click(await screen.findByText('settings.provider.nova.sign_out'))

    await waitFor(() => expect(deleteApiKey).toHaveBeenCalledWith('nova'))
    expect(deleteApiKey).not.toHaveBeenCalledWith('manual')
    expect(requestMock).toHaveBeenCalledWith('nova.sign_out')
    expect(await screen.findByLabelText('settings.provider.nova.email')).toBeInTheDocument()
    // Back to the welcome screen, nothing else reset.
    await waitFor(() =>
      expect(MockUsePreferenceUtils.getPreferenceValue('app.onboarding.provider_setup.status')).toBe('signed_out')
    )
    await waitFor(() => expect(screen.getByRole('button', { name: 'settings.provider.nova.sign_in' })).toBeEnabled())
  })
})
