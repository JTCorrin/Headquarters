import { z } from 'zod';

export const mailboxPresets = ['gmail', 'outlook', 'custom'] as const;
export type MailboxPreset = (typeof mailboxPresets)[number];

export const mailboxSecurityOptions = ['ssl', 'starttls', 'none'] as const;
export type MailboxSecurity = (typeof mailboxSecurityOptions)[number];

export const mailboxStatusOptions = [
	'disconnected',
	'configured',
	'ok',
	'error',
	'auth_failed'
] as const;
export type MailboxStatus = (typeof mailboxStatusOptions)[number];

/** Superforms SPA shape — password is write-only (empty = keep existing). */
export const mailboxFormSchema = z.object({
	preset: z.enum(mailboxPresets),
	emailAddress: z
		.string()
		.trim()
		.min(1, 'Email address is required')
		.email('Enter a valid email address')
		.max(320),
	username: z.string().trim().max(320),
	password: z.string().max(512),
	fromName: z.string().trim().max(120),
	imapHost: z.string().trim().min(1, 'IMAP host is required').max(255),
	imapPort: z
		.string()
		.trim()
		.regex(/^\d+$/, 'IMAP port must be a number')
		.refine((v) => {
			const n = Number(v);
			return n >= 1 && n <= 65535;
		}, 'IMAP port must be 1–65535'),
	imapSecurity: z.enum(mailboxSecurityOptions),
	smtpHost: z.string().trim().min(1, 'SMTP host is required').max(255),
	smtpPort: z
		.string()
		.trim()
		.regex(/^\d+$/, 'SMTP port must be a number')
		.refine((v) => {
			const n = Number(v);
			return n >= 1 && n <= 65535;
		}, 'SMTP port must be 1–65535'),
	smtpSecurity: z.enum(mailboxSecurityOptions)
});

export type MailboxFormData = z.infer<typeof mailboxFormSchema>;

export interface MailboxAccountResource {
	id: string;
	email_address: string;
	username: string;
	from_name: string | null;
	imap_host: string;
	imap_port: number;
	imap_security: MailboxSecurity;
	smtp_host: string;
	smtp_port: number;
	smtp_security: MailboxSecurity;
	/** True when a password/secret is stored — never echo the secret itself. */
	credentials_configured: boolean;
	status: MailboxStatus;
	last_checked_at: string | null;
	last_error_code: string | null;
}

export interface MailboxPresetDefaults {
	imapHost: string;
	imapPort: string;
	imapSecurity: MailboxSecurity;
	smtpHost: string;
	smtpPort: string;
	smtpSecurity: MailboxSecurity;
}

export const mailboxPresetDefaults: Record<MailboxPreset, MailboxPresetDefaults> = {
	gmail: {
		imapHost: 'imap.gmail.com',
		imapPort: '993',
		imapSecurity: 'ssl',
		smtpHost: 'smtp.gmail.com',
		smtpPort: '465',
		smtpSecurity: 'ssl'
	},
	outlook: {
		imapHost: 'outlook.office365.com',
		imapPort: '993',
		imapSecurity: 'ssl',
		smtpHost: 'smtp.office365.com',
		smtpPort: '587',
		smtpSecurity: 'starttls'
	},
	custom: {
		imapHost: '',
		imapPort: '993',
		imapSecurity: 'ssl',
		smtpHost: '',
		smtpPort: '465',
		smtpSecurity: 'ssl'
	}
};

export function emptyMailboxFormData(preset: MailboxPreset = 'custom'): MailboxFormData {
	const defaults = mailboxPresetDefaults[preset];
	return {
		preset,
		emailAddress: '',
		username: '',
		password: '',
		fromName: '',
		imapHost: defaults.imapHost,
		imapPort: defaults.imapPort,
		imapSecurity: defaults.imapSecurity,
		smtpHost: defaults.smtpHost,
		smtpPort: defaults.smtpPort,
		smtpSecurity: defaults.smtpSecurity
	};
}

export function mailboxFormFromResource(resource: MailboxAccountResource): MailboxFormData {
	return {
		preset: 'custom',
		emailAddress: resource.email_address,
		username: resource.username,
		password: '',
		fromName: resource.from_name ?? '',
		imapHost: resource.imap_host,
		imapPort: String(resource.imap_port),
		imapSecurity: resource.imap_security,
		smtpHost: resource.smtp_host,
		smtpPort: String(resource.smtp_port),
		smtpSecurity: resource.smtp_security
	};
}

export function applyMailboxPreset(
	current: MailboxFormData,
	preset: MailboxPreset
): MailboxFormData {
	const defaults = mailboxPresetDefaults[preset];
	return {
		...current,
		preset,
		imapHost: defaults.imapHost || current.imapHost,
		imapPort: defaults.imapPort,
		imapSecurity: defaults.imapSecurity,
		smtpHost: defaults.smtpHost || current.smtpHost,
		smtpPort: defaults.smtpPort,
		smtpSecurity: defaults.smtpSecurity
	};
}
