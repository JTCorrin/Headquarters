import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'
import {
  buildCampaignMergeVars,
  renderMergeTemplate,
} from '../_shared/campaign-merge.ts'

Deno.test('renderMergeTemplate substitutes known tokens and blanks unknown', () => {
  const out = renderMergeTemplate(
    'Hello {{contact.name}} from {{client.name}} — {{unknown.token}}!',
    { 'contact.name': 'Ava', 'client.name': 'Acme' },
  )
  assertEquals(out, 'Hello Ava from Acme — !')
})

Deno.test('buildCampaignMergeVars maps entity fields', () => {
  const vars = buildCampaignMergeVars({
    entityType: 'lead',
    entityName: 'Deal',
    contactName: 'Sam',
    clientName: 'Northwind',
    toName: 'Sam',
  })
  assertEquals(vars['lead.name'], 'Deal')
  assertEquals(vars['contact.name'], 'Sam')
  assertEquals(vars['client.name'], 'Northwind')
  assertEquals(vars['recipient.name'], 'Sam')
})
