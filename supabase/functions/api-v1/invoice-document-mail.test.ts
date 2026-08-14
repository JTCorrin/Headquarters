import { assertEquals } from 'jsr:@std/assert@1'
import { renderInvoiceEmailTemplates } from '../_shared/invoice-document-mail.ts'
import { buildInvoicePdfBytes } from '../_shared/invoice-pdf.ts'

Deno.test('renderInvoiceEmailTemplates replaces placeholders', () => {
  const result = renderInvoiceEmailTemplates(
    'Invoice {{invoice_number}} from {{org_name}}',
    'Hello {{client_name}}, total {{total}}, due {{due_on}}',
    {
      invoice_number: 'INV-9',
      org_name: 'Acme',
      client_name: 'Client Co',
      total: '£10.00',
      due_on: '2026-09-01',
    },
  )
  assertEquals(result.subject, 'Invoice INV-9 from Acme')
  assertEquals(result.body, 'Hello Client Co, total £10.00, due 2026-09-01')
})

Deno.test('buildInvoicePdfBytes returns a PDF header', async () => {
  const bytes = await buildInvoicePdfBytes({
    orgName: 'Acme Ltd',
    invoiceNumber: 'INV-1',
    clientName: 'Client Co',
    issueOn: '2026-08-01',
    dueOn: '2026-08-31',
    currency: 'GBP',
    lines: [
      {
        description: 'Retainer',
        quantity: 1,
        unitLabel: null,
        totalCents: 10000,
      },
    ],
    subtotalCents: 10000,
    discountCents: 0,
    taxCents: 2000,
    totalCents: 12000,
  })
  const head = new TextDecoder().decode(bytes.slice(0, 5))
  assertEquals(head, '%PDF-')
})
