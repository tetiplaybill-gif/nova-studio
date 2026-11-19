import type { NovaDecisionQuestion, NovaExtractionField } from '@shared/ipc/schemas/novaMedia'

export const EXTRACTION_FIELD_TYPES: NovaExtractionField['type'][] = [
  'text',
  'number',
  'date',
  'time',
  'datetime',
  'duration',
  'list',
  'estimate'
]
export const DECISION_QUESTION_TYPES: NovaDecisionQuestion['type'][] = ['noul', 'choice', 'score', 'box']

/** Starting points so a first extraction or decision takes one click; every field stays editable. */
export const EXTRACTION_PRESETS: Record<'invoice' | 'contact' | 'meeting', NovaExtractionField[]> = {
  invoice: [
    { name: 'invoice_number', type: 'text', instructions: 'Invoice ID' },
    { name: 'vendor', type: 'text', instructions: 'Company that issued the invoice' },
    { name: 'total', type: 'number', instructions: 'Amount due, including tax' },
    { name: 'due_date', type: 'date' }
  ],
  contact: [
    { name: 'name', type: 'text', instructions: 'Full name of the person' },
    { name: 'company', type: 'text' },
    { name: 'email', type: 'text' },
    { name: 'phone', type: 'text' }
  ],
  meeting: [
    { name: 'topic', type: 'text', instructions: 'What the meeting is about' },
    { name: 'date', type: 'date' },
    { name: 'start_time', type: 'time' },
    { name: 'participants', type: 'list', items: 'text' }
  ]
}

export const DECISION_PRESETS: Record<'triage' | 'moderation' | 'sentiment', NovaDecisionQuestion[]> = {
  triage: [
    { key: 'is_bug', type: 'noul', instructions: 'Is the customer reporting a bug?', options: [] },
    {
      key: 'urgency',
      type: 'score',
      instructions: 'How urgent is this ticket?',
      options: [
        { key: '0', description: 'Low: a question or a cosmetic issue' },
        { key: '1', description: 'Medium: a feature is impaired but there is a workaround' },
        { key: '2', description: 'High: the customer cannot work or is losing money' }
      ]
    }
  ],
  moderation: [
    {
      key: 'verdict',
      type: 'choice',
      instructions: 'Should this post be published?',
      options: [
        { key: 'publish', description: 'Respectful and on topic' },
        { key: 'review', description: 'Borderline: a person should look' },
        { key: 'reject', description: 'Abusive, spam or illegal' }
      ]
    }
  ],
  sentiment: [
    {
      key: 'sentiment',
      type: 'choice',
      instructions: 'What is the overall sentiment?',
      options: [
        { key: 'positive', description: 'Satisfied, pleased or grateful' },
        { key: 'neutral', description: 'Factual, neither positive nor negative' },
        { key: 'negative', description: 'Unhappy, frustrated or angry' }
      ]
    }
  ]
}

/** A field or question key the API accepts: letters, digits and underscores, not starting with a digit. */
export function toKey(text: string): string {
  const key = text
    .trim()
    .replace(/[^A-Za-z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '')
  return /^[A-Za-z_]/.test(key) ? key.slice(0, 64) : `f_${key}`.slice(0, 64)
}
