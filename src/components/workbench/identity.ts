'use client';

import { useCallback, useSyncExternalStore } from 'react';

import type { HumanIdentity } from '@/lib/workbench/api-types';

const KEY = 'sigmafold.workbench.identity';
const EVENT = 'sigmafold:identity';

let cachedRaw: string | null | undefined;
let cachedValue: HumanIdentity | null = null;

function parse(raw: string | null): HumanIdentity | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Partial<HumanIdentity>;
    const name = typeof value.name === 'string' ? value.name.trim() : '';
    if (!name) return null;
    return { name, role: typeof value.role === 'string' && value.role ? value.role : null };
  } catch {
    return null;
  }
}

function read(): HumanIdentity | null {
  let raw: string | null = null;
  try {
    raw = window.localStorage.getItem(KEY);
  } catch {
    raw = null;
  }
  if (raw !== cachedRaw) {
    cachedRaw = raw;
    cachedValue = parse(raw);
  }
  return cachedValue;
}

function subscribe(onChange: () => void): () => void {
  window.addEventListener(EVENT, onChange);
  window.addEventListener('storage', onChange);
  return () => {
    window.removeEventListener(EVENT, onChange);
    window.removeEventListener('storage', onChange);
  };
}

export function useIdentity(): {
  readonly identity: HumanIdentity | null;
  readonly setIdentity: (next: HumanIdentity | null) => void;
} {
  const identity = useSyncExternalStore(subscribe, read, () => null);
  const setIdentity = useCallback((next: HumanIdentity | null) => {
    try {
      if (next) window.localStorage.setItem(KEY, JSON.stringify(next));
      else window.localStorage.removeItem(KEY);
    } catch {
      // storage blocked; identity lasts for this render only
    }
    window.dispatchEvent(new Event(EVENT));
  }, []);
  return { identity, setIdentity };
}

export function initials(name: string | null | undefined): string {
  const parts = (name ?? '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}
