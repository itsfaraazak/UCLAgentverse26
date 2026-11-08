import type { EvidenceService } from '../evidence/types';
import { runAgent } from './agent';
import type {
  AssertRequest,
  CommentRequest,
  CreateBranchRequest,
  HumanIdentity,
  MergeRequest,
  MergeResponse,
  PromptRequest,
  SignoffRequest,
  StreamEvent,
} from './api-types';
import { gateRequest, storableText } from './gate';
import type { GeminiClient } from './gemini';
import {
  isBlocked,
  latestInterpretation,
  latestOfKind,
  ofKind,
  referenceFor,
  refusalReasons,
  requiredRoleFor,
} from './merge';
import { extractVariantQuery } from './query';
import { StoreError, slugify, type WorkbenchStore } from './store';
import { assertionsOn, runRequiredChecks, type ToolContext } from './tools';
import {
  MAIN_BRANCH,
  SIGNOFF_ROLES,
  type Actor,
  type AiStatus,
  type AnyDelta,
  type GateData,
  type WbBranch,
  type WorkspaceSnapshot,
} from './types';

export const SAFETY_GATE: Actor = { kind: 'agent', name: 'Safety gate', model: null };

export interface WorkbenchDeps {
  readonly store: WorkbenchStore;
  readonly evidence: () => EvidenceService;
  readonly gemini: () => GeminiClient | null;
  readonly ai: () => AiStatus;
}

export type StreamRunner = (emit: (event: StreamEvent) => void) => Promise<void>;

function human(by: HumanIdentity): Actor {
  return { kind: 'human', name: by.name, role: by.role };
}

function oneLine(text: string, max: number): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

function genesOn(history: readonly AnyDelta[]): string[] {
  const genes = ofKind(history, 'evidence')
    .map((d) => d.data.evidence.variant.gene)
    .filter((g): g is string => g !== null);
  return [...new Set(genes)];
}

function branchNameFor(text: string, gate: GateData): string {
  if (gate.verdict === 'block' && gate.redacted) return `blocked/${gate.requestDigest.slice(0, 8)}`;
  const prefix = gate.mode === 'edit' ? 'edit' : 'review';
  const words = text.split(/\s+/).slice(0, 6).join(' ');
  return `${prefix}/${slugify(extractVariantQuery(text) ?? words)}`;
}

export class WorkbenchService {
  constructor(private readonly deps: WorkbenchDeps) {}

  get store(): WorkbenchStore {
    return this.deps.store;
  }

  snapshot(): WorkspaceSnapshot {
    return this.store.snapshot(this.deps.ai());
  }

  reset(): WorkspaceSnapshot {
    this.store.reset();
    return this.snapshot();
  }

  createBranch(req: CreateBranchRequest): WorkspaceSnapshot {
    const from = req.from ?? { branch: MAIN_BRANCH, delta: null };
    this.store.createBranch({ name: `work/${slugify(req.title)}`, title: req.title, from, by: human(req.by) });
    return this.snapshot();
  }

  private requireWorkable(name: string): WbBranch {
    const b = this.store.requireBranch(name);
    if (b.status === 'running') throw new StoreError(409, `An agent is already running on ${name}.`);
    if (b.status === 'merged') throw new StoreError(409, `${name} is merged; fork a new branch to continue.`);
    return b;
  }

