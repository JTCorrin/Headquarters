import type { OrganisationBrandingResource } from '$lib/schemas/organisation.js';

const COUNTRY_NAMES = new Intl.DisplayNames(['en'], { type: 'region' });

export function formatOrgCountryName(countryCode: string | null | undefined): string | null {
	if (!countryCode?.trim()) return null;
	try {
		return COUNTRY_NAMES.of(countryCode.trim().toUpperCase()) ?? countryCode.toUpperCase();
	} catch {
		return countryCode.toUpperCase();
	}
}

/** Build Invoice Ninja–style letterhead lines from org branding. */
export function formatOrgLetterheadLines(
	branding: Pick<
		OrganisationBrandingResource,
		| 'name'
		| 'legal_name'
		| 'address_line1'
		| 'address_line2'
		| 'city'
		| 'region'
		| 'postal_code'
		| 'country_code'
		| 'phone'
		| 'billing_email'
		| 'website_url'
		| 'tax_identifier'
		| 'registration_number'
	>
): string[] {
	const lines: string[] = [];
	const displayName = branding.legal_name?.trim() || branding.name?.trim();
	if (displayName) lines.push(displayName);

	if (branding.address_line1?.trim()) lines.push(branding.address_line1.trim());
	if (branding.address_line2?.trim()) lines.push(branding.address_line2.trim());

	const cityRegionPostal = [branding.city, branding.region, branding.postal_code]
		.map((part) => part?.trim())
		.filter(Boolean)
		.join(', ');
	if (cityRegionPostal) lines.push(cityRegionPostal);

	const country = formatOrgCountryName(branding.country_code);
	if (country) lines.push(country);

	if (branding.phone?.trim()) lines.push(branding.phone.trim());
	if (branding.billing_email?.trim()) lines.push(branding.billing_email.trim());
	if (branding.website_url?.trim()) lines.push(branding.website_url.trim());
	if (branding.tax_identifier?.trim()) lines.push(`Tax ID ${branding.tax_identifier.trim()}`);
	if (branding.registration_number?.trim()) {
		lines.push(`Reg ${branding.registration_number.trim()}`);
	}

	return lines;
}

export async function loadOrgLogoDataUrl(
	logoUrl: string | null | undefined
): Promise<string | undefined> {
	if (!logoUrl) return undefined;
	try {
		const response = await fetch(logoUrl);
		if (!response.ok) return undefined;
		const blob = await response.blob();
		return await new Promise<string | undefined>((resolve) => {
			const reader = new FileReader();
			reader.onload = () => {
				resolve(typeof reader.result === 'string' ? reader.result : undefined);
			};
			reader.onerror = () => resolve(undefined);
			reader.readAsDataURL(blob);
		});
	} catch {
		return undefined;
	}
}
