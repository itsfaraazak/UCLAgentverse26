'use client';

import { useEffect, useId, useState, type FormEvent, type ReactNode } from 'react';
import { Check, Copy, Cpu, Database, Sparkles, UserRound } from 'lucide-react';

import type { HumanIdentity } from '@/lib/workbench/api-types';
import type { Actor } from '@/lib/workbench/types';
import { SIGNOFF_ROLES } from '@/lib/workbench/types';
import type { SourceRef } from '@/lib/evidence/types';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

import { initials } from './identity';
import { CLASS_SHORT, classTone, formatTime, shortId } from './model';
import type { AcmgClassification } from '@/lib/acmg/types';

export function actorKind(actor: Actor | null | undefined): 'human' | 'llm' | 'deterministic' {
  if (!actor || actor.kind === 'human') return 'human';
  return actor.model ? 'llm' : 'deterministic';
}

export function ActorAvatar({ actor, size = 'md' }: { readonly actor: Actor | null | undefined; readonly size?: 'sm' | 'md' }) {
  const kind = actorKind(actor);
  const label =
    kind === 'human' ? `${actor?.name ?? 'Unknown'} (human)` : kind === 'llm' ? `${actor?.name} (AI agent)` : `${actor?.name} (deterministic)`;
  return (
    <span className={`wb-avatar wb-avatar--${kind} wb-avatar--${size}`} role="img" aria-label={label}>
      {kind === 'human' ? (
        actor?.name ? initials(actor.name) : <UserRound className="size-3.5" aria-hidden="true" />
      ) : kind === 'llm' ? (
        <Sparkles className="size-3.5" aria-hidden="true" />
      ) : (
        <Cpu className="size-3.5" aria-hidden="true" />
      )}
    </span>
  );
}

export function ActorName({ actor }: { readonly actor: Actor | null | undefined }) {
  const kind = actorKind(actor);
  return (
    <span className="wb-actor">
      <span className="wb-actor__name">{actor?.name || 'Unknown'}</span>
      {kind === 'human' && actor?.kind === 'human' && actor.role && <span className="wb-actor__role">{actor.role}</span>}
      {kind === 'llm' && actor?.kind === 'agent' && <span className="wb-tag wb-tag--llm">{actor.model}</span>}
      {kind === 'deterministic' && <span className="wb-tag">deterministic</span>}
    </span>
  );
}

export function ClassPill({
  value,
  size = 'md',
  short,
}: {
  readonly value: AcmgClassification | string | null | undefined;
  readonly size?: 'sm' | 'md' | 'lg';
  readonly short?: boolean;
}) {
  const tone = classTone(value);
  const text = value ? (short ? (CLASS_SHORT[value as AcmgClassification] ?? value) : value) : 'Unclassified';
  return (
    <span className={`wb-class wb-class--${tone} wb-class--${size}`} title={value ?? undefined}>
      {text}
    </span>
  );
}

export function IdChip({ id }: { readonly id: string | null | undefined }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const t = window.setTimeout(() => setCopied(false), 1200);
    return () => window.clearTimeout(t);
  }, [copied]);
  if (!id) return null;
  return (
    <button
      type="button"
      className="wb-id"
      title={`Delta ${id} — click to copy`}
      aria-label={`Copy delta id ${id}`}
      onClick={() => {
        void navigator.clipboard?.writeText(id).catch(() => undefined);
        setCopied(true);
      }}
    >
      {copied ? <Check className="size-3" aria-hidden="true" /> : <Copy className="size-3 wb-id__icon" aria-hidden="true" />}
      <span>{shortId(id)}</span>
    </button>
  );
}

