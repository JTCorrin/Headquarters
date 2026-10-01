import type { TDocumentDefinitions } from 'pdfmake/interfaces';

// pdfmake + embedded fonts are ~2 MB; load them only when a download is requested.
async function importPdfMake() {
	const [{ default: pdfMake }, { default: pdfFonts }] = await Promise.all([
		import('pdfmake/build/pdfmake'),
		import('pdfmake/build/vfs_fonts')
	]);
	pdfMake.addVirtualFileSystem(pdfFonts);
	return pdfMake;
}

let pdfMakeReady: ReturnType<typeof importPdfMake> | undefined;

function loadPdfMake() {
	pdfMakeReady ??= importPdfMake().catch((error) => {
		pdfMakeReady = undefined;
		throw error;
	});
	return pdfMakeReady;
}

export async function downloadMoneyPdf(document: TDocumentDefinitions, filename: string) {
	const pdfMake = await loadPdfMake();
	const pdf = pdfMake.createPdf(document);
	await pdf.download(filename);
}
