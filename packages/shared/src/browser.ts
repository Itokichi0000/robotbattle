import { z } from 'zod';

/**
 * Browser pages run under a CSP without 'unsafe-eval'. Before compiling its
 * fast parsers, Zod 4 probes for eval with `Function("")`; the probe is caught,
 * but every page then reports a CSP violation. Browser bundles call this once
 * at start-up so Zod skips the probe and keeps its regular parser (D-069).
 * The game server does not call it and keeps the compiled parsers.
 */
export function configureValidationForBrowser(): void {
  z.config({ jitless: true });
}
