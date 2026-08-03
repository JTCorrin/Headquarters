<script lang="ts">
	export interface EmailTemplateNameLinkProps {
		id: string;
		name: string;
	}

	let { id, name }: EmailTemplateNameLinkProps = $props();
</script>

<a
	class="text-foreground font-medium underline-offset-4 hover:underline"
	href={`/email/templates/${id}`}
	data-testid={`email-template-link-${id}`}
>
	{name}
</a>
