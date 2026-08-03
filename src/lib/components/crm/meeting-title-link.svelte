<script lang="ts">
	export interface MeetingTitleLinkProps {
		id: string;
		title: string;
	}

	let { id, title }: MeetingTitleLinkProps = $props();
</script>

<a href="/meetings/{id}" class="hover:underline">{title}</a>