export function SourceChip({ source }: { readonly source: SourceRef | null | undefined }) {
  if (!source || !source.name) return null;
  const retrieved = formatTime(source.retrievedAt).full;
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <a
            className="wb-source"
            href={source.url || undefined}
            target="_blank"
            rel="noopener noreferrer"
          />
        }
      >
        <Database className="size-3" aria-hidden="true" />
        <span>{source.name}</span>
        {source.cached && <span className="wb-source__cached">cached</span>}
      </TooltipTrigger>
      <TooltipContent side="top" className="flex-col items-start">
        <span>Licence: {source.licence || 'unknown'}</span>
        {retrieved && (
          <span className="opacity-75">
            {source.cached ? 'Cache snapshot' : 'Fetched'} {retrieved}
          </span>
        )}
      </TooltipContent>
    </Tooltip>
  );
}

/** 0–1 bar with the Cheng et al. 2023 thresholds (0.34, 0.564) marked. */
export function AlphaMissenseBar({ score }: { readonly score: number | null | undefined }) {
  if (typeof score !== 'number' || Number.isNaN(score)) return <span className="wb-muted">No score</span>;
  const clamped = Math.min(1, Math.max(0, score));
  const zone = clamped < 0.34 ? 'likely benign' : clamped > 0.564 ? 'likely pathogenic' : 'ambiguous';
  return (
    <span className="wb-am" role="img" aria-label={`AlphaMissense ${clamped.toFixed(3)}, ${zone}`}>
      <span className="wb-am__track" aria-hidden="true">
        <span className="wb-am__zone wb-am__zone--benign" style={{ width: '34%' }} />
        <span className="wb-am__zone wb-am__zone--ambiguous" style={{ left: '34%', width: '22.4%' }} />
        <span className="wb-am__zone wb-am__zone--pathogenic" style={{ left: '56.4%', width: '43.6%' }} />
        <span className="wb-am__tick" style={{ left: '34%' }} />
        <span className="wb-am__tick" style={{ left: '56.4%' }} />
        <span className="wb-am__marker" style={{ left: `${clamped * 100}%` }} />
      </span>
      <span className="wb-am__legend" aria-hidden="true">
        <span>0</span>
        <span style={{ left: '34%' }}>0.34</span>
        <span style={{ left: '56.4%' }}>0.564</span>
        <span style={{ right: 0 }}>1</span>
      </span>
    </span>
  );
}

export function Elapsed({ since }: { readonly since: number }) {
  const [now, setNow] = useState(since);
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, []);
  return <span className="wb-elapsed">{Math.max(0, Math.floor((now - since) / 1000))}s</span>;
}

export function IdentityForm({
  initial,
  onSave,
  onCancel,
  compact,
  prompt,
}: {
  readonly initial?: HumanIdentity | null;
  readonly onSave: (identity: HumanIdentity) => void;
  readonly onCancel?: () => void;
  readonly compact?: boolean;
  readonly prompt?: ReactNode;
}) {
  const id = useId();
  const [name, setName] = useState(initial?.name ?? '');
  const [role, setRole] = useState<string>(initial?.role ?? SIGNOFF_ROLES[0]);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    onSave({ name: name.trim(), role: role || null });
  };
  return (
    <form className={compact ? 'wb-identity wb-identity--compact' : 'wb-identity'} onSubmit={submit}>
      {prompt && <p className="wb-identity__prompt">{prompt}</p>}
      <div className="wb-identity__fields">
        <label className="wb-field" htmlFor={`${id}-name`}>
          <span className="wb-field__label">Your name</span>
          <input
            id={`${id}-name`}
            className="wb-input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Dr Asha Patel"
            autoComplete="name"
            required
          />
        </label>
        <label className="wb-field" htmlFor={`${id}-role`}>
          <span className="wb-field__label">Role</span>
          <select id={`${id}-role`} className="wb-input" value={role} onChange={(e) => setRole(e.target.value)}>
            {SIGNOFF_ROLES.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="wb-row-actions">
        <button type="submit" className="wb-btn wb-btn--primary" disabled={!name.trim()}>
          Save identity
        </button>
        {onCancel && (
          <button type="button" className="wb-btn" onClick={onCancel}>
            Cancel
          </button>
        )}
      </div>
    </form>
  );
}
