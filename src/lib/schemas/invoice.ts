import { z } from 'zod';
import {
	documentRecipientsFieldSchema,
	type DocumentContactOption
} from '$lib/schemas/document-recipients.js';

export const invoiceFormSchema = z.object({
	clientId: z.uuid('Select a client'),
	clientName: z.string().max(160).optional().or(z.literal('')),
	currency: z.enum(['GBP', 'USD', 'EUR']),
	issueOn: z.string().min(1, 'Issue date is required'),
	dueOn: z.string().min(1, 'Due date is required'),
	purchaseOrderNumber: z.string().max(80).optional().or(z.literal('')),
	status: z.enum(['draft', 'sent', 'partial', 'paid', 'void']),
	/** Accepted quote used for convert-from-quote create flow (list drawer). */
	quoteId: z.string().optional().or(z.literal('')),
	recipients: documentRecipientsFieldSchema
});

export type InvoiceFormSchema = typeof invoiceFormSchema;
export type InvoiceFormData = z.infer<typeof invoiceFormSchema>;

/** Row shape for the invoices data table (UI-facing). */
export interface InvoiceListItem {
	id: string;
	number: string;
	client: string;
	total: string;
	status: string;
	dueOn: string;
}

export interface InvoiceClientOption {
	id: string;
	name: string;
}

export type InvoiceContactOption = DocumentContactOption;

export interface InvoiceQuoteOption {
	id: string;
	label: string;
}
