import { z } from 'zod';

export const authCredentialsSchema = z.object({
	email: z.email('Enter a valid email').trim().max(320),
	password: z
		.string()
		.min(8, 'Password must be at least 8 characters')
		.max(72, 'Password must be at most 72 characters')
});

export type AuthCredentialsData = z.infer<typeof authCredentialsSchema>;
