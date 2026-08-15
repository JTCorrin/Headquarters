import { z } from 'zod';

export const clientStatuses = [
	'prospect',
	'active',
	'on_hold',
	'inactive',
	'archived'
] as const;

const dateOnly = z
	.string()
	.regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD')
	.refine((value) => {
		const year = Number(value.slice(0, 4));
		const month = Number(value.slice(5, 7));
		const day = Number(value.slice(8, 10));
		const date = new Date(Date.UTC(year, month - 1, day));
		return (
			date.getUTCFullYear() === year &&
			date.getUTCMonth() === month - 1 &&
			date.getUTCDate() === day
		);
	}, 'Must be a real calendar date')
	.optional()
	.or(z.literal(''));

export const clientFormSchema = z.object({
	name: z.string().trim().min(1, 'Name is required').max(200),
	status: z.enum(clientStatuses),
	websiteUrl: z.string().max(2000).optional().or(z.literal('')),
	industry: z.string().max(120).optional().or(z.literal('')),
	primaryEmail: z
		.string()
		.max(320)
		.optional()
		.or(z.literal(''))
		.refine(
			(v) => !v || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v),
			'Must be a valid email address'
		),
	phone: z.string().max(64).optional().or(z.literal('')),
	taxIdentifier: z.string().max(120).optional().or(z.literal('')),
	/** When true, new quote/invoice lines default to 0% tax for this client. */
	taxExempt: z.boolean(),
	registrationNumber: z.string().max(120).optional().or(z.literal('')),
	defaultCurrency: z
		.string()
		.optional()
		.or(z.literal(''))
		.refine((v) => !v || /^[A-Z]{3}$/.test(v), 'Use a 3-letter uppercase currency code'),
	paymentTermsDays: z
		.string()
		.optional()
		.or(z.literal(''))
		.refine((v) => {
			if (!v) return true;
			if (!/^\d+$/.test(v)) return false;
			const n = Number(v);
			return Number.isSafeInteger(n) && n >= 0 && n <= 3650;
		}, 'Must be an integer between 0 and 3650'),
	renewalOn: dateOnly,
	notes: z.string().max(20_000).optional().or(z.literal(''))
});

export type ClientFormSchema = typeof clientFormSchema;
export type ClientFormData = z.infer<typeof clientFormSchema>;

export interface ClientResource {
	id: string;
	version: number;
	name: string;
	status: (typeof clientStatuses)[number];
	website_url?: string | null;
	industry?: string | null;
	primary_email?: string | null;
	phone?: string | null;
	tax_identifier?: string | null;
	tax_exempt?: boolean;
	registration_number?: string | null;
	default_currency?: string | null;
	payment_terms_days?: number | null;
	renewal_on?: string | null;
	notes?: string | null;
	converted_from_lead_id?: string | null;
	owner_label?: string | null;
}
