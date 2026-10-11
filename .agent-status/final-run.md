# Run lane: deviations from the final fix plan

The full report is in `fixes2-run.md`.

- **R1 notice variant.** A mouse device in a small window gets a 'window' notice: "Best in a larger window / Embermarch is laid out for 1280×720 and up / Enlarge the window or go full screen for the full game." It has no Copy link and no touch line. Phones and tablets with a coarse pointer only get the planned copy and the planned touch sentence.
- **R1 label floor.** On small touch screens the app's 11px label floor drops to 0 through a new `--label-min` token (theme.css). Without this, the run header labels overflowed the header. Desktop keeps 11px.
- **R4 Blood Moon.** An Elite can still roll Blood Moon in its open roll, as its only hardship (8% of Elites over 1000 maps). The forced negative never is Blood Moon, and no Elite holds two negatives.
- **R6 extra line.** The Nests & Waves Spent step now says "for at least 45 s after its wave breaks (longer for a far Nest)", to match interface 4. The README Spent line says the same.
- **R8 extras.** The README Resolve bullet mentions Stragglers after a defeat or a Retreat with no soldiers left (R5). The Shift + RMB row describes S1 (a gathering Tiller starts a foundation at once, then goes back to gathering).

GDD lines for the sim lane (S10): §B Resolve, Stragglers now also follow a Retreat with no survivors. §K Elite modifiers, one negative at most, added only when the rolls hold none, never Blood Moon as the added one. §O, a phone and tablet notice, and the menus scale down on small touch screens (7px root floor).
