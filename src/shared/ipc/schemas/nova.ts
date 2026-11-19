import * as z from 'zod'

import { defineRoute } from '../define'

/**
 * NOVA account IPC schemas: sign in to cdkai.cc, create this computer's API key, read the balance
 * and sign out. Session cookies stay in the main process; only the account's name and email, the
 * balance and (once, on creation) the new API key reach the renderer.
 */

export { NOVA_KEY_LABEL, NOVA_ORIGIN } from '../../data/presets/nova'

const novaStatusSchema = z.discriminatedUnion('signedIn', [
  z.object({ signedIn: z.literal(false) }),
  z.object({ signedIn: z.literal(true), email: z.string(), name: z.string() })
])

const novaSignInResultSchema = z.discriminatedUnion('ok', [
  z.object({ ok: z.literal(true), email: z.string(), name: z.string() }),
  z.object({
    ok: z.literal(false),
    error: z.enum(['invalid_input', 'otp_required', 'wrong_credentials', 'too_many_attempts', 'offline', 'unavailable'])
  })
])

const novaKeyResultSchema = z.discriminatedUnion('ok', [
  z.object({ ok: z.literal(true), key: z.string() }),
  z.object({
    ok: z.literal(false),
    error: z.enum(['signed_out', 'email_unverified', 'key_limit', 'too_many_attempts', 'offline', 'unavailable'])
  })
])

const novaAccountSummarySchema = z.object({
  email: z.string(),
  name: z.string(),
  balanceUsd: z.number(),
  group: z.string().nullable(),
  keyActive: z.boolean()
})

export type NovaStatus = z.infer<typeof novaStatusSchema>
export type NovaSignInResult = z.infer<typeof novaSignInResultSchema>
export type NovaKeyResult = z.infer<typeof novaKeyResultSchema>
export type NovaAccountSummary = z.infer<typeof novaAccountSummarySchema>

export const novaRequestSchemas = {
  'nova.status': defineRoute({ input: z.void(), output: novaStatusSchema }),
  'nova.sign_in': defineRoute({
    input: z.object({ email: z.string().max(254), password: z.string().max(128), otp: z.string().max(6) }),
    output: novaSignInResultSchema
  }),
  'nova.create_key': defineRoute({ input: z.void(), output: novaKeyResultSchema }),
  'nova.summary': defineRoute({ input: z.void(), output: novaAccountSummarySchema.nullable() }),
  'nova.sign_out': defineRoute({ input: z.void(), output: z.void() })
}
