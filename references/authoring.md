# Authoring rules

## Visual binding

| Role | Default |
| --- | --- |
| Ground | White #FFFFFF |
| Primary text | #17212B |
| Secondary text | #4B5563 |
| Meaningful marks | #6B7280 |
| Emphasis | Pale blue #DBEAFE, under dark text |

This palette is a starting theme, not a mandatory aesthetic; for another explicitly requested design system, bind the same mechanics to that system's established tokens instead of mixing palettes. Emphasis is a highlighter area behind dark text, never the sole stroke or text conveying meaning. It does not encode approval, confidentiality or any domain status by itself; state those meanings in labels and geometry. Use a neutral treatment for inactive objects; do not fade required explanatory text below the contrast floor.

Use IBM Plex Sans 400 for diagram titles and body, IBM Plex Mono 400 for concise metadata. Bundled Latin font subsets cover the examples; confirm glyph coverage for another language. Add other weights only with matching embedded fonts (see the exporter's `--fonts` manifest), not accidental synthetic font changes.

Placement grid: 8 units, with 4-unit subdivisions for small internal details. Spacing ladder: 8 / 16 / 24 / 48 / 96. This governs placement, not optical stroke widths or radii. A useful starting point is 1.5–2px meaningful strokes, square document/record frames and 16–24px internal padding. Use shape differences when they carry a real distinction; avoid giving every object a decorative card treatment.

Evaluate type after display scaling. Aim for 18–22px body labels, no smaller than 16px at the intended reading size; metadata normally 12–14px. Title size follows the composition, not a mandatory hero. Break long text deliberately or put the explanation in a nearby caption. Keep line baselines far enough apart for the actual font bounds, including fallback fonts.

## Composition

- Put the main relationship on a clear reading axis. Reserve a route corridor before placing labels.
- Connect actual relationships. Row alignment can falsely imply a one-to-one mapping; stagger or group independently when that mapping does not exist.
- Give endpoints distinct ports or attachment edges. Keep arrowheads, if used, clear of text and object outlines. A static diagram must express direction through labels, arrowheads or unmistakable reading order; motion is supplementary.
- Containers denote membership, access or scope only when the content warrants it. Label the boundary. Do not nest boxes merely to fill space.
- A gate represents a condition. Name the condition and what crosses it; distinguish an automated step from a human judgment. An animation demonstrates the proposed rule and cannot prove the underlying system enforces it.
- Allocate space for the final state before animating accumulation. Existing material stays put. If a document gains a section, animate that section rather than shifting its whole contents.
- Keep object identity stable. Copy, derive, append, rewrite and move mean different things. A public derivative does not require its confidential source to disappear or cross a boundary.
- Explicitly separate hours, days or future business events from the seconds of the animation. Do not make a later conditional event look like the next automatic operation.
- Three to five salient objects is often comfortable. Treat that as a density warning, not an arbitrary maximum. Split when a reader must track too many simultaneous relations.

## Motion

Use motion only to show a meaningful change or causal order. Static branches, comparisons and scope diagrams may be complete without it. Avoid ambient loops, ornamental pulses, bouncing, random variations or drawing every border onto the page.

For arrivals, use two beats: transport along its actual path, then a durable change at the destination. A glow alone is insufficient. Preserve a readable final hold, usually a quarter of the timeline or longer; a one-shot timeline that remains settled is the default. Loop only when requested or justified by the destination.

Two established easing curves:

| Curve | SMIL keySplines | Use |
| --- | --- | --- |
| Travel | 0.42 0 0.16 1 | Movement between objects |
| Settle | 0.22 0.9 0.3 1 | Arrival/fill/change settling |

Visibility gates may use discrete timing. A trail recording a route can be linear. Do not add a new easing personality merely for variation.

All animated elements share one duration and a common start, with events placed in keyTimes. Avoid chained begin="other.end" clocks. keyTimes, values/keyPoints and keySplines counts must agree. Every timestamp must be reproducible by pauseAnimations() and setCurrentTime(t). This is required for exports and scrubbing.

Transport travels through reserved empty corridors, never across another object or a label. Multiple departures can overlap if causality remains clear; do not serialize independent events solely to make a longer movie. Nor should simultaneous motion overwhelm the reader.

Keep timeline behavior in SVG SMIL. The HTML wrapper may control its clock, but the source drawing must not depend on wrapper JavaScript to create its animation nodes. The exported animated SVG should work independently; the frozen SVG must contain no active animation.

## What the tests do not establish

Passing geometry, contrast and playback tests establishes rendering quality. Comprehension needs a reader with the intended context. Ask what the viewer believes changed and why; if the answer is wrong, inspect the explanation and source assumptions before adding more visual detail. Keep unresolved claims visible in the accompanying delivery rather than presenting polished geometry as evidence of correctness.
