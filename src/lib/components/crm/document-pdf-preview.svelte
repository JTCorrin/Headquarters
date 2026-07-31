<script lang="ts">
	import type { TDocumentDefinitions } from 'pdfmake/interfaces';
	import PdfmakeHtmlRenderer from 'pdfmake-html-renderer';
	import 'pdfmake-html-renderer/index.css';
	import { Button } from '$lib/components/ui/button/index.js';
	import { cn } from '$lib/utils.js';
	import { downloadMoneyPdf } from '$lib/pdf/download-money-pdf.js';
	import DownloadIcon from '@lucide/svelte/icons/download';

	export interface DocumentPdfPreviewProps {
		document: TDocumentDefinitions;
		filename?: string;
		title?: string;
		class?: string;
	}

	let {
		document,
		filename = 'document.pdf',
		title = 'PDF preview',
		class: className
	}: DocumentPdfPreviewProps = $props();

	let downloading = $state(false);

	async function onDownload() {
		downloading = true;
		try {
			await downloadMoneyPdf(document, filename);
		} finally {
			downloading = false;
		}
	}
</script>

<section
	class={cn(
		'bg-muted/40 flex min-h-0 flex-col overflow-hidden rounded-3xl ring-1 ring-foreground/5 dark:ring-foreground/10',
		className
	)}
>
	<div class="flex shrink-0 items-center justify-between gap-3 px-4 py-3">
		<div>
			<p class="text-sm font-semibold tracking-tight">{title}</p>
			<p class="text-muted-foreground text-xs">Updates live as you edit</p>
		</div>
		<Button type="button" size="sm" variant="outline" disabled={downloading} onclick={onDownload}>
			<DownloadIcon class="size-3.5" />
			{downloading ? 'Preparing…' : 'Download PDF'}
		</Button>
	</div>
	<div class="min-h-[480px] flex-1 overflow-auto px-3 pb-4">
		<div class="mx-auto max-w-[210mm] bg-white text-black">
			<PdfmakeHtmlRenderer {document} mode="shrinkToFit" pageShadow={true} />
		</div>
	</div>
</section>
