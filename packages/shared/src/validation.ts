import { z } from 'zod';

/**
 * The one place that imports Zod: every schema module takes `z` from here.
 *
 * Browser pages run under a CSP without 'unsafe-eval'. Zod 4 decides whether to
 * compile fast object parsers while each object schema is being built, probing
 * for eval with `Function("")`; the probe is caught, but every page then reports
 * a CSP violation. Shared builds its schemas when its modules load, so the switch
 * has to run before any of them, and module order guarantees that only if the
 * schema modules depend on this file. A call from app start-up ran too late (D-069).
 * The game server keeps the compiled parsers.
 */
if (typeof window !== 'undefined') z.config({ jitless: true });

export { z };
