'use client';

/**
 * Theme state.
 *
 * `globals.css` follows the OS when neither `.dark` nor `.light` is set on
 * `<html>`, and lets an explicit class win. So the initial state is "whatever
 * the OS says" and the toggle writes an explicit class — which means first
 * paint is never wrong, and no flash-of-wrong-theme script is needed.
 */

import { useCallback, useEffect, useState } from 'react';

export type ThemeMode = 'light' | 'dark';

const STORAGE_KEY = 'sigmafold.theme';

function systemTheme(): ThemeMode {
  if (typeof window === 'undefined') return 'dark';
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function useTheme(): {
  readonly theme: ThemeMode;
  readonly toggle: () => void;
} {
  // Start at the dark design target on the server; the effect below corrects
  // to the real preference before the user can interact.
  const [theme, setTheme] = useState<ThemeMode>('dark');

  useEffect(() => {
    let stored: string | null = null;
    try {
      stored = window.localStorage.getItem(STORAGE_KEY);
    } catch {
      // Private browsing or blocked storage: fall through to the OS value.
    }
    const initial: ThemeMode =
      stored === 'light' || stored === 'dark' ? stored : systemTheme();
    setTheme(initial);
    applyTheme(initial);
  }, []);

  const toggle = useCallback(() => {
    setTheme((current) => {
      const next: ThemeMode = current === 'dark' ? 'light' : 'dark';
      applyTheme(next);
      try {
        window.localStorage.setItem(STORAGE_KEY, next);
      } catch {
        // A remembered theme is a convenience, not a requirement.
      }
      return next;
    });
  }, []);

  return { theme, toggle };
}

function applyTheme(mode: ThemeMode): void {
  const root = document.documentElement;
  root.classList.toggle('dark', mode === 'dark');
  root.classList.toggle('light', mode === 'light');
  root.style.colorScheme = mode;
}
