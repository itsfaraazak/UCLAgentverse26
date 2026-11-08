import type { AcmgClassification } from '../acmg/types';
import type { AnyDelta, AssertionData, BranchStatus, WorkspaceSnapshot } from './types';

/**
 * HTTP contract for `/api/workbench/*`. Shared by the route handlers and the
 * client. Every mutating route returns the full snapshot so the client never
 * has to merge partial state.
 *
 * Human identity is a self-declared name + role (no auth in this prototype).
 * Agents never call these routes; sign-off and merge are only reachable from
 * a human request.
 */

export interface HumanIdentity {
  readonly name: string;
  readonly role: string | null;
}

/** GET /api/workbench -> WorkspaceSnapshot */

/** POST /api/workbench/branches */
export interface CreateBranchRequest {
  readonly title: string;
  readonly from: { readonly branch: string; readonly delta: string | null } | null;
  readonly by: HumanIdentity;
}

/**
 * POST /api/workbench/prompt
 * Response: `application/x-ndjson`, one `StreamEvent` per line.
 */
export interface PromptRequest {
  readonly branch: string;
  readonly text: string;
  readonly by: HumanIdentity;
}

/**
 * POST /api/workbench/comment
 * When `askAgent` is true the response is an NDJSON stream exactly like
 * /prompt (the agent replies on the branch); otherwise it is a snapshot.
 */
export interface CommentRequest {
  readonly branch: string;
  readonly text: string;
  readonly onDelta: string | null;
  readonly askAgent: boolean;
  readonly by: HumanIdentity;
}

/** POST /api/workbench/assert -> snapshot. Re-runs the classifier deterministically. */
export interface AssertRequest {
  readonly branch: string;
  readonly assertion: AssertionData;
  readonly by: HumanIdentity;
}

/** POST /api/workbench/signoff -> snapshot */
export interface SignoffRequest {
  readonly branch: string;
  readonly finalClassification: AcmgClassification;
  readonly rationale: string;
  readonly by: HumanIdentity;
}

/** POST /api/workbench/merge -> MergeResponse */
export interface MergeRequest {
  readonly branch: string;
  readonly by: HumanIdentity;
}

export interface MergeResponse {
  readonly merged: boolean;
  /** Why it was refused, one line per failing check. Empty when merged. */
  readonly reasons: readonly string[];
  readonly snapshot: WorkspaceSnapshot;
}

/** POST /api/workbench/reset -> snapshot. Clears the workspace. */

export type StreamEvent =
  | { readonly type: 'delta'; readonly delta: AnyDelta }
  | { readonly type: 'status'; readonly branch: string; readonly status: BranchStatus }
  /** Human-readable progress line ("Calling gemini-4-argon…"). Not persisted. */
  | { readonly type: 'progress'; readonly branch: string; readonly message: string }
  | { readonly type: 'done'; readonly snapshot: WorkspaceSnapshot }
  | { readonly type: 'error'; readonly message: string };

export interface ApiError {
  readonly error: string;
}
