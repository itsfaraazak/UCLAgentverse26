import { describe, expect, it } from 'vitest';
import { DeltaDAG } from './dag';

describe('DeltaDAG', () => {
  it('is append-only and returns a copy from all()', () => {
    const dag = new DeltaDAG();
    dag.add({
      kind: 'intent',
      author: 'IntentAgent',
      subject: 'parsed-intent',
      payload: { targets: ['HBB'] },
      parents: [],
      createdAt: 0,
    });
    const copy = dag.all();
    copy.pop();
    expect(dag.all()).toHaveLength(1);
  });

  it('rejects unknown parent ids', () => {
    const dag = new DeltaDAG();
    expect(() =>
      dag.add({
        kind: 'screen',
        author: 'BiosafetyGateAgent',
        subject: 'biosafety-screen',
        payload: {},
        parents: ['missing'],
        createdAt: 1,
      }),
    ).toThrow(/unknown parent/);
  });

  it('rejects duplicate ids', () => {
    const dag = new DeltaDAG();
    dag.add({
      id: 'fixed-id',
      kind: 'intent',
      author: 'IntentAgent',
      subject: 'parsed-intent',
      payload: { n: 1 },
      parents: [],
      createdAt: 0,
    });
    expect(() =>
      dag.add({
        id: 'fixed-id',
        kind: 'screen',
        author: 'BiosafetyGateAgent',
        subject: 'biosafety-screen',
        payload: { n: 2 },
        parents: [],
        createdAt: 1,
      }),
    ).toThrow(/duplicate id/);
  });

  it('walks ancestry oldest-first, including the node', () => {
    const dag = new DeltaDAG();
    const a = dag.add({
      kind: 'intent',
      author: 'IntentAgent',
      subject: 'a',
      payload: {},
      parents: [],
      createdAt: 0,
    });
    const b = dag.add({
      kind: 'screen',
      author: 'BiosafetyGateAgent',
      subject: 'b',
      payload: {},
      parents: [a.id],
      createdAt: 1,
    });
    const c = dag.add({
      kind: 'verdict',
      author: 'VerifierAgent',
      subject: 'c',
      payload: {},
      parents: [b.id],
      createdAt: 2,
    });
    expect(dag.history(c.id).map((d) => d.subject)).toEqual(['a', 'b', 'c']);
    expect(dag.get(a.id).id).toBe(a.id);
  });

  it('assigns a stable content-addressed id when none is supplied', () => {
    const dagA = new DeltaDAG();
    const dagB = new DeltaDAG();
    const input = {
      kind: 'intent' as const,
      author: 'IntentAgent',
      subject: 'parsed-intent',
      payload: { targets: ['HBB'], operation: 'repair' },
      parents: [] as string[],
      createdAt: 0,
    };
    expect(dagA.add(input).id).toBe(dagB.add(input).id);
  });
});
