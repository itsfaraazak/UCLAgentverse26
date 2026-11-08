import { createHash } from 'node:crypto';
import type { Delta, DeltaDAGView, DeltaInput } from './types';
import { isRecord } from './types';

function canonicalJson(value: unknown): string {
  if (value === null || typeof value === 'number' || typeof value === 'boolean') {
    return JSON.stringify(value);
  }
  if (typeof value === 'string') {
    return JSON.stringify(value);
  }
  if (typeof value === 'undefined') {
    return 'null';
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(',')}]`;
  }
  if (!isRecord(value)) {
    return JSON.stringify(String(value));
  }
  const keys = Object.keys(value).sort();
  const parts: string[] = [];
  for (let i = 0; i < keys.length; i += 1) {
    const key = keys[i];
    if (key === undefined) continue;
    const entry = value[key];
    if (typeof entry === 'undefined') continue;
    parts.push(`${JSON.stringify(key)}:${canonicalJson(entry)}`);
  }
  return `{${parts.join(',')}}`;
}

export function deltaIdFor(input: Omit<Delta, 'id'>): string {
  const material = canonicalJson({
    kind: input.kind,
    author: input.author,
    subject: input.subject,
    payload: input.payload,
    parents: input.parents,
  });
  return createHash('sha256').update(material, 'utf8').digest('hex').slice(0, 16);
}

/**
 * Append-only DAG of attributed deltas. Disagreement forks the record;
 * nothing is rewritten in place.
 */
export class DeltaDAG implements DeltaDAGView {
  private readonly byId = new Map<string, Delta>();
  private readonly order: Delta[] = [];

  add(input: DeltaInput): Delta {
    for (let i = 0; i < input.parents.length; i += 1) {
      const parentId = input.parents[i];
      if (parentId === undefined) continue;
      if (!this.byId.has(parentId)) {
        throw new Error(`DeltaDAG: unknown parent id ${parentId}`);
      }
    }
    const parents = Object.freeze([...input.parents]);
    const base: Omit<Delta, 'id'> = {
      kind: input.kind,
      author: input.author,
      subject: input.subject,
      payload: structuredClone(input.payload),
      parents,
      createdAt: input.createdAt,
    };
    const id = input.id ?? deltaIdFor(base);
    if (this.byId.has(id)) {
      throw new Error(`DeltaDAG: duplicate id ${id}`);
    }
    const stored: Delta = Object.freeze({
      ...base,
      id,
    });
    this.byId.set(id, stored);
    this.order.push(stored);
    return stored;
  }

  get(id: string): Delta {
    const found = this.byId.get(id);
    if (found === undefined) {
      throw new Error(`DeltaDAG: unknown id ${id}`);
    }
    return found;
  }

  all(): Delta[] {
    return this.order.slice();
  }

  /** Ancestry of `id`, oldest first, including the node itself. */
  history(id: string): Delta[] {
    const seen = new Set<string>();
    const out: Delta[] = [];
    const walk = (nodeId: string): void => {
      if (seen.has(nodeId)) return;
      seen.add(nodeId);
      const node = this.get(nodeId);
      for (let i = 0; i < node.parents.length; i += 1) {
        const parentId = node.parents[i];
        if (parentId === undefined) continue;
        walk(parentId);
      }
      out.push(node);
    };
    walk(id);
    return out;
  }
}
