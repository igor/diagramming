---
name: diagramming
description: Create legible still and animated explanatory diagrams with standalone SVG, an offline HTML preview, PNG and MP4 outputs. Use for information flows, document changes, decisions, branching, convergence and accumulation.
metadata:
  short-description: Experimental SVG diagram authoring and export
---

# Diagramming

Status: experimental. This skill ships SVG examples, licensed fonts and a tested SVG/PNG/MP4 exporter. A passing render does not prove that a diagram explains its subject, and nothing here authorizes publication by itself.

## Start with the explanation

Identify the claim the reader should understand, the objects, the meaningful relationships, and the change (if any). Use the user's source and preserve its uncertainty. Ask only when a missing fact changes the diagram's meaning. If the user names a canvas or document, inspect it with the relevant tool before adapting it.

Distinguish a context gap from a drawing problem: a viewer who does not know what an object means needs a short definition or caption. More arrows, labels or animation cannot resolve inconsistent source facts. Flag contradictions; omit an unresolved branch from a draft rather than silently repairing the story.

Choose the smallest useful composition: sequence, branch, convergence, persistent record, gate, or comparison. These are starting points, not a closed taxonomy. Split a scene when distinct claims, unrelated timescales or too many paths compete. Keep the original source unchanged unless the user requested edits.

## Author

Read [references/authoring.md](references/authoring.md) for the visual, composition and motion rules. Its palette and fonts are a neutral starting theme, not a mandatory aesthetic; for another explicitly requested design system, bind the same mechanics to that system's established tokens instead of mixing palettes.

Start with an SVG still that makes sense at its intended display size. A short title/caption may supply necessary context. Author the **complete settled state in the base markup**, then add declarative SMIL to show how it is reached. Keep the source SVG as the editable master; HTML is a preview wrapper, and PNG/MP4 are derived exports. A still diagram does not need animation.

Use the bundled examples as working contracts: [assets/arrival.svg](assets/arrival.svg) (arrival → settlement, animated), [assets/convergence.svg](assets/convergence.svg) (two sources merging into one record, animated) and [assets/branching.svg](assets/branching.svg) (a static branch with two outcomes). Adapt their geometry to the actual story; do not force every diagram into a two-box composition. Keep each source self-contained: viewBox, opaque painted background, title/description, internal styles, no script or external resources. The exporter supplies the selected fonts.

For a phone destination, compose a separate portrait SVG when the landscape layout would make text too small. Do not merely shrink the landscape drawing. Preserve meaning and reading order between variants. For a fixed slide or video, design to that destination's aspect ratio first.

## Preview and export

Read [references/export.md](references/export.md) before running the exporter. Run from this skill's installed directory (the repository root) or use absolute paths; outputs always go to a **new** directory in the user's chosen workspace and never overwrite prior exports:

```sh
node scripts/export.mjs /absolute/path/scene.svg --out /absolute/path/new-export-folder --duration 8 --width 1280 --fps 30 --formats svg,png,mp4
```

`scene.svg` and `preview.html` accompany requested formats; `scene.static.svg` and `scene.png` capture the selected time (default final state). MP4 records the authored timeline. GIF is not implemented. By default the exporter embeds the bundled IBM Plex Sans and IBM Plex Mono; `--fonts /path/to/fonts.json` selects a different set (schema and rules in references/export.md). Changing the font manifest does not rewrite family names already present in an authored SVG, and does not guarantee glyph coverage for them.

Use the still-first HTML preview for review: play, pause, replay, scrub, 0.1× speed and reduced-motion behavior. Export only the formats the user needs; use `--formats svg,png` when video is unnecessary. Never claim an export exists until the files have been checked.

## Verify and deliver

- View the final still at actual destination size. Check labels, borders, spacing and reading order; inspect hover/focus states if modifying the wrapper.
- For motion, inspect the initial state, a transit frame, each meaningful settlement, and the final hold. A fragment must not cross an unrelated object. Confirm that unchanged content actually stays unchanged.
- Measure text contrast (at least 4.5:1) and meaningful marks (at least 3:1).
- For portable SVG, open the exported file independently with network disabled. Ensure its fonts, background and static geometry survive outside the preview. For video, check the manifest and ffprobe result and view decoded frames; an existing MP4 file alone proves nothing.
- Check reduced-motion navigation and no-JS stills for a new/changed preview. Physical touch, Safari and screen-reader behavior are separate checks; state what remains untested.

Deliver clickable local paths and one sentence about what the diagram communicates. Include any unresolved source/context issue. A passing render does not prove comprehension: ask what the viewer believes changed and why, and keep unresolved claims visible in the delivery rather than presenting polished geometry as evidence of correctness.

## Scope

This repository is the installable skill folder. See [README.md](README.md) for installation into specific harnesses, the quickstart, limitations and licensing.
