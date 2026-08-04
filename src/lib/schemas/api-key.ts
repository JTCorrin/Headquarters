import { z } from 'zod';
import { membershipRoles, type MembershipRole, roleLabel } from './organisation.js';

export const apiKeyCreateSchema = z.object({
	name: z
		.string()
		.min(1, 'Name is required')
		.max(120)
		.refine((value) => value.trim().length > 0, 'Name is required'),
	role: z.enum(membershipRoles)
});

export type ApiKeyCreateSchema = typeof apiKeyCreateSchema;
export type ApiKeyCreateData = z.infer<typeof apiKeyCreateSchema>;

/** Roles an actor may assign to a new key (never stronger than their own). */
export function apiKeyRoleOptions(actorRole: MembershipRole): MembershipRole[] {
	const rank: Record<MembershipRole, number> = {
		owner: 5,
		admin: 4,
		member: 3,
		billing: 2,
		readonly: 1
	};
	const ceiling = rank[actorRole];
	return membershipRoles.filter((role) => rank[role] <= ceiling);
}

export function apiKeyRoleLabel(role: MembershipRole): string {
	return roleLabel(role);
}
