# Session handoff

Updated: 2026-09-10

## What changed

- Renamed the repository and portable skill to `diagramming`. Installation examples now use `$diagramming` in Codex and `/diagramming` in Claude Code. Existing rendered-example manifests retain their original generator name as provenance; the installed personal skill is unchanged.
- Rename verification: skill validator passed and all 43 exporter tests passed locally, with zero skips. Only names, metadata, installation references and the packaging assertion changed; rendering behavior is unchanged.
- Created a neutral experimental release candidate with an installable skill, deterministic exporter, three examples, licensed fonts and Codex/Claude Code installation instructions.
- Independent macOS clean-copy verification: 43 tests passed with managed Chromium; documented still and MP4 exports succeeded after adding the missing output-parent setup to the README.
- Ubuntu/Node 22 verification passed [GitHub Actions](https://github.com/igor/diagramming/actions/runs/34349450854) on commit `2924755`: all 43 tests, zero skips, and a full example export. Independent release review and its correction follow-up are complete.
- Codex project skill discovery succeeded. Claude Code-style folder packaging and export succeeded; a live Claude Code model invocation was not tested.
- The original personal skill remains unchanged. Candidate repository is private.

## Next steps

- Review the README and examples with the owner, then obtain approval to change repository visibility to public.

## Open questions

- Public visibility remains a user decision. Windows/WSL, physical mobile devices, Safari and screen-reader behavior remain unverified.

## Decisions

- Ship a portable skill folder and CLI, with neutral visual defaults and optional font configuration. Avoid a plugin wrapper, installer service or application in this release.
- Treat SVG as the editable source; HTML, PNG and MP4 are derived review/sharing outputs. Software, guidance and examples use MIT; bundled fonts retain OFL notices.
