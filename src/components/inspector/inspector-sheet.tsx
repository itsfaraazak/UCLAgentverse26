'use client';

import {
  Clock,
  FlaskConical,
  GitCommitVertical,
  GitMerge,
  Hash,
  Tag,
  User,
} from 'lucide-react';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Separator } from '@/components/ui/separator';
import { nodeBadge } from '@/components/status';
import { GeneTrack } from '@/components/genome-map/gene-track';
import { TripleDiff } from '@/components/diff/triple-diff';
import { CheckList } from '@/components/agents/check-list';
import { CellCanvas } from '@/components/cell/cell-canvas';
import type { CommitView, LocusView, SimulationView } from '@/lib/demo/view';

export interface InspectorSheetProps {
  readonly commit: CommitView | null;
  readonly locus: LocusView;
  readonly simulation: SimulationView;
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
}

export function InspectorSheet({
  commit,
  locus,
  simulation,
  open,
  onOpenChange,
}: InspectorSheetProps) {
  return (
    <Sheet open={open && commit !== null} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="vibrancy-strong w-full gap-0 overflow-hidden data-[side=right]:sm:max-w-[min(46rem,92vw)]"
        aria-label="Commit inspector"
      >
        {commit !== null && (
          <InspectorBody commit={commit} locus={locus} simulation={simulation} />
        )}
      </SheetContent>
    </Sheet>
  );
}

