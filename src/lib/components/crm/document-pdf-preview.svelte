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
			<p class="text-muted-foreground text-xs">Updates live as you edit · always shown as paper</p>
		</div>
		<Button type="button" size="sm" variant="outline" disabled={downloading} onclick={onDownload}>
			<DownloadIcon class="size-3.5" />
			{downloading ? 'Preparing…' : 'Download PDF'}
		</Button>
	</div>

	<!--
		PDF paper is excluded from app dark mode: color-scheme + explicit light
		tokens so pdfmake-html-renderer (currentColor / inherited color) stays readable.
	-->
	<div class="hq-pdf-desk min-h-[480px] flex-1 overflow-auto px-3 pb-4">
		<div class="hq-pdf-paper mx-auto max-w-[210mm]">
			<PdfmakeHtmlRenderer {document} mode="shrinkToFit" pageShadow={true} />
		</div>
	</div>
</section>

<style>
	.hq-pdf-desk {
		color-scheme: light;
		background: #d4d4d8;
	}

	:global(.dark) .hq-pdf-desk {
		background: #3f3f46;
	}

	.hq-pdf-paper {
		color-scheme: light;
		color: #18181b;
		/* Neutralize theme CSS variables that leak into the renderer */
		--background: #ffffff;
		--foreground: #18181b;
		--muted-foreground: #71717a;
		--border: #e4e4e7;
		--card: #ffffff;
		--primary: #18181b;
		isolation: isolate;
	}

	.hq-pdf-paper :global(.phr-page) {
		background: #ffffff !important;
		color: #18181b;
	}
</style>
