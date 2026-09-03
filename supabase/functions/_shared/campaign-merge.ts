/**
 * Campaign template merge: {{contact.name}}, {{client.name}}, {{lead.name}}, etc.
 * Unknown tokens become empty string.
 */

export type CampaignMergeVars = Record<string, string>

export function renderMergeTemplate(template: string, vars: CampaignMergeVars): string {
  return template.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_match, key: string) => {
    const value = vars[key]
    return value == null ? '' : value
  })
}

export function buildCampaignMergeVars(input: {
  entityType: 'lead' | 'contact' | 'client'
  entityName: string | null
  contactName?: string | null
  clientName?: string | null
  leadName?: string | null
  toName?: string | null
}): CampaignMergeVars {
  const contactName = input.contactName ??
    (input.entityType === 'contact' ? input.entityName : null)
  const clientName = input.clientName ?? (input.entityType === 'client' ? input.entityName : null)
  const leadName = input.leadName ?? (input.entityType === 'lead' ? input.entityName : null)
  const display = input.toName ?? input.entityName ?? ''

  return {
    'contact.name': contactName ?? display,
    'client.name': clientName ?? '',
    'lead.name': leadName ?? '',
    'recipient.name': display,
  }
}
