/**
 * Narrow local declaration for the slice of the WebGPU API this directory
 * touches. TypeScript's bundled `lib.dom` does not ship WebGPU types, and
 * pulling in `@webgpu/types` for one capability probe is not worth the
 * global pollution. We only ever ask "is there an adapter?".
 */
export interface GpuAdapterProbe {
  requestAdapter(options?: { powerPreference?: 'low-power' | 'high-performance' }): Promise<object | null>;
}
