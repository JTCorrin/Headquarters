<script lang="ts">
	import SettingsConfigPageStoryHost, {
		type SettingsConfigPageStoryHostProps
	} from './settings-config-page.story-host.svelte';

	let props: SettingsConfigPageStoryHostProps = $props();
</script>

<SettingsConfigPageStoryHost {...props} />
