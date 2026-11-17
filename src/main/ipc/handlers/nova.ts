import { novaAccountService } from '@main/services/nova/NovaAccountService'
import type { novaRequestSchemas } from '@shared/ipc/schemas/nova'
import type { IpcHandlersFor } from '@shared/ipc/types'

export const novaHandlers: IpcHandlersFor<typeof novaRequestSchemas> = {
  'nova.status': () => novaAccountService.status(),
  'nova.sign_in': ({ email, password, otp }) => novaAccountService.signIn(email, password, otp),
  'nova.create_key': () => novaAccountService.createKey(),
  'nova.summary': () => novaAccountService.summary(),
  'nova.sign_out': () => novaAccountService.signOut()
}
