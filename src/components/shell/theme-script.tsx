/**
 * Applies the stored theme before first paint, so a dark-mode reload never
 * flashes the light palette. Runs as a plain inline script because it has to
 * execute before React hydrates.
 *
 * Both the token set in globals.css and the `dark:` utilities resolve against
 * this class, so it is the single source of truth for the theme. All three
 * variants share it — see `use-theme.ts` for the client-side toggle.
 */
const SCRIPT = `
(function () {
  try {
    var stored = localStorage.getItem('sigmafold-theme');
    var dark = stored === 'dark' ||
      (stored !== 'light' && window.matchMedia('(prefers-color-scheme: dark)').matches);
    var root = document.documentElement;
    root.classList.toggle('dark', dark);
    root.dataset.theme = dark ? 'dark' : 'light';
  } catch (e) {
    /* storage unavailable (private window, blocked cookies): keep the default */
  }
})();
`;

export function ThemeScript() {
  return <script dangerouslySetInnerHTML={{ __html: SCRIPT }} />;
}

export const THEME_STORAGE_KEY = 'sigmafold-theme';
