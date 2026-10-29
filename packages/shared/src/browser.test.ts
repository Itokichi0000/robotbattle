import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { configureValidationForBrowser } from './browser';
import { profilePatchSchema } from './protocol';

describe('browser validation (CSP without unsafe-eval, D-069)', () => {
  it('switches Zod to its eval-free parser and schemas still validate', () => {
    configureValidationForBrowser();
    expect(z.config().jitless).toBe(true);
    expect(profilePatchSchema.parse({ showNameOnArena: true })).toEqual({ showNameOnArena: true });
    expect(profilePatchSchema.safeParse({ showNameOnArena: 'yes' }).success).toBe(false);
  });
});
