import { afterEach, describe, expect, it, vi } from 'vitest';

describe('validation in browsers (CSP without unsafe-eval, D-069)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it('switches Zod to its eval-free parser before any shared schema is built', async () => {
    vi.resetModules();
    vi.stubGlobal('window', {});
    // Loading the shared entry point is what a page bundle does first.
    const shared = await import('./index');
    const { z } = await import('./validation');
    expect(z.config().jitless).toBe(true);
    expect(shared.profilePatchSchema.parse({ showNameOnArena: true })).toEqual({
      showNameOnArena: true,
    });
    expect(shared.profilePatchSchema.safeParse({ showNameOnArena: 'yes' }).success).toBe(false);
  });
});
