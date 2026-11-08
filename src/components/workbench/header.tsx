'use client';

import { useState } from 'react';
import Link from 'next/link';
import { ChartColumn, Cpu, Dna, Moon, RotateCcw, Sparkles, Sun, UserRound } from 'lucide-react';

import { Logo } from '@/components/brand/Logo';
import { THEME_STORAGE_KEY } from '@/components/shell/theme-script';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import type { HumanIdentity } from '@/lib/workbench/api-types';
import type { AiStatus } from '@/lib/workbench/types';

import { IdentityForm } from './bits';
import { GlossaryButton } from './glossary';
import { initials } from './identity';

export interface HeaderProps {
  readonly ai: AiStatus | null;
  readonly identity: HumanIdentity | null;
  readonly onIdentity: (identity: HumanIdentity | null) => void;
  readonly onReset: () => Promise<void>;
  readonly resetting: boolean;
  readonly canReset: boolean;
}

function toggleTheme() {
  const root = document.documentElement;
  const next = !root.classList.contains('dark');
  root.classList.toggle('dark', next);
  root.classList.toggle('light', !next);
  root.dataset.theme = next ? 'dark' : 'light';
  try {
    localStorage.setItem(THEME_STORAGE_KEY, next ? 'dark' : 'light');
  } catch {
    // storage unavailable; applies for this session
  }
}

export function Header({ ai, identity, onIdentity, onReset, resetting, canReset }: HeaderProps) {
  const [idOpen, setIdOpen] = useState(false);
  const [resetOpen, setResetOpen] = useState(false);

  return (
    <header className="wb-header">
      <div className="wb-header__brand">
        <Logo size={22} title="SigmaFold" />
        <span className="wb-header__product">Workbench</span>
      </div>
      <span className="wb-header__tagline">Variant review with version control</span>

      <span className="wb-card__spacer" />

      <AiBadge ai={ai} />

      <GlossaryButton />

      <Link href="/evaluation" className="wb-chrome-btn">
        <ChartColumn className="size-3.5" aria-hidden="true" />
        <span>Evaluation</span>
      </Link>

      <Link href="/classic" className="wb-chrome-btn">
        <Dna className="size-3.5" aria-hidden="true" />
        <span>Genome VCS (classic)</span>
      </Link>

      <Popover open={resetOpen} onOpenChange={setResetOpen}>
        <PopoverTrigger className="wb-chrome-btn" disabled={!canReset}>
          <RotateCcw className="size-3.5" aria-hidden="true" />
          <span>Reset demo</span>
        </PopoverTrigger>
        <PopoverContent side="bottom" align="end" className="wb-pop">
          <p className="wb-strong">Reset the workspace?</p>
          <p className="wb-small wb-muted">Every branch and delta is cleared. This cannot be undone.</p>
          <div className="wb-row-actions">
            <button type="button" className="wb-btn" onClick={() => setResetOpen(false)}>
              Cancel
            </button>
            <button
              type="button"
              className="wb-btn wb-btn--danger"
              disabled={resetting}
              onClick={async () => {
                await onReset();
                setResetOpen(false);
              }}
            >
              {resetting ? 'Resetting…' : 'Reset'}
            </button>
          </div>
        </PopoverContent>
      </Popover>

      <button type="button" className="wb-icon-btn" onClick={toggleTheme} aria-label="Toggle light or dark mode">
        <Sun className="size-4 dark:hidden" aria-hidden="true" />
        <Moon className="hidden size-4 dark:block" aria-hidden="true" />
      </button>

      <Popover open={idOpen} onOpenChange={setIdOpen}>
        <PopoverTrigger className={identity ? 'wb-identity-btn' : 'wb-identity-btn wb-identity-btn--missing'}>
          {identity ? (
            <>
              <span className="wb-avatar wb-avatar--human wb-avatar--sm" aria-hidden="true">
                {initials(identity.name)}
              </span>
              <span className="wb-identity-btn__text">
                <span className="wb-identity-btn__name">{identity.name}</span>
                {identity.role && <span className="wb-identity-btn__role">{identity.role}</span>}
              </span>
            </>
          ) : (
            <>
              <UserRound className="size-4" aria-hidden="true" />
              <span>Who are you?</span>
            </>
          )}
        </PopoverTrigger>
        <PopoverContent side="bottom" align="end" className="wb-pop wb-pop--wide">
          <IdentityForm
            initial={identity}
            prompt="Your name and role are attached to every delta you create. No login in this prototype."
            onSave={(next) => {
              onIdentity(next);
              setIdOpen(false);
            }}
            onCancel={() => setIdOpen(false)}
          />
          {identity && (
            <button
              type="button"
              className="wb-btn wb-btn--ghost wb-small"
              onClick={() => {
                onIdentity(null);
                setIdOpen(false);
              }}
            >
              Sign out
            </button>
          )}
        </PopoverContent>
      </Popover>
    </header>
  );
}

function AiBadge({ ai }: { readonly ai: AiStatus | null }) {
  if (!ai) return null;
  const online = ai.available;
  return (
    <Tooltip>
      <TooltipTrigger
        render={<span className={online ? 'wb-ai wb-ai--online' : 'wb-ai wb-ai--offline'} tabIndex={0} />}
      >
        {online ? <Sparkles className="size-3.5" aria-hidden="true" /> : <Cpu className="size-3.5" aria-hidden="true" />}
        <span className="wb-ai__dot" aria-hidden="true" />
        <span>{online ? ai.model || 'AI online' : 'AI offline: deterministic pipeline'}</span>
      </TooltipTrigger>
      <TooltipContent side="bottom" className="max-w-sm">
        {online
          ? `${ai.model} drafts plans and replies. Classification, safety and merge checks are deterministic and never depend on the model.`
          : ai.reason || 'No model is configured. Evidence, ACMG classification and checks still run deterministically.'}
      </TooltipContent>
    </Tooltip>
  );
}
