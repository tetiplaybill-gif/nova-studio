import { and, eq } from 'drizzle-orm'

import { preferenceTable } from '@data/db/schemas/preference'
import type { InsertUserModelRow } from '@data/db/schemas/userModel'
import { userModelTable } from '@data/db/schemas/userModel'
import { userProviderTable } from '@data/db/schemas/userProvider'
import { insertManyWithOrderKey } from '@data/services/utils/orderKey'
import { loggerService } from '@logger'
import {
  NOVA_DEFAULT_MODEL_GROUP,
  NOVA_DEFAULT_MODEL_ID,
  NOVA_DEFAULT_MODEL_NAME,
  NOVA_DEFAULT_UNIQUE_MODEL_ID,
  NOVA_PROVIDER_ID
} from '@shared/data/presets/nova'
import type { ModelCapability } from '@shared/data/types/model'

import type { DbType, ISeeder } from '../../types'
import { hashObject } from '../hashObject'
import { DEFAULT_MODEL_PREFERENCE_KEYS } from './cherryaiDefaultModelSeeder'

const logger = loggerService.withContext('NovaDefaultModelSeeder')

const DEFAULT_MODEL_PREFERENCE_SCOPE = 'default' as const

type TxLike = Pick<DbType, 'select' | 'insert' | 'update'>

function createNovaDefaultModelRow(): Omit<InsertUserModelRow, 'orderKey'> {
  return {
    id: NOVA_DEFAULT_UNIQUE_MODEL_ID,
    providerId: NOVA_PROVIDER_ID,
    modelId: NOVA_DEFAULT_MODEL_ID,
    presetModelId: null,
    name: NOVA_DEFAULT_MODEL_NAME,
    description: null,
    group: NOVA_DEFAULT_MODEL_GROUP,
    capabilities: [] as ModelCapability[],
    inputModalities: null,
    outputModalities: null,
    endpointTypes: null,
    contextWindow: null,
    maxInputTokens: null,
    maxOutputTokens: null,
    supportsStreaming: true,
    reasoning: null,
    parameters: null,
    pricing: null,
    isEnabled: true,
    isHidden: false,
    isDeprecated: false,
    notes: null
  }
}

function createDefaultModelPreferenceRows() {
  return DEFAULT_MODEL_PREFERENCE_KEYS.map((key) => ({
    scope: DEFAULT_MODEL_PREFERENCE_SCOPE,
    key,
    value: NOVA_DEFAULT_UNIQUE_MODEL_ID
  }))
}

/**
 * NOVA Studio's replacement for Cherry Studio's CherryAI default model: new installs start with one
 * NOVA model as the default for chat, the quick assistant and translation, so nothing is sent to
 * Cherry Studio's own service. Runs after PresetProviderSeeder, which creates the NOVA provider row.
 */
function ensureNovaDefaultModelSetupTx(tx: TxLike): void {
  const [provider] = tx
    .select({ id: userProviderTable.providerId })
    .from(userProviderTable)
    .where(eq(userProviderTable.providerId, NOVA_PROVIDER_ID))
    .limit(1)
    .all()
  if (!provider) {
    logger.warn('NOVA provider row is missing; the default model will be added on the next start')
    return
  }

  const [existing] = tx
    .select({ id: userModelTable.id })
    .from(userModelTable)
    .where(eq(userModelTable.id, NOVA_DEFAULT_UNIQUE_MODEL_ID))
    .limit(1)
    .all()
  if (!existing) {
    insertManyWithOrderKey(tx, userModelTable, [createNovaDefaultModelRow()], {
      pkColumn: userModelTable.id,
      scope: eq(userModelTable.providerId, NOVA_PROVIDER_ID)
    })
  }

  for (const { scope, key, value } of createDefaultModelPreferenceRows()) {
    const [preference] = tx
      .select({ value: preferenceTable.value })
      .from(preferenceTable)
      .where(and(eq(preferenceTable.scope, scope), eq(preferenceTable.key, key)))
      .limit(1)
      .all()
    if (!preference) tx.insert(preferenceTable).values({ scope, key, value }).run()
  }
}

export class NovaDefaultModelSeeder implements ISeeder {
  readonly name = 'novaDefaultModel'
  readonly description = 'Ensure the NOVA default model and default model preferences'
  readonly version: string

  constructor() {
    this.version = hashObject({ model: createNovaDefaultModelRow(), preferences: createDefaultModelPreferenceRows() })
  }

  run(db: DbType): void {
    db.transaction((tx) => ensureNovaDefaultModelSetupTx(tx))
  }
}
