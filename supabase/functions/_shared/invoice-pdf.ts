import { PDFDocument, StandardFonts, rgb } from 'npm:pdf-lib@1.17.1'

export type InvoicePdfLineInput = {
  description: string
  quantity: number
  unitLabel?: string | null
  totalCents: number
}

export type InvoicePdfInput = {
  orgName: string
  invoiceNumber: string
  clientName: string
  issueOn: string
  dueOn: string
  currency: string
  lines: InvoicePdfLineInput[]
  subtotalCents: number
  discountCents: number
  taxCents: number
  totalCents: number
}

function formatMoney(cents: number, currency: string): string {
  const amount = cents / 100
  try {
    return new Intl.NumberFormat('en-GB', { style: 'currency', currency }).format(amount)
  } catch {
    return `${currency} ${amount.toFixed(2)}`
  }
}

function truncate(text: string, max: number): string {
  const trimmed = text.trim()
  if (trimmed.length <= max) return trimmed
  return `${trimmed.slice(0, Math.max(0, max - 1))}…`
}

export async function buildInvoicePdfBytes(input: InvoicePdfInput): Promise<Uint8Array> {
  const pdf = await PDFDocument.create()
  const page = pdf.addPage([595.28, 841.89])
  const font = await pdf.embedFont(StandardFonts.Helvetica)
  const fontBold = await pdf.embedFont(StandardFonts.HelveticaBold)

  const margin = 50
  let y = page.getHeight() - margin
  const lineHeight = 14
  const black = rgb(0.1, 0.1, 0.1)
  const muted = rgb(0.35, 0.35, 0.35)

  const drawText = (
    text: string,
    x: number,
    size: number,
    bold = false,
    color = black,
  ) => {
    page.drawText(text, {
      x,
      y,
      size,
      font: bold ? fontBold : font,
      color,
    })
  }

  drawText(input.orgName, margin, 20, true)
  y -= 28
  drawText('INVOICE', margin, 16, true)
  y -= 22

  const metaX = 360
  let metaY = page.getHeight() - margin - 28
  const metaRows: Array<[string, string]> = [
    ['Invoice #', input.invoiceNumber],
    ['Issue date', input.issueOn],
    ['Due date', input.dueOn],
    ['Client', input.clientName],
  ]
  for (const [label, value] of metaRows) {
    page.drawText(label, { x: metaX, y: metaY, size: 9, font, color: muted })
    page.drawText(truncate(value, 40), {
      x: metaX + 72,
      y: metaY,
      size: 9,
      font: fontBold,
      color: black,
    })
    metaY -= lineHeight
  }

  y -= 10
  page.drawLine({
    start: { x: margin, y },
    end: { x: page.getWidth() - margin, y },
    thickness: 1,
    color: rgb(0.85, 0.85, 0.85),
  })
  y -= 18

  const colDesc = margin
  const colQty = 320
  const colUnit = 370
  const colTotal = 470

  drawText('Description', colDesc, 10, true, muted)
  page.drawText('Qty', { x: colQty, y, size: 10, font: fontBold, color: muted })
  page.drawText('Unit', { x: colUnit, y, size: 10, font: fontBold, color: muted })
  page.drawText('Total', { x: colTotal, y, size: 10, font: fontBold, color: muted })
  y -= lineHeight + 4

  for (const line of input.lines) {
    if (y < margin + 120) break
    drawText(truncate(line.description, 52), colDesc, 10)
    page.drawText(String(line.quantity), { x: colQty, y, size: 10, font, color: black })
    drawText(truncate(line.unitLabel?.trim() || '—', 10), colUnit, 10)
    drawText(formatMoney(line.totalCents, input.currency), colTotal, 10)
    y -= lineHeight
  }

  y -= 8
  page.drawLine({
    start: { x: colTotal - 20, y },
    end: { x: page.getWidth() - margin, y },
    thickness: 1,
    color: rgb(0.85, 0.85, 0.85),
  })
  y -= 18

  const totals: Array<[string, number]> = [
    ['Subtotal', input.subtotalCents],
    ['Discount', input.discountCents],
    ['Tax', input.taxCents],
    ['Total due', input.totalCents],
  ]
  for (const [label, cents] of totals) {
    page.drawText(label, { x: colTotal - 70, y, size: 10, font, color: muted })
    page.drawText(formatMoney(cents, input.currency), {
      x: colTotal,
      y,
      size: label === 'Total due' ? 11 : 10,
      font: label === 'Total due' ? fontBold : font,
      color: black,
    })
    y -= lineHeight
  }

  return new Uint8Array(await pdf.save())
}
