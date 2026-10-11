# Battle lane: deviations from the final-pass plan

Full report: `.agent-status/fixes2-battle.md`.

- B8: the WebKit fog fallback upsamples the layer's 1-px alpha in JS and box-blurs alpha only (no canvas readback), instead of the prototype's getImageData + RGBA box blur. Measured 10.6 ms per fog update for the prototype path in WebKit; the new path is within noise of HEAD.
- B9: overlapping edge labels stack vertically; Spent markers are not merged into "2 Spent · m:ss".
- B7: `centerOn` keeps the top-bar clamp (opening view, H, Space and group recall frame as before); only pans and zooms may bring the top rows down below the tracker column. The band is the tracker column (card plus Boon and modifier rows), not the Horn or coach card.
- B2: on phones, two- and three-cost command buttons wrap their costs under a smaller icon instead of hiding the third cost. Touch also pinch-zooms (two fingers).
- B4: a "Wrath" callout replaces "The Regent Uprooted" when the Regent tears free with Root Hearts standing.
- B11: no audio change; the `telegraph` event already plays `boss_telegraph`.