  /**
   * Screen the request, then return the run. Everything that can be refused
   * with a status code is decided here, before the response starts streaming.
   */
  private prepareRun(input: {
    branch: string;
    text: string;
    by: HumanIdentity;
    kind: 'prompt' | 'comment';
    onDelta: string | null;
  }): StreamRunner {
    const store = this.store;
    let branch = this.requireWorkable(input.branch);
    if (branch.status === 'blocked') {
      throw new StoreError(409, `${branch.name} is blocked by policy; the agent will not run on it.`);
    }
    if (input.kind === 'comment' && branch.name === MAIN_BRANCH) {
      throw new StoreError(400, 'Ask the agent on a review branch, not on main.');
    }
    if (input.onDelta !== null && !store.ancestry(branch.name).some((d) => d.id === input.onDelta)) {
      throw new StoreError(400, `Delta ${input.onDelta} is not on ${branch.name}.`);
    }

    // The gate runs before anything is stored or any model is called.
    const gate = gateRequest(input.text, genesOn(store.ancestry(branch.name)));
    const text = storableText(input.text, gate);
    const withheld = text !== input.text;

    if (branch.name === MAIN_BRANCH) {
      branch = store.createBranch({
        name: branchNameFor(input.text, gate),
        title: withheld ? `Withheld request ${gate.requestDigest}` : oneLine(input.text, 80),
        from: { branch: MAIN_BRANCH, delta: null },
        by: human(input.by),
      });
    }
    const name = branch.name;
    store.setStatus(name, 'running');

    return async (emit) => {
      try {
        emit({ type: 'status', branch: name, status: 'running' });
        emit({ type: 'progress', branch: name, message: 'Screening request' });
        const trigger =
          input.kind === 'prompt'
            ? store.append(name, {
                kind: 'prompt',
                actor: human(input.by),
                title: withheld ? 'Request withheld by policy' : oneLine(input.text, 100),
                data: { text },
              })
            : store.append(name, {
                kind: 'comment',
                actor: human(input.by),
                title: withheld ? 'Comment withheld by policy' : oneLine(input.text, 100),
                data: { text, onDelta: input.onDelta },
                parents: this.commentParents(name, input.onDelta),
              });
        emit({ type: 'delta', delta: trigger });
        const gateDelta = store.append(name, {
          kind: 'gate',
          actor: SAFETY_GATE,
          title: `Gate: ${gate.verdict} (${gate.category})`,
          body: gate.reason,
          data: gate,
          parents: [trigger.id],
        });
        emit({ type: 'delta', delta: gateDelta });
        if (gate.verdict === 'block') return;

        await runAgent({
          branch: name,
          trigger: { kind: input.kind, text: input.text, deltaId: trigger.id, mode: gate.mode, author: input.by.name },
          emit,
          evidence: this.deps.evidence(),
          store,
          gemini: this.deps.gemini(),
        });
      } catch {
        emit({ type: 'error', message: 'The run stopped unexpectedly. Everything recorded so far is kept.' });
      } finally {
        const status = isBlocked(store.ancestry(name)) ? 'blocked' : 'open';
        store.setStatus(name, status);
        emit({ type: 'status', branch: name, status });
        emit({ type: 'done', snapshot: this.snapshot() });
      }
    };
  }

  preparePrompt(req: PromptRequest): StreamRunner {
    return this.prepareRun({ ...req, kind: 'prompt', onDelta: null });
  }

  /** A stream runner when the agent is asked to reply, else the snapshot after appending. */
  comment(req: CommentRequest): StreamRunner | WorkspaceSnapshot {
    if (req.askAgent) return this.prepareRun({ ...req, kind: 'comment' });
    const b = this.store.requireBranch(req.branch);
    if (req.onDelta !== null && !this.store.ancestry(b.name).some((d) => d.id === req.onDelta)) {
      throw new StoreError(400, `Delta ${req.onDelta} is not on ${b.name}.`);
    }
    this.store.append(b.name, {
      kind: 'comment',
      actor: human(req.by),
      title: oneLine(req.text, 100),
      data: { text: req.text, onDelta: req.onDelta },
      parents: this.commentParents(b.name, req.onDelta),
    });
    return this.snapshot();
  }

  /** A comment follows the branch head and also points at the delta it discusses. */
  private commentParents(name: string, onDelta: string | null): string[] {
    const b = this.store.requireBranch(name);
    const head = b.head ?? b.parent?.delta ?? null;
    return [...new Set([head, onDelta].filter((v): v is string => v !== null))];
  }

