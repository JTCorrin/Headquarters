import { z } from 'zod';

export const authCredentialsSchema = z.object({
	displayName: z.string().trim().max(100, 'Display name must be at most 100 characters').optional(),
	email: z.email('Enter a valid email').trim().max(320),
	password: z
		.string()
		.min(8, 'Password must be at least 8 characters')
		.max(72, 'Password must be at most 72 characters')
});

export const authSignUpSchema = authCredentialsSchema.refine(
	(data) => Boolean(data.displayName?.trim()),
	{
		message: 'Enter your display name',
		path: ['displayName']
	}
);

export type AuthCredentialsData = z.infer<typeof authCredentialsSchema>;
