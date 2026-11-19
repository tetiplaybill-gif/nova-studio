import { setupTestDatabase } from '@test-helpers/db'
import { eq } from 'drizzle-orm'
import { app } from 'electron'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { ENDPOINT_TYPE } from '@cherrystudio/provider-registry'
import { agentTable } from '@data/db/schemas/agent'
import { CherryAssistantSeeder } from '@data/db/seeding/seeders/cherryAssistantSeeder'
import { NovaDefaultModelSeeder } from '@data/db/seeding/seeders/novaDefaultModelSeeder'
import { providerService } from '@data/services/ProviderService'
import { NOVA_DEFAULT_UNIQUE_MODEL_ID, NOVA_PROVIDER_ID } from '@shared/data/presets/nova'

describe('CherryAssistantSeeder', () => {
  const dbh = setupTestDatabase()

  function seedNovaDefaultModel() {
    providerService.batchUpsert([
      {
        providerId: NOVA_PROVIDER_ID,
        presetProviderId: NOVA_PROVIDER_ID,
        name: 'NOVA',
        endpointConfigs: null,
        defaultChatEndpoint: ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS,
        authConfig: null,
        providerSettings: null,
        isEnabled: true
      }
    ])
    new NovaDefaultModelSeeder().run(dbh.db)
  }

  const assistant = () =>
    dbh.db
      .select()
      .from(agentTable)
      .all()
      .find((row) => row.configuration.builtin_role === 'assistant')

  beforeEach(() => {
    vi.mocked(app.getPreferredSystemLanguages).mockReturnValue(['en-US'])
  })

  it('creates the assistant ready to answer channels, on the NOVA default model', () => {
    seedNovaDefaultModel()
    new CherryAssistantSeeder().run(dbh.db)

    expect(assistant()).toMatchObject({ name: 'NOVA Helper', model: NOVA_DEFAULT_UNIQUE_MODEL_ID })
    expect(assistant()?.configuration.avatar).not.toBe('🍒')
  })

  it('gives an existing assistant without a model the default and replaces only the stock avatar', () => {
    new CherryAssistantSeeder().run(dbh.db)
    const id = assistant()!.id
    dbh.db
      .update(agentTable)
      .set({ model: null, configuration: { ...assistant()!.configuration, avatar: '🍒' } })
      .where(eq(agentTable.id, id))
      .run()
    seedNovaDefaultModel()

    new CherryAssistantSeeder().run(dbh.db)

    expect(assistant()?.model).toBe(NOVA_DEFAULT_UNIQUE_MODEL_ID)
    expect(assistant()?.configuration.avatar).not.toBe('🍒')
  })

  it("keeps the user's own model and avatar", () => {
    seedNovaDefaultModel()
    new CherryAssistantSeeder().run(dbh.db)
    const id = assistant()!.id
    dbh.db
      .update(agentTable)
      .set({ model: null, configuration: { ...assistant()!.configuration, avatar: '🦊' } })
      .where(eq(agentTable.id, id))
      .run()
    dbh.db.update(agentTable).set({ model: NOVA_DEFAULT_UNIQUE_MODEL_ID }).where(eq(agentTable.id, id)).run()

    new CherryAssistantSeeder().run(dbh.db)

    expect(assistant()?.configuration.avatar).toBe('🦊')
  })

  it('leaves the model empty rather than pointing at a model the user removed', () => {
    new CherryAssistantSeeder().run(dbh.db)

    expect(assistant()?.model).toBeNull()
  })
})
