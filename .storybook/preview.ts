import type { Preview, Renderer } from '@storybook/sveltekit';
import { withThemeByClassName } from '@storybook/addon-themes';
import '../src/routes/layout.css';

export const hqViewports = {
	mobile: {
		name: 'Mobile',
		styles: { width: '390px', height: '844px' },
		type: 'mobile' as const
	},
	tablet: {
		name: 'Tablet',
		styles: { width: '768px', height: '1024px' },
		type: 'tablet' as const
	},
	desktop: {
		name: 'Desktop',
		styles: { width: '1280px', height: '800px' },
		type: 'desktop' as const
	}
};

/** Enables sveltekit-superforms Storybook-safe page handling (`STORYBOOK_MODE`). */
(globalThis as typeof globalThis & { STORIES?: boolean }).STORIES = true;

// Roboto for pdfmake-html-renderer (matches pdfmake default font)
if (typeof document !== 'undefined') {
	const id = 'hq-roboto-font';
	if (!document.getElementById(id)) {
		const link = document.createElement('link');
		link.id = id;
		link.rel = 'stylesheet';
		link.href =
			'https://fonts.googleapis.com/css2?family=Roboto:ital,wght@0,400;0,700;1,400;1,700&display=swap';
		document.head.appendChild(link);
	}
}

const preview: Preview = {
	parameters: {
		controls: {
			matchers: {
				color: /(background|color)$/i,
				date: /Date$/i
			}
		},
		layout: 'padded',
		backgrounds: { disable: true },
		viewport: {
			options: hqViewports
		},
		a11y: {
			test: 'todo'
		}
	},
	decorators: [
		withThemeByClassName<Renderer>({
			themes: {
				light: '',
				dark: 'dark'
			},
			defaultTheme: 'light',
			parentSelector: 'html'
		})
	]
};

export default preview;
