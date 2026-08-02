<script lang="ts">
	export interface TaskTitleButtonProps {
		title: string;
		onclick?: () => void;
	}

	let { title, onclick }: TaskTitleButtonProps = $props();
</script>

<button type="button" class="hover:text-primary text-left hover:underline" {onclick}>
	{title}
</button>
