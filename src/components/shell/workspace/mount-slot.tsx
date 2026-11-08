'use client';

/**
 * A declared mount point for a component another thread owns.
 *
 * Why this exists rather than an import: `src/components/genome-3d/` and
 * `src/components/genome-upload/` are being built concurrently on other
 * branches. A static import of a path that does not exist yet fails the
 * build, so the shell declares the slot, states the contract it will mount
 * against, and renders this in the meantime.
 *
 * It is deliberately not a skeleton or a fake preview. A placeholder that
 * looks like content is worse than one that says what it is — a reviewer can
 * see exactly which surfaces are wired and which are waiting.
 *
 * Swapping one in is a two-line change in `workspace-panel.tsx`: add the
 * import and render the component instead of the slot. The props each slot
 * expects are listed in `expects`.
 */

import { PlugZap } from 'lucide-react';

export interface MountSlotProps {
  /** Human name of the surface, e.g. "Genome 3D". */
  readonly title: string;
  /** The directory that will provide it, e.g. `src/components/genome-3d/`. */
  readonly path: string;
  /** What the shell already has ready to hand it. */
  readonly expects: readonly string[];
  /** Why this surface belongs in the workspace. */
  readonly purpose: string;
}

export function MountSlot({ title, path, expects, purpose }: MountSlotProps) {
  return (
    <div className="slot" role="status">
      <p className="slot__head">
        <PlugZap className="h-4 w-4" strokeWidth={1.75} aria-hidden="true" />
        {title} — mount point ready
      </p>
      <p className="m-0 max-w-[62ch]">{purpose}</p>
      <p className="slot__path m-0">
        Will mount from <span className="seq normal-case">{path}</span> when that
        component lands. Not yet present in this checkout.
      </p>
      <div className="m-0">
        <p className="m-0 mb-1 text-[0.6875rem] font-medium uppercase tracking-[0.04em]">
          Props the shell can supply now
        </p>
        <ul className="m-0 flex list-disc flex-col gap-0.5 pl-4 text-[0.75rem]">
          {expects.map((item) => (
            <li key={item}>
              <span className="seq normal-case">{item}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
