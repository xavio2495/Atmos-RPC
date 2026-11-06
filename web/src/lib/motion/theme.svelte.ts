// Mirrors data-theme on <html>. The initial value is read from the DOM, which an inline
// script in app.html sets before first paint.
type Theme = 'light' | 'dark';

function initial(): Theme {
	if (typeof document === 'undefined') return 'light';
	return document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';
}

export const theme = $state({ value: initial() as Theme });

export function toggleTheme() {
	theme.value = theme.value === 'dark' ? 'light' : 'dark';
	document.documentElement.dataset.theme = theme.value;
	try {
		localStorage.setItem('theme', theme.value);
	} catch {
		/* storage unavailable */
	}
}
