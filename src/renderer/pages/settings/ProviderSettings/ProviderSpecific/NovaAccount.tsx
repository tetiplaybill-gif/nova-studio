import { RefreshCw } from 'lucide-react'
import type { FC, FormEvent } from 'react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button, Input, Skeleton } from '@cherrystudio/ui'
import { usePreference } from '@data/hooks/usePreference'
import { loggerService } from '@logger'
import NovaLogo from '@renderer/assets/images/logo.png'
import { useProvider } from '@renderer/hooks/useProvider'
import { ipcApi } from '@renderer/ipc'
import { oauthCardClasses } from '@renderer/pages/settings/ProviderSettings/primitives/ProviderSettingsPrimitives'
import { popup } from '@renderer/services/popup'
import { toast } from '@renderer/services/toast'
import { openExternalWebsite } from '@renderer/services/website'
import { cn } from '@renderer/utils/style'
import { NOVA_KEY_LABEL, NOVA_ORIGIN } from '@shared/data/presets/nova'
import type { NovaAccountSummary, NovaKeyResult, NovaSignInResult } from '@shared/ipc/schemas/nova'

const logger = loggerService.withContext('NovaAccount')

type SignInError = Extract<NovaSignInResult, { ok: false }>['error']
type KeyError = Extract<NovaKeyResult, { ok: false }>['error']

/** Written out in full so the translation tools can see every key. */
const ERROR_MESSAGES: Record<SignInError | KeyError, string> = {
  invalid_input: 'settings.provider.nova.error.invalid_input',
  otp_required: 'settings.provider.nova.error.otp_required',
  wrong_credentials: 'settings.provider.nova.error.wrong_credentials',
  too_many_attempts: 'settings.provider.nova.error.too_many_attempts',
  offline: 'settings.provider.nova.error.offline',
  unavailable: 'settings.provider.nova.error.unavailable',
  email_unverified: 'settings.provider.nova.error.email_unverified',
  key_limit: 'settings.provider.nova.error.key_limit',
  signed_out: 'settings.provider.nova.error.signed_out'
}

interface NovaAccountProps {
  providerId: string
}

/**
 * The NOVA account card on the NOVA provider page: sign in with a cdkai.cc account, get this
 * computer's API key automatically, see the balance and open the top-up page.
 */
