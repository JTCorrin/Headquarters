import { assertEquals, assertStringIncludes } from 'jsr:@std/assert@1'
import { invitationEmailContent } from '../_shared/system-email.ts'

Deno.test('invitation email uses encoded one-time token and safe HTML', () => {
  const content = invitationEmailContent(
    {
      to: 'invitee@example.test',
      organisationName: 'A & B <CRM>',
      inviterName: 'Owner <Admin>',
      role: 'member',
      token: 'crm_inv_token+value',
      expiresAt: '2026-08-17T10:00:00.000Z',
    },
    'https://crm.example.test/',
  )

  assertEquals(
    content.acceptUrl,
    'https://crm.example.test/invite/accept?token=crm_inv_token%2Bvalue',
  )
  assertStringIncludes(content.subject, 'A & B <CRM>')
  assertStringIncludes(content.bodyText, content.acceptUrl)
  assertStringIncludes(content.bodyText, 'Sign in with invitee@example.test')
  assertStringIncludes(content.bodyHtml, 'A &amp; B &lt;CRM&gt;')
  assertStringIncludes(content.bodyHtml, 'Owner &lt;Admin&gt;')
})
