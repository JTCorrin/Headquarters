/**
 * Campaign template merge: {{contact.name}}, {{client.name}}, {{lead.name}}, etc.
 * Unknown tokens become empty string.
 */

export type CampaignMergeVars = Record<string, string>

const HTML_ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
}

export function renderMergeTemplate(
  template: string,
  vars: CampaignMergeVars,
  options: { html?: boolean } = {},
): string {
  return template.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_match, key: string) => {
    const value = vars[key]
    if (value == null) return ''
    return options.html ? value.replace(/[&<>"']/g, (c) => HTML_ESCAPES[c]!) : value
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
