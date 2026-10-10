# Stack recommendation: browser RTS roguelike

I checked this on 2026-10-10 with Node 24.21.0. A probe project with typescript 7.0.2, vite 8.3.4, vitest 5.0.3, simplex-noise 4.0.3 and @playwright/test 1.64.0 passed all four checks: `tsc --noEmit`, `vite build`, `vitest run` and `playwright test --list`.

## Versions to pin (`npm i -E`)

| Package | Version | Kind |
|---|---|---|
| simplex-noise | 4.0.3 | dependency (the only runtime one) |
| typescript | 7.0.2 | dev |
| vite | 8.3.4 | dev |
| vitest | 5.0.3 | dev |
| @playwright/test | 1.64.0 | dev |

Engine requirements: Vite 8 needs Node ^20.19 or >=22.12. Vitest 5 needs Node ^22.12, ^24 or >=26.

## Rendering: plain Canvas2D
- 150 units plus a tile map is well within Canvas2D limits if sprites are cached.
- It adds no dependencies, keeps the deterministic sim fully separate, and lets the HTML/CSS HUD sit on top cleanly.
- Phaser 4.2.1, Kaplay 3001.0.19 and Excalibur 0.32.0 each own the loop, scene graph and input. That conflicts with a custom fixed-step sim and an HTML HUD.
- PixiJS 8.22.0 is the fallback only if profiling shows the renderer is the bottleneck.

Patterns to use:
- Bake terrain into offscreen canvas chunks once. Re-bake a chunk only when a building changes it.
- Pre-render each unit type × team color × facing into a sprite cache, then draw with `drawImage`.
- Do camera with `setTransform` and scale for `devicePixelRatio`.
- Draw fog on a low-res canvas and scale it up.
- Never use `shadowBlur` or `filter` every frame.

## Pathfinding: write it ourselves (about 150 lines)
- `pathfinding` 0.4.18: last release 2016, no types, needs a `grid.clone()` on every search.
- `easystarjs` 0.4.4: last release 2020, unmaintained, and its async callback API is awkward in a fixed-step sim.
- `ngraph.path` 1.6.1: maintained, but it works on a general graph. Buildings appearing and disappearing would mean changing a graph of about 10k nodes.

Plan: 8-direction A* over flat typed arrays. Use a generation-stamped closed set so nothing needs clearing, a binary heap, an octile heuristic and no corner cutting. Cap searches at about 8 per tick. Group moves get one path plus formation offsets. Enemy waves share one Dijkstra flow field toward the player's base, recomputed when a building is placed. Add separation steering so units don't stack.

## Noise and seeded RNG
simplex-noise ships ESM, CJS and its own types. It has no seed parameter: you pass it a random function. Write the PRNG inline. The `alea` package dates from 2021 and has no types.

```ts
import { createNoise2D, type NoiseFunction2D } from 'simplex-noise';
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
// signature: createNoise2D(random?: () => number): (x, y) => number  // output in [-1, 1]
const elevation: NoiseFunction2D = createNoise2D(mulberry32(seed));
const moisture = createNoise2D(mulberry32(seed ^ 0x9e3779b9));
```

Things to watch:
- The permutation table is built when the noise function is created. Create one function per layer, each from its own derived seed.
- In the probe, seeds 42 and 43 gave the exact same value at (1.5, 2.5) but different values elsewhere. Tests for determinism and variation should sample scaled points that are not on half-integer coordinates.
- Keep separate RNG streams for the sim and for cosmetics, so visual randomness can't change the sim's results.

## Sound effects: plain WebAudio, no package
- zzfx 1.4.0 (published 2026-10-01) and 1.3.2 both use `export` without `"type": "module"`, ship no types, and run `audioContext: new AudioContext` as soon as the module loads.
- That load-time call throws a ReferenceError under Vitest/Node. In the browser it creates a suspended context before any user click.
- jsfxr 1.4.1 is a plain script file (`sfxr.js`) with no types.

Plan: write `src/audio/sfx.ts`.
- Create the `AudioContext` lazily on the first pointerdown, then call `resume()`.
- Build sounds from oscillator and gain envelopes, plus one cached white-noise buffer through a BiquadFilter for clashes, arrows and chopping.
- Limit voices to about 8 at once, with a cooldown of about 60 ms per sound.
- If zzfx presets are wanted later, copy its MIT `buildSamples` into a `.ts` file and keep the context lazy.

## Build and test
- TypeScript 7 is the native `tsc` with no programmatic API until 7.1. Its package's main export only returns the version.
- Vite 8, Vitest 5 and Playwright don't use that API, so TS 7 works. Pinning 5.9.x isn't needed.
- Avoid typescript-eslint and vite-plugin-checker, which need the API. If linting is needed, alias `"typescript": "npm:@typescript/typescript6@^6.0.3"`.
- Since TS 6: `types` defaults to `[]` and `strict` is on by default. TS 7 removes `baseUrl` and `moduleResolution: node`.

```json
{ "compilerOptions": { "target": "ES2022", "module": "ESNext", "moduleResolution": "bundler",
  "lib": ["ES2022","DOM","DOM.Iterable"], "strict": true, "noEmit": true, "isolatedModules": true,
  "verbatimModuleSyntax": true, "skipLibCheck": true, "types": ["vite/client"] },
  "include": ["src", "vite.config.ts"] }
```

- **Vite:** `vite.config.ts` uses `defineConfig` from `vitest/config` with `base: './'` so it can be hosted under a subpath.
- **Vitest:** use `environment: 'node'` for the sim, pathfinding and map-gen tests, and keep those modules free of DOM code.
- **Playwright:** 1.64.0 matches the Chromium v1248 already cached on this machine, so nothing needs downloading. Expose `window.__game` behind `?seed=&debug` so tests can assert on state with `page.evaluate` and speed up time.

Probe project: `/private/tmp/claude-502/-Users-openclaw-projects-roguelike-rts/33e6e381-d844-4c62-b192-2f2929a293b9/scratchpad/ts7probe`

Sources: [TypeScript 7.0 announcement](https://devblogs.microsoft.com/typescript/?p=5246), [Nx: TypeScript 7](https://nx.dev/docs/kb/typescript-7), [TS 7 tooling breakage](https://dev.to/dev_encyclopedia/why-your-typescript-7-upgrade-broke-eslint-ts-jest-and-ts-morph-385k), [TS 6.0 changes](https://blog.logrocket.com/typescript-v6-migration-guide/)