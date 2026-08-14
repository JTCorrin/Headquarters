import { z } from 'zod';
import {
	documentRecipientsFieldSchema,
	type DocumentContactOption
} from '$lib/schemas/document-recipients.js';
import { isValidAmountString } from '$lib/money.js';

export const quoteFormSchema = z.object({
	clientId: z.uuid('Select a client'),
	clientName: z.string().max(160).optional().or(z.literal('')),
	title: z.string().min(1, 'Title is required').max(160),
	currency: z.enum(['GBP', 'USD', 'EUR']),
	/** Fixed amount off subtotal (major units). Empty = 0. */
	discount: z
		.string()
		.optional()
		.or(z.literal(''))
		.refine((v) => v === undefined || v === '' || isValidAmountString(v), 'Enter a valid amount'),
	status: z.enum(['draft', 'sent', 'accepted', 'rejected', 'expired', 'void']),
	recipients: documentRecipientsFieldSchema
});

export type QuoteFormSchema = typeof quoteFormSchema;
export type QuoteFormData = z.infer<typeof quoteFormSchema>;

/** Row shape for the quotes data table (UI-facing). */
export interface QuoteListItem {
	id: string;
	number: string;
	client: string;
	total: string;
	status: string;
	validUntil: string;
}

export interface QuoteClientOption {
	id: string;
	name: string;
}

export type QuoteContactOption = DocumentContactOption;