  async assert(req: AssertRequest): Promise<WorkspaceSnapshot> {
    const b = this.requireWorkable(req.branch);
    const history = this.store.ancestry(b.name);
    const evidenceDelta = latestOfKind(history, 'evidence');
    if (evidenceDelta === null) throw new StoreError(400, 'There is no evidence on this branch yet.');
    const service = this.deps.evidence();

    const base = assertionsOn(history);
    const by = req.by.name;
    const a = req.assertion;
    const next =
      a.kind === 'segregation'
        ? { ...base, segregation: { value: a.value, reason: a.reason, by } }
        : { ...base, dismissed: [...base.dismissed.filter((d) => d.code !== a.code), { code: a.code, reason: a.reason, by }] };
    try {
      service.interpret(evidenceDelta.data.evidence, next);
    } catch (err) {
      if (err instanceof RangeError) throw new StoreError(400, err.message);
      throw err;
    }

    const interp = latestInterpretation(history);
    const ref = interp !== null && interp.data.evidenceDelta === evidenceDelta.id ? referenceFor(history, interp) : null;
    const clinvar = ref?.data.comparison.clinvar ?? (await service.fetchEvidence(evidenceDelta.data.evidence.variant)).clinvar;

    const assertion = this.store.append(b.name, {
      kind: 'assertion',
      actor: human(req.by),
      title: a.kind === 'dismiss' ? `Dismissed ${a.code}` : `Segregation: ${a.value ? 'segregates with disease' : 'does not segregate'}`,
      body: a.reason,
      data: a,
    });
    const ctx: Pick<ToolContext, 'store' | 'branch' | 'evidence' | 'add' | 'progress'> = {
      store: this.store,
      branch: b.name,
      evidence: service,
      add: (input) => this.store.append(b.name, input) as never,
      progress: () => {},
    };
    runRequiredChecks(ctx, evidenceDelta, clinvar, assertion.id);
    return this.snapshot();
  }

  signoff(req: SignoffRequest): WorkspaceSnapshot {
    const b = this.requireWorkable(req.branch);
    if (b.name === MAIN_BRANCH) throw new StoreError(400, 'Sign off on a review branch, not on main.');
    const history = this.store.ancestry(b.name);
    if (b.status === 'blocked' || isBlocked(history)) {
      throw new StoreError(409, `${b.name} is blocked by policy and cannot be signed off.`);
    }
    if (req.by.role === null || !(SIGNOFF_ROLES as readonly string[]).includes(req.by.role)) {
      throw new StoreError(400, `by.role must be one of: ${SIGNOFF_ROLES.join(', ')}.`);
    }
    const interp = latestInterpretation(history);
    if (interp === null) throw new StoreError(409, 'There is no classification to sign off yet.');
    const requiredRole = requiredRoleFor(history);
    if (requiredRole !== null && req.by.role !== requiredRole) {
      throw new StoreError(403, `Policy requires sign-off from: ${requiredRole}.`);
    }
    const agent = interp.data.interpretation.classification;
    const agrees = req.finalClassification === agent;
    const major = referenceFor(history, interp)?.data.comparison.severity === 'major';
    if ((!agrees || major) && req.rationale.trim().length === 0) {
      throw new StoreError(
        400,
        agrees
          ? 'A rationale is required: the classification disagrees with ClinVar.'
          : `A rationale is required to sign off ${req.finalClassification} over the classifier's ${agent}.`,
      );
    }
    this.store.append(b.name, {
      kind: 'signoff',
      actor: human(req.by),
      title: `Signed off: ${req.finalClassification}`,
      body: req.rationale || 'Agrees with the classifier.',
      data: {
        finalClassification: req.finalClassification,
        agentClassification: agent,
        agreesWithAgent: agrees,
        rationale: req.rationale,
        covers: interp.id,
      },
    });
    return this.snapshot();
  }

  merge(req: MergeRequest): MergeResponse {
    const b = this.store.requireBranch(req.branch);
    if (b.name === MAIN_BRANCH) throw new StoreError(400, 'main cannot be merged into itself.');
    const status = this.store.mergeStatus(b.name);
    if (!status.allowed || b.head === null) {
      return { merged: false, reasons: refusalReasons(status), snapshot: this.snapshot() };
    }
    const main = this.store.requireBranch(MAIN_BRANCH);
    const signoff = latestOfKind(this.store.ancestry(b.name), 'signoff');
    this.store.append(MAIN_BRANCH, {
      kind: 'merge',
      actor: human(req.by),
      title: `Merge ${b.name} into main`,
      body: signoff ? `${signoff.data.finalClassification}, signed off by ${signoff.actor.name}.` : '',
      data: { branch: b.name, branchHead: b.head },
      parents: main.head === null ? [b.head] : [main.head, b.head],
    });
    this.store.setStatus(b.name, 'merged');
    return { merged: true, reasons: [], snapshot: this.snapshot() };
  }
}