const NovaAccount: FC<NovaAccountProps> = ({ providerId }) => {
  const { provider, updateProvider, addApiKey, deleteApiKey } = useProvider(providerId)
  const { t } = useTranslation()

  const [account, setAccount] = useState<{ email: string; name: string } | null | undefined>(undefined)
  const [summary, setSummary] = useState<NovaAccountSummary | null>(null)
  const [loadingSummary, setLoadingSummary] = useState(false)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [otp, setOtp] = useState('')
  const [needsOtp, setNeedsOtp] = useState(false)
  const [signInError, setSignInError] = useState<SignInError | null>(null)
  const [keyError, setKeyError] = useState<KeyError | null>(null)
  const [busy, setBusy] = useState(false)
  const syncing = useRef(false)
  const installedHere = useRef(false)
  const toppingUp = useRef(false)

  const novaKeys = provider?.apiKeys.filter((key) => key.label === NOVA_KEY_LABEL) ?? []

  // The profile shows the NOVA account's name until the user picks their own.
  const [userName, setUserName] = usePreference('app.user.name')
  const [, setProviderSetupStatus] = usePreference('app.onboarding.provider_setup.status')
  useEffect(() => {
    if (account?.name && !userName?.trim()) void setUserName(account.name)
  }, [account?.name, setUserName, userName])

  /** Gets a fresh key for this computer and stores it in place of any earlier NOVA Studio key. */
  const installKey = useCallback(async (): Promise<boolean> => {
    if (syncing.current) return false
    syncing.current = true
    try {
      const result = await ipcApi.request('nova.create_key')
      if (!result.ok) {
        setKeyError(result.error)
        if (result.error === 'signed_out') setAccount(null)
        return false
      }
      setKeyError(null)
      const stale = provider?.apiKeys.filter((key) => key.label === NOVA_KEY_LABEL) ?? []
      await addApiKey(result.key, NOVA_KEY_LABEL)
      await Promise.allSettled(stale.map((key) => deleteApiKey(key.id)))
      await updateProvider({ isEnabled: true })
      installedHere.current = true
      return true
    } catch (error) {
      logger.error('Could not store the NOVA key', error as Error)
      setKeyError('unavailable')
      return false
    } finally {
      syncing.current = false
    }
  }, [addApiKey, deleteApiKey, provider?.apiKeys, updateProvider])

  const refresh = useCallback(async () => {
    setLoadingSummary(true)
    try {
      const next = await ipcApi.request('nova.summary')
      if (!next) {
        setAccount(null)
        setSummary(null)
        return null
      }
      setSummary(next)
      return next
    } catch (error) {
      logger.warn('Could not load the NOVA balance', error as Error)
      return null
    } finally {
      setLoadingSummary(false)
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const status = await ipcApi.request('nova.status')
        if (cancelled) return
        setAccount(status.signedIn ? { email: status.email, name: status.name } : null)
      } catch (error) {
        logger.warn('Could not read the NOVA sign-in status', error as Error)
        if (!cancelled) setAccount(null)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  // Once signed in: load the balance, and get a new key if this computer's key was revoked on the website.
  useEffect(() => {
    if (!account) return
    void (async () => {
      const next = await refresh()
      if (next && !next.keyActive && !installedHere.current) {
        if (await installKey()) await refresh()
      }
    })()
    // Runs when the signed-in account changes, not on every key-list update.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [account?.email])

  // The key was deleted from the list on this computer while still signed in: get a new one.
  const hasNovaKey = novaKeys.length > 0
  useEffect(() => {
    if (account && summary?.keyActive && !hasNovaKey && !installedHere.current && !keyError) void installKey()
  }, [account, hasNovaKey, installKey, keyError, summary?.keyActive])

  // Top-ups happen in the browser, so refresh the balance when the user comes back.
  useEffect(() => {
    const onFocus = () => {
      if (toppingUp.current) {
        toppingUp.current = false
        void refresh()
      }
    }
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [refresh])

  const handleSignIn = useCallback(
    async (event: FormEvent) => {
      event.preventDefault()
      if (busy) return
      setBusy(true)
      setSignInError(null)
      try {
        const result = await ipcApi.request('nova.sign_in', { email, password, otp: needsOtp ? otp : '' })
        if (!result.ok) {
          if (result.error === 'otp_required') {
            if (needsOtp) setSignInError('otp_required')
            setNeedsOtp(true)
          } else {
            setSignInError(result.error)
          }
          return
        }
        setPassword('')
        setOtp('')
        setNeedsOtp(false)
        setKeyError(null)
        if (await installKey()) toast.success(t('settings.provider.nova.key_ready'))
        setAccount({ email: result.email, name: result.name })
      } catch (error) {
        logger.error('NOVA sign-in failed', error as Error)
        setSignInError('unavailable')
      } finally {
        setBusy(false)
      }
    },
    [busy, email, installKey, needsOtp, otp, password, t]
  )

  const handleRetryKey = useCallback(async () => {
    setKeyError(null)
    if (await installKey()) {
      toast.success(t('settings.provider.nova.key_ready'))
      await refresh()
    }
  }, [installKey, refresh, t])

  const handleSignOut = useCallback(async () => {
    const confirmed = await popup.confirm({
      title: t('settings.provider.nova.sign_out'),
      content: t('settings.provider.nova.sign_out_confirm'),
      centered: true
    })
    if (!confirmed) return
    setBusy(true)
    try {
      await ipcApi.request('nova.sign_out')
      await Promise.allSettled(novaKeys.map((key) => deleteApiKey(key.id)))
      setAccount(null)
      setSummary(null)
      setKeyError(null)
      toast.success(t('settings.provider.nova.signed_out'))
      // Back to the welcome screen; signing in there returns to the app with every setting intact.
      await setProviderSetupStatus('signed_out')
    } catch (error) {
      logger.error('NOVA sign-out failed', error as Error)
      toast.warning(t('settings.provider.nova.error.unavailable'))
    } finally {
      setBusy(false)
    }
  }, [deleteApiKey, novaKeys, setProviderSetupStatus, t])

  const openSite = useCallback((path: string) => {
    if (path === '/console') toppingUp.current = true
    void openExternalWebsite(`${NOVA_ORIGIN}${path}`)
  }, [])

  if (!provider) return null

  const avatar = <img src={NovaLogo} alt="" className="size-10 shrink-0 rounded-full" draggable={false} />

  if (account === undefined) {
    return (
      <div className={oauthCardClasses.container}>
        <div className={oauthCardClasses.shell}>
          <Skeleton className="h-5 w-55" />
          <Skeleton className="mt-2 h-4 w-full" />
        </div>
      </div>
    )
  }

  if (account === null) {
    return (
      <div className={oauthCardClasses.container}>
        <form className={cn(oauthCardClasses.shell, 'flex flex-col gap-2.5')} onSubmit={handleSignIn}>
          <div className={oauthCardClasses.profileMeta}>
            {avatar}
            <div className={oauthCardClasses.nameBlock}>
              <div className={oauthCardClasses.loggedInName}>{t('settings.provider.nova.title')}</div>
              <div className={cn(oauthCardClasses.loggedInEmail, 'text-muted-foreground')}>
                {t('settings.provider.nova.tagline')}
              </div>
            </div>
          </div>
          <Input
            type="email"
            autoComplete="username"
            placeholder={t('settings.provider.nova.email')}
            aria-label={t('settings.provider.nova.email')}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            maxLength={254}
            required
          />
          <Input
            type="password"
            autoComplete="current-password"
            placeholder={t('settings.provider.nova.password')}
            aria-label={t('settings.provider.nova.password')}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            maxLength={128}
            required
          />
          {needsOtp ? (
            <Input
              inputMode="numeric"
              autoComplete="one-time-code"
              placeholder={t('settings.provider.nova.otp')}
              aria-label={t('settings.provider.nova.otp')}
              value={otp}
              onChange={(e) => setOtp(e.target.value.replace(/\D/g, '').slice(0, 6))}
              autoFocus
              required
            />
          ) : null}
          {signInError ? (
            <p role="alert" className="text-xs text-destructive">
              {t(ERROR_MESSAGES[signInError])}
            </p>
          ) : null}
          <div className="flex flex-wrap items-center gap-3">
            <Button type="submit" variant="emphasis" disabled={busy}>
              {busy ? <RefreshCw className="size-4 animate-spin" aria-hidden /> : null}
              {t('settings.provider.nova.sign_in')}
            </Button>
            <Button type="button" variant="link" className="h-auto p-0 text-xs" onClick={() => openSite('/register')}>
              {t('settings.provider.nova.register')}
            </Button>
            <Button
              type="button"
              variant="link"
              className="h-auto p-0 text-xs"
              onClick={() => openSite('/forgot-password')}>
              {t('settings.provider.nova.forgot')}
            </Button>
          </div>
        </form>
      </div>
    )
  }

  return (
    <div className={oauthCardClasses.container}>
      <div className={cn(oauthCardClasses.shellLoggedIn, 'text-muted-foreground')}>
        <div className={oauthCardClasses.loggedInRow}>
          <div className={oauthCardClasses.profileMeta}>
            {avatar}
            <div className={oauthCardClasses.nameBlock}>
              <div className={oauthCardClasses.nameRow}>
                <div className={cn(oauthCardClasses.loggedInName, 'text-foreground')}>{account.name}</div>
                {summary?.group ? <span className={oauthCardClasses.badge}>{summary.group}</span> : null}
              </div>
              <div className={cn(oauthCardClasses.loggedInEmail, 'text-muted-foreground')}>{account.email}</div>
            </div>
          </div>
          <div className={cn(oauthCardClasses.loggedInActions, 'gap-1.5')}>
            <div className={cn(oauthCardClasses.inlineBalanceBlock, 'mr-1 flex items-baseline gap-1.5 text-left')}>
              <p className={cn(oauthCardClasses.inlineBalanceLabel, 'text-muted-foreground')}>
                {t('settings.provider.nova.balance')}
              </p>
              <div className={cn(oauthCardClasses.inlineBalanceValue, 'text-foreground')}>
                {loadingSummary && !summary ? (
                  <Skeleton className={`${oauthCardClasses.balanceValueSkeleton} h-5`} />
                ) : summary ? (
                  `$${summary.balanceUsd.toFixed(2)}`
                ) : (
                  '-'
                )}
              </div>
            </div>
            <Button
              className={cn(oauthCardClasses.topupPrimaryButton, 'h-7 px-2.5 py-0')}
              onClick={() => openSite('/console')}
              size="sm"
              variant="default">
              {t('settings.provider.nova.topup')}
            </Button>
            <Button
              className={cn(oauthCardClasses.logoutCompact, 'h-7 px-2 py-0 text-muted-foreground')}
              disabled={busy}
              onClick={handleSignOut}
              variant="ghost">
              {t('settings.provider.nova.sign_out')}
            </Button>
          </div>
        </div>
        {keyError ? (
          <div role="alert" className="mt-2.5 flex flex-wrap items-center gap-2 text-xs text-destructive">
            <span>{t(ERROR_MESSAGES[keyError])}</span>
            <Button variant="link" className="h-auto p-0 text-xs" onClick={handleRetryKey}>
              {t('settings.provider.nova.retry')}
            </Button>
            {keyError === 'email_unverified' || keyError === 'key_limit' ? (
              <Button variant="link" className="h-auto p-0 text-xs" onClick={() => openSite('/console')}>
                {t('settings.provider.nova.open_site')}
              </Button>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  )
}

export default NovaAccount
