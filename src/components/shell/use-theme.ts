'use client';

/**
 * Theme state.
 *
 * `globals.css` follows the OS when neither `.dark` nor `.light` is set on
 * `<html>`, and lets an explicit class win. So first paint is never wrong and
 * no anti-flash script is needed.
 *
 * The theme lives in the DOM and in `localStorage`, not in React state, so
 * this reads it with `useSyncExternalStore` rather than copying it into state
 * from an effect. That is the difference between subscribing to an external
 * system and mirroring it — the mirror is what causes a cascading render, and
 * it would also drift the moment anything else touched the class.
 */

import { useCallback, useSyncExternalStore } from 'react';

export type ThemeMode = 'light' | 'dark';

const STORAGE_KEY = 'sigmafold.theme';
/** Dispatched on toggle so every subscriber re-reads at once. */
const CHANGE_EVENT = 'sigmafold:themechange';

function readStored(): ThemeMode | null {
  try {
    const value = window.localStorage.getItem(STORAGE_KEY);
    return value === 'light' || value === 'dark' ? value : null;
  } catch {
    // Private browsing or blocked storage.
    return null;
  }
}

function systemTheme(): ThemeMode {
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function subscribe(onChange: () => void): () => void {
  const media = window.matchMedia('(prefers-color-scheme: dark)');
  media.addEventListener('change', onChange);
  window.addEventListener(CHANGE_EVENT, onChange);
  return () => {
    media.removeEventListener('change', onChange);
    window.removeEventListener(CHANGE_EVENT, onChange);
  };
}

/** The live theme: an explicit class wins, then storage, then the OS. */
function getSnapshot(): ThemeMode {
  const root = document.documentElement;
  if (root.classList.contains('dark')) return 'dark';
  if (root.classList.contains('light')) return 'light';
  return readStored() ?? systemTheme();
}

/** Dark is the primary design target, so that is the server's assumption. */
function getServerSnapshot(): ThemeMode {
  return 'dark';
}

export function useTheme(): {
  readonly theme: ThemeMode;
  readonly toggle: () => void;
} {
  const theme = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  const toggle = useCallback(() => {
    const next: ThemeMode = getSnapshot() === 'dark' ? 'light' : 'dark';
    const root = document.documentElement;
    root.classList.toggle('dark', next === 'dark');
    root.classList.toggle('light', next === 'light');
    root.style.colorScheme = next;
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // A remembered theme is a convenience, not a requirement.
    }
    window.dispatchEvent(new Event(CHANGE_EVENT));
  }, []);

  return { theme, toggle };
}
