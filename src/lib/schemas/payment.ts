import { z } from 'zod';

const emptyUuid = '00000000-0000-4000-8000-000000000000';

export const paymentFormSchema = z
	.object({
		direction: z.enum(['inbound', 'outbound']),
		clientId: z.string().optional().or(z.literal('')),
		clientName: z.string().max(160).optional().or(z.literal('')),
		vendorId: z.string().optional().or(z.literal('')),
		vendorName: z.string().max(160).optional().or(z.literal('')),
		invoiceId: z.string().optional().or(z.literal('')),
		billId: z.string().optional().or(z.literal('')),
		amount: z.string().regex(/^\d+(\.\d{1,2})?$/, 'Use a number like 12.50'),
		currency: z.enum(['GBP', 'USD', 'EUR']),
		method: z.enum(['bank', 'card', 'cash', 'stripe', 'other']),
		occurredOn: z.string().min(1, 'Date is required'),
		reference: z.string().max(120).optional().or(z.literal('')),
		notes: z.string().max(2000).optional().or(z.literal(''))
	})
	.superRefine((data, ctx) => {
		if (data.direction === 'inbound') {
			if (!data.clientId || data.clientId === emptyUuid || !z.uuid().safeParse(data.clientId).success) {
				ctx.addIssue({
					code: 'custom',
					path: ['clientId'],
					message: 'Select a client'
				});
			}
			if (data.billId?.trim()) {
				ctx.addIssue({
					code: 'custom',
					path: ['billId'],
					message: 'Inbound payments allocate to invoices, not bills'
				});
			}
		} else {
			if (!data.vendorId || data.vendorId === emptyUuid || !z.uuid().safeParse(data.vendorId).success) {
				ctx.addIssue({
					code: 'custom',
					path: ['vendorId'],
					message: 'Select a vendor'
				});
			}
			if (data.invoiceId?.trim()) {
				ctx.addIssue({
					code: 'custom',
					path: ['invoiceId'],
					message: 'Outbound payments allocate to bills, not invoices'
				});
			}
		}
	});

export type PaymentFormSchema = typeof paymentFormSchema;
export type PaymentFormData = z.infer<typeof paymentFormSchema>;

/** Row shape for the payments data table (UI-facing). */
export interface PaymentListItem {
	id: string;
	direction: string;
	party: string;
	amount: string;
	method: string;
	status: string;
	occurredOn: string;
	allocationsSummary: string;
	/** Raw status for reverse eligibility. */
	statusKey: string;
	version: number;
}

export interface PaymentClientOption {
	id: string;
	name: string;
}

export interface PaymentVendorOption {
	id: string;
	name: string;
}

export interface PaymentInvoiceOption {
	id: string;
	number: string;
	clientId: string;
	currency: string;
	balanceDueCents: number;
	status: string;
}

export interface PaymentBillOption {
	id: string;
	number: string;
	vendorId: string;
	currency: string;
	balanceDueCents: number;
	status: string;
}

export interface PaymentAllocationRow {
	id: string;
	paymentId: string;
	targetLabel: string;
	amount: string;
	allocatedAt: string;
	reversed: boolean;
}
