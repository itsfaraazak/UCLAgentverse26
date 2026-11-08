import type { Gpu } from 'vgpu/mock';

export type VisualAdapterKind = 'mock' | 'node' | 'hardware' | 'software';

export type VisualGpu = Gpu & {
  readonly visualAdapter: VisualAdapterKind;
  readonly adapterLabel: string;
};

const ADAPTER_ENV = 'VGPU_VISUAL_ADAPTER';

function isVisualAdapterKind(value: string): value is VisualAdapterKind {
  return value === 'mock' || value === 'node' || value === 'hardware' || value === 'software';
}

/**
 * CI default is `mock` (no native GPU). Dawn is opt-in:
 * `VGPU_VISUAL_ADAPTER=node` (auto), `hardware`, or `software`.
 * `dawn` and `auto` are aliases for `node`.
 */
export function resolveVisualAdapter(): VisualAdapterKind {
  const raw = process.env[ADAPTER_ENV]?.trim().toLowerCase();
  if (raw === undefined || raw === '') return 'mock';
  if (raw === 'dawn' || raw === 'auto') return 'node';
  if (isVisualAdapterKind(raw)) return raw;
  throw new Error(
    `Unknown ${ADAPTER_ENV}=${JSON.stringify(raw)}. Use mock, node, hardware, software, dawn, or auto.`,
  );
}

function nodeAdapterLabel(gpu: Gpu): string | undefined {
  if (!('adapter' in gpu)) return undefined;
  const adapter = gpu.adapter;
  if (typeof adapter !== 'object' || adapter === null || !('name' in adapter)) return undefined;
  const name = adapter.name;
  return typeof name === 'string' ? name : undefined;
}

function attachMeta(gpu: Gpu, kind: VisualAdapterKind): VisualGpu {
  return Object.assign(gpu, {
    visualAdapter: kind,
    adapterLabel: nodeAdapterLabel(gpu) ?? kind,
  });
}

export async function createVisualGpu(): Promise<VisualGpu> {
  const kind = resolveVisualAdapter();
  if (kind === 'mock') {
    const { init } = await import('vgpu/mock');
    return attachMeta(await init(), kind);
  }
  const { init } = await import('vgpu/node');
  if (kind === 'hardware') return attachMeta(await init({ adapter: 'hardware' }), kind);
  if (kind === 'software') return attachMeta(await init({ adapter: 'software' }), kind);
  return attachMeta(await init(), kind);
}
