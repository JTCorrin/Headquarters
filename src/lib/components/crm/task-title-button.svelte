<script lang="ts">
	export interface TaskTitleButtonProps {
		title: string;
		onclick?: () => void;
	}

	let { title, onclick }: TaskTitleButtonProps = $props();
</script>

<button type="button" class="text-left hover:text-primary hover:underline" {onclick}>
	{title}
</button>