function InspectorBody({
  commit,
  locus,
  simulation,
}: {
  readonly commit: CommitView;
  readonly locus: LocusView;
  readonly simulation: SimulationView;
}) {
  const look = nodeBadge(commit);
  const kind = commit.isMerge ? 'Merge commit' : commit.isRoot ? 'Root commit' : 'Commit';

  return (
    <>
      <SheetHeader className="shrink-0 border-b px-5 pt-5 pb-4 pr-14">
        <div className="flex items-center gap-2">
          {commit.isMerge ? (
            <GitMerge className="size-4 text-muted-foreground" aria-hidden="true" />
          ) : (
            <GitCommitVertical className="size-4 text-muted-foreground" aria-hidden="true" />
          )}
          <span className="text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">
            {kind}
          </span>
          <span
            className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold tracking-wide uppercase ${look.pill}`}
          >
            <look.Icon className="size-2.5" aria-hidden="true" />
            {look.short}
          </span>
        </div>
        <SheetTitle className="text-[17px] leading-snug font-semibold tracking-tight">
          {commit.message}
        </SheetTitle>
        <SheetDescription className="sr-only">
          Inspector for commit {commit.short}. {look.label}.
        </SheetDescription>
        <dl className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11.5px] text-muted-foreground">
          <div className="flex items-center gap-1.5">
            <Hash className="size-3" aria-hidden="true" />
            <dt className="sr-only">Object id</dt>
            <dd className="font-mono tnum">{commit.short}</dd>
          </div>
          <div className="flex items-center gap-1.5">
            <User className="size-3" aria-hidden="true" />
            <dt className="sr-only">Author</dt>
            <dd className="font-mono">{commit.author}</dd>
          </div>
          <div className="flex items-center gap-1.5">
            <Clock className="size-3" aria-hidden="true" />
            <dt className="sr-only">Committed</dt>
            <dd className="tnum">
              {new Date(commit.timestamp).toISOString().replace('T', ' ').slice(0, 16)} UTC
            </dd>
          </div>
          {commit.branches.length > 0 && (
            <div className="flex items-center gap-1.5">
              <Tag className="size-3" aria-hidden="true" />
              <dt className="sr-only">Branch tips</dt>
              <dd className="font-mono">{commit.branches.join(', ')}</dd>
            </div>
          )}
        </dl>
        {commit.run?.mergeBlockedReason != null && (
          <p
            className={`mt-2 rounded-lg border px-3 py-2 text-[11.5px] leading-relaxed ${
              commit.status === 'escalated'
                ? 'border-escalate/40 bg-escalate-soft/50 text-escalate'
                : 'border-block/40 bg-block-soft/50 text-block'
            }`}
          >
            <strong className="font-semibold">Merge blocked.</strong>{' '}
            {commit.run.mergeBlockedReason}
          </p>
        )}
      </SheetHeader>

      <Tabs defaultValue="diff" className="flex min-h-0 flex-1 flex-col gap-0">
        <TabsList variant="line" className="shrink-0 gap-2 px-5 pt-3">
          <TabsTrigger value="diff">Diff</TabsTrigger>
          <TabsTrigger value="locus">Locus</TabsTrigger>
          <TabsTrigger value="checks">
            Checks
            {commit.run !== null && (
              <span className="ml-1 font-mono text-[10px] text-muted-foreground tnum">
                {commit.run.checks.filter((c) => c.status !== 'skipped').length}/7
              </span>
            )}
          </TabsTrigger>
          <TabsTrigger value="sim">Simulation</TabsTrigger>
        </TabsList>

        <div className="min-h-0 flex-1 overflow-auto px-5 py-4">
          <TabsContent value="diff" className="flex flex-col gap-6">
            {commit.diffVsParent !== null ? (
              <TripleDiff diff={commit.diffVsParent} />
            ) : (
              <p className="rounded-lg border border-dashed px-3 py-6 text-center text-[12px] text-muted-foreground">
                This is the root commit — it has no parent to diff against.
              </p>
            )}
            <Separator />
            <TripleDiff diff={commit.diffVsReference} />
          </TabsContent>

          <TabsContent value="locus" className="flex flex-col gap-6">
            <GeneTrack
              locus={locus}
              edit={commit.edit}
              changedCodons={commit.diffVsReference.changedCodons}
            />
            {commit.edit !== null ? (
              <EditDetail commit={commit} />
            ) : (
              <p className="rounded-lg border border-dashed px-3 py-4 text-[12px] leading-relaxed text-muted-foreground">
                {commit.isMerge
                  ? 'A merge commit introduces no edit of its own — it joins two histories. The gene track above marks what its genotype differs from the reference at.'
                  : commit.status === 'blocked'
                    ? 'No edit was planned: the run terminated at the biosafety gate, before the planner resolved a locus.'
                    : 'This commit introduces no edit.'}
              </p>
            )}
            <GenotypeDetail commit={commit} locus={locus} />
          </TabsContent>

          <TabsContent value="checks">
            {commit.run !== null ? (
              <CheckList run={commit.run} />
            ) : (
              <p className="rounded-lg border border-dashed px-3 py-6 text-center text-[12px] text-muted-foreground">
                No agent run is attached to this commit. The pipeline runs on proposed edits;
                this commit proposed none.
              </p>
            )}
          </TabsContent>

          <TabsContent value="sim">
            <CellCanvas
              key={commit.oid}
              simulation={simulation}
              polymerizationTendency={commit.genotype.polymerizationTendency}
              genotypeLabel={commit.genotype.label}
              tendencyBasis={commit.genotype.tendencyBasis}
            />
          </TabsContent>
        </div>
      </Tabs>
    </>
  );
}

function EditDetail({ commit }: { readonly commit: CommitView }) {
  const edit = commit.edit;
  if (edit === null) return null;
  return (
    <section className="flex flex-col gap-2" aria-label="Edit detail">
      <h3 className="flex items-center gap-1.5 text-[13px] font-semibold">
        <FlaskConical className="size-4 text-primary" aria-hidden="true" />
        Structural consequence
      </h3>
      <dl className="grid grid-cols-[8rem_1fr] gap-x-3 gap-y-1 text-[11.5px]">
        <dt className="text-muted-foreground">Edit</dt>
        <dd className="font-medium">{edit.label}</dd>
        <dt className="text-muted-foreground">Change</dt>
        <dd className="font-mono">
          {edit.gene} codon {edit.codonIndex}: {edit.refCodon} → {edit.altCodon} (
          {edit.refAaName} → {edit.altAaName})
        </dd>
        <dt className="text-muted-foreground">Kind</dt>
        <dd className="font-mono">{edit.kind}</dd>
        {edit.hgvs !== null && (
          <>
            <dt className="text-muted-foreground">HGVS</dt>
            <dd className="font-mono break-all">{edit.hgvs}</dd>
          </>
        )}
        {edit.proteinHgvs !== null && (
          <>
            <dt className="text-muted-foreground">Protein</dt>
            <dd className="font-mono">
              {edit.proteinHgvs}
              {edit.legacyName !== null && (
                <span className="ml-1.5 text-muted-foreground">(legacy {edit.legacyName})</span>
              )}
            </dd>
          </>
        )}
        <dt className="text-muted-foreground">Provenance</dt>
        <dd>
          <span
            className={`rounded-full px-1.5 py-px font-mono text-[10px] ${
              edit.provenance === 'public-reference'
                ? 'bg-neutral-verdict-soft text-muted-foreground'
                : 'bg-conflict-soft text-conflict'
            }`}
          >
            {edit.provenance}
          </span>
        </dd>
        <dt className="text-muted-foreground">Confidence</dt>
        <dd className="font-mono">{edit.confidence}</dd>
      </dl>
      <p className="text-[12px] leading-relaxed">{edit.consequence}</p>
      {edit.numberingNote !== null && (
        <p className="text-[11px] leading-relaxed text-muted-foreground">{edit.numberingNote}</p>
      )}
      <p className="rounded-lg border border-dashed px-3 py-2 text-[11px] leading-relaxed text-muted-foreground">
        <strong className="font-semibold text-foreground">Annotation limits.</strong>{' '}
        {edit.limitation}
      </p>
    </section>
  );
}

function GenotypeDetail({
  commit,
  locus,
}: {
  readonly commit: CommitView;
  readonly locus: LocusView;
}) {
  const protein = commit.genotype.protein;
  const reference = locus.referenceProtein;
  return (
    <section className="flex flex-col gap-2" aria-label="Genotype">
      <h3 className="text-[13px] font-semibold">Genotype at this commit</h3>
      <dl className="grid grid-cols-[8rem_1fr] gap-x-3 gap-y-1 text-[11.5px]">
        <dt className="text-muted-foreground">Label</dt>
        <dd className="font-medium">{commit.genotype.label}</dd>
        <dt className="text-muted-foreground">Tendency</dt>
        <dd className="font-mono tnum">{commit.genotype.polymerizationTendency.toFixed(2)}</dd>
        <dt className="text-muted-foreground">Protein</dt>
        <dd className="font-mono break-all">
          {protein.split('').map((aa, index) => (
            <span
              key={index}
              className={
                reference.charAt(index) !== aa ? 'font-bold text-block underline' : undefined
              }
            >
              {aa}
            </span>
          ))}
        </dd>
      </dl>
      <p className="text-[11px] leading-relaxed text-muted-foreground">
        {commit.genotype.tendencyBasis}
      </p>
    </section>
  );
}
