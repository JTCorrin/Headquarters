import { z } from 'zod';

export const orgInvoiceEmailSecurityOptions = ['tls', 'starttls', 'none'] as const;
export type OrgInvoiceEmailSecurity = (typeof orgInvoiceEmailSecurityOptions)[number];

export const orgInvoiceEmailPresets = ['gmail', 'outlook', 'custom'] as const;
export type OrgInvoiceEmailPreset = (typeof orgInvoiceEmailPresets)[number];

export const orgInvoiceEmailFormSchema = z.object({
	preset: z.enum(orgInvoiceEmailPresets),
	fromAddress: z
		.string()
		.trim()
		.min(1, 'From address is required')
		.email('Enter a valid email address')
		.max(320),
	fromName: z.string().trim().max(120),
	replyTo: z
		.string()
		.trim()
		.max(320)
		.refine((v) => v.length === 0 || z.string().email().safeParse(v).success, {
			message: 'Enter a valid reply-to address'
		}),
	username: z.string().trim().min(1, 'Username is required').max(320),
	password: z.string().max(512),
	smtpHost: z.string().trim().min(1, 'SMTP host is required').max(255),
	smtpPort: z
		.string()
		.trim()
		.regex(/^\d+$/, 'SMTP port must be a number')
		.refine((v) => {
			const n = Number(v);
			return n >= 1 && n <= 65535;
		}, 'SMTP port must be 1–65535'),
	smtpSecurity: z.enum(orgInvoiceEmailSecurityOptions),
	subjectTemplate: z.string().trim().min(1, 'Subject template is required').max(500),
	bodyTemplate: z.string().trim().min(1, 'Body template is required').max(10000)
});

export type OrgInvoiceEmailFormData = z.infer<typeof orgInvoiceEmailFormSchema>;

export interface OrgInvoiceEmailAccountResource {
	id: string;
	org_id: string;
	from_address: string;
	from_name: string | null;
	reply_to: string | null;
	smtp_host: string;
	smtp_port: number;
	smtp_security: OrgInvoiceEmailSecurity;
	username: string;
	status: 'pending' | 'active' | 'error' | 'disabled';
	subject_template: string;
	body_template: string;
	credentials_configured: boolean;
	credentials_updated_at: string | null;
	last_tested_at: string | null;
	last_error_code: string | null;
	last_error_message: string | null;
	version: number;
}

export interface OrgInvoiceEmailTestFeedback {
	ok: boolean;
	message: string;
}

const DEFAULT_SUBJECT = 'Invoice {{invoice_number}} from {{org_name}}';
const DEFAULT_BODY =
	'Hello,\n\nPlease find attached invoice {{invoice_number}} for {{client_name}}.\n\nTotal due: {{total}}\nDue date: {{due_on}}\n\nThank you.';

export const orgInvoiceEmailPresetDefaults: Record<
	OrgInvoiceEmailPreset,
	{ smtpHost: string; smtpPort: string; smtpSecurity: OrgInvoiceEmailSecurity }
> = {
	gmail: { smtpHost: 'smtp.gmail.com', smtpPort: '465', smtpSecurity: 'tls' },
	outlook: {
		smtpHost: 'smtp-mail.outlook.com',
		smtpPort: '587',
		smtpSecurity: 'starttls'
	},
	custom: { smtpHost: '', smtpPort: '465', smtpSecurity: 'tls' }
};

export function emptyOrgInvoiceEmailFormData(
	preset: OrgInvoiceEmailPreset = 'custom'
): OrgInvoiceEmailFormData {
	const defaults = orgInvoiceEmailPresetDefaults[preset];
	return {
		preset,
		fromAddress: '',
		fromName: '',
		replyTo: '',
		username: '',
		password: '',
		smtpHost: defaults.smtpHost,
		smtpPort: defaults.smtpPort,
		smtpSecurity: defaults.smtpSecurity,
		subjectTemplate: DEFAULT_SUBJECT,
		bodyTemplate: DEFAULT_BODY
	};
}

export function orgInvoiceEmailFormFromResource(
	resource: OrgInvoiceEmailAccountResource
): OrgInvoiceEmailFormData {
	const host = resource.smtp_host.toLowerCase();
	const preset: OrgInvoiceEmailPreset =
		host.includes('gmail.com') ? 'gmail' : host.includes('outlook') || host.includes('office365')
			? 'outlook'
			: 'custom';
	return {
		preset,
		fromAddress: resource.from_address,
		fromName: resource.from_name ?? '',
		replyTo: resource.reply_to ?? '',
		username: resource.username,
		password: '',
		smtpHost: resource.smtp_host,
		smtpPort: String(resource.smtp_port),
		smtpSecurity: resource.smtp_security,
		subjectTemplate: resource.subject_template,
		bodyTemplate: resource.body_template
	};
}

export function applyOrgInvoiceEmailPreset(
	current: OrgInvoiceEmailFormData,
	preset: OrgInvoiceEmailPreset
): OrgInvoiceEmailFormData {
	const defaults = orgInvoiceEmailPresetDefaults[preset];
	return {
		...current,
		preset,
		smtpHost: defaults.smtpHost || current.smtpHost,
		smtpPort: defaults.smtpPort,
		smtpSecurity: defaults.smtpSecurity
	};
}

export function toOrgInvoiceEmailPutBody(form: OrgInvoiceEmailFormData): {
	from_address: string;
	from_name: string | null;
	reply_to: string | null;
	smtp_host: string;
	smtp_port: number;
	smtp_security: OrgInvoiceEmailSecurity;
	username: string;
	password: string | null;
	subject_template: string;
	body_template: string;
} {
	return {
		from_address: form.fromAddress.trim(),
		from_name: form.fromName.trim() || null,
		reply_to: form.replyTo.trim() || null,
		smtp_host: form.smtpHost.trim(),
		smtp_port: Number(form.smtpPort),
		smtp_security: form.smtpSecurity,
		username: form.username.trim(),
		password: form.password.length > 0 ? form.password : null,
		subject_template: form.subjectTemplate.trim(),
		body_template: form.bodyTemplate
	};
}
