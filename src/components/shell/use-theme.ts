'use client';

/**
 * The theme lives on `<html class="dark">`, written before first paint by the
 * inline script in `layout.tsx`. That element is the source of truth, so this
 * subscribes to it rather than mirroring it into React state — which also
 * means the titlebar icon stays correct when the command palette flips the
 * theme instead of the button.
 */

import { useCallback, useSyncExternalStore } from 'react';

const THEME_KEY = 'sigmafold-theme';

function subscribe(onChange: () => void): () => void {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['class'],
  });
  return () => observer.disconnect();
}

function getSnapshot(): boolean {
  return document.documentElement.classList.contains('dark');
}

/** Light is the server-rendered default; the inline script corrects it. */
function getServerSnapshot(): boolean {
  return false;
}

export function setTheme(dark: boolean): void {
  document.documentElement.classList.toggle('dark', dark);
  try {
    localStorage.setItem(THEME_KEY, dark ? 'dark' : 'light');
  } catch {
    // Private browsing or blocked storage: the choice applies but is not kept.
  }
}

export function useTheme(): { readonly dark: boolean; readonly toggle: () => void } {
  const dark = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const toggle = useCallback(() => {
    setTheme(!document.documentElement.classList.contains('dark'));
  }, []);
  return { dark, toggle };
}
