// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ProteinViewer } from './ProteinViewer';
import { syntheticPdb } from './__fixtures__/pdb';

// No mocks: real dynamic import of the engine, real three.js, real
// WebGPU→WebGL selection. jsdom exposes neither navigator.gpu nor a WebGL
// context, which is exactly the "poor GL support" demo machine.

afterEach(() => vi.restoreAllMocks());

describe('ProteinViewer on a machine with no usable GPU', () => {
  it('degrades to the text fallback with the reasons, never a blank box', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { container } = render(<ProteinViewer loadPdb={async () => syntheticPdb('VAL')} />);
    const alert = await screen.findByRole('alert', {}, { timeout: 5000 });
    expect(alert.textContent).toContain('could not start WebGPU or WebGL 2');
    expect(alert.textContent).toContain('WebGPU not exposed by this browser');
    expect(alert.textContent).toContain('Glutamate (Glu, E) → Valine (Val, V)');
    expect(container.querySelector('canvas')).toBeNull();
    expect(container.querySelector('[data-renderer="none"]')).not.toBeNull();
  });
});
