import { isAcmgClassification, type AcmgCode } from '../acmg/types';
import type {
  AssertRequest,
  CommentRequest,
  CreateBranchRequest,
  HumanIdentity,
  MergeRequest,
  PromptRequest,
  SignoffRequest,
} from './api-types';
import { StoreError } from './store';
import type { AssertionData } from './types';

/** Strict request-body parsing: unknown or malformed input is a 400, never coerced. */

const ACMG_CODES: readonly AcmgCode[] = ['PVS1', 'PS1', 'PM2', 'PP3', 'PP1', 'BA1', 'BS1', 'BP4'];
const MAX_TEXT = 4000;
const MAX_NAME = 80;

type Obj = Record<string, unknown>;

function bad(message: string): never {
  throw new StoreError(400, message);
}

function obj(value: unknown, what: string): Obj {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) bad(`${what} must be an object.`);
  return value as Obj;
}

function onlyKeys(o: Obj, allowed: readonly string[], what: string): void {
  const extra = Object.keys(o).filter((k) => !allowed.includes(k));
  if (extra.length > 0) bad(`${what} has unknown field(s): ${extra.join(', ')}.`);
}

function str(o: Obj, key: string, max: number, opts: { allowEmpty?: boolean } = {}): string {
  const v = o[key];
  if (typeof v !== 'string') bad(`${key} must be a string.`);
  const t = v.trim();
  if (!opts.allowEmpty && t.length === 0) bad(`${key} must not be empty.`);
  if (t.length > max) bad(`${key} is longer than ${max} characters.`);
  return t;
}

function bool(o: Obj, key: string): boolean {
  const v = o[key];
  if (typeof v !== 'boolean') bad(`${key} must be a boolean.`);
  return v;
}

function nullableStr(o: Obj, key: string, max: number): string | null {
  const v = o[key];
  if (v === null || v === undefined) return null;
  if (typeof v !== 'string') bad(`${key} must be a string or null.`);
  const t = v.trim();
  if (t.length > max) bad(`${key} is longer than ${max} characters.`);
  return t.length === 0 ? null : t;
}

function identity(value: unknown): HumanIdentity {
  const o = obj(value, 'by');
  onlyKeys(o, ['name', 'role'], 'by');
  return { name: str(o, 'name', MAX_NAME), role: nullableStr(o, 'role', MAX_NAME) };
}

export function parseCreateBranch(body: unknown): CreateBranchRequest {
  const o = obj(body, 'body');
  onlyKeys(o, ['title', 'from', 'by'], 'body');
  let from: CreateBranchRequest['from'] = null;
  if (o.from !== null && o.from !== undefined) {
    const f = obj(o.from, 'from');
    onlyKeys(f, ['branch', 'delta'], 'from');
    from = { branch: str(f, 'branch', 120), delta: nullableStr(f, 'delta', 64) };
  }
  return { title: str(o, 'title', 200), from, by: identity(o.by) };
}

export function parsePrompt(body: unknown): PromptRequest {
  const o = obj(body, 'body');
  onlyKeys(o, ['branch', 'text', 'by'], 'body');
  return { branch: str(o, 'branch', 120), text: str(o, 'text', MAX_TEXT), by: identity(o.by) };
}

export function parseComment(body: unknown): CommentRequest {
  const o = obj(body, 'body');
  onlyKeys(o, ['branch', 'text', 'onDelta', 'askAgent', 'by'], 'body');
  return {
    branch: str(o, 'branch', 120),
    text: str(o, 'text', MAX_TEXT),
    onDelta: nullableStr(o, 'onDelta', 64),
    askAgent: bool(o, 'askAgent'),
    by: identity(o.by),
  };
}

function assertion(value: unknown): AssertionData {
  const o = obj(value, 'assertion');
  if (o.kind === 'dismiss') {
    onlyKeys(o, ['kind', 'code', 'reason'], 'assertion');
    if (typeof o.code !== 'string' || !(ACMG_CODES as readonly string[]).includes(o.code)) {
      bad(`assertion.code must be one of ${ACMG_CODES.join(', ')}.`);
    }
    return { kind: 'dismiss', code: o.code as AcmgCode, reason: str(o, 'reason', 1000) };
  }
  if (o.kind === 'segregation') {
    onlyKeys(o, ['kind', 'value', 'reason'], 'assertion');
    return { kind: 'segregation', value: bool(o, 'value'), reason: str(o, 'reason', 1000) };
  }
  return bad("assertion.kind must be 'dismiss' or 'segregation'.");
}

export function parseAssert(body: unknown): AssertRequest {
  const o = obj(body, 'body');
  onlyKeys(o, ['branch', 'assertion', 'by'], 'body');
  return { branch: str(o, 'branch', 120), assertion: assertion(o.assertion), by: identity(o.by) };
}

export function parseSignoff(body: unknown): SignoffRequest {
  const o = obj(body, 'body');
  onlyKeys(o, ['branch', 'finalClassification', 'rationale', 'by'], 'body');
  if (!isAcmgClassification(o.finalClassification)) bad('finalClassification must be an ACMG classification.');
  return {
    branch: str(o, 'branch', 120),
    finalClassification: o.finalClassification,
    rationale: str(o, 'rationale', MAX_TEXT, { allowEmpty: true }),
    by: identity(o.by),
  };
}

export function parseMerge(body: unknown): MergeRequest {
  const o = obj(body, 'body');
  onlyKeys(o, ['branch', 'by'], 'body');
  return { branch: str(o, 'branch', 120), by: identity(o.by) };
}
