/**
 * Seam between the screens and the run layer. Production uses the real module; the dev-only
 * screen gallery (src/app/dev) substitutes a fixture-backed double.
 */
import * as runModule from '../run';

export type RunApi = typeof runModule;

export const realRunApi: RunApi = runModule;
