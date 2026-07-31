import type { TDocumentDefinitions } from 'pdfmake/interfaces';
import pdfMake from 'pdfmake/build/pdfmake';
import pdfFonts from 'pdfmake/build/vfs_fonts';

let fontsReady = false;

function ensureFonts() {
	if (fontsReady) return;
	pdfMake.addVirtualFileSystem(pdfFonts);
	fontsReady = true;
}

export async function downloadMoneyPdf(document: TDocumentDefinitions, filename: string) {
	ensureFonts();
	const pdf = pdfMake.createPdf(document);
	await pdf.download(filename);
}
