import type { Preview, Renderer } from '@storybook/sveltekit';
import { withThemeByClassName } from '@storybook/addon-themes';
import '../src/routes/layout.css';

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
