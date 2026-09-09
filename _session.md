# Session handoff

Updated: 2026-09-09

## What changed

- Created a neutral experimental release candidate with an installable skill, deterministic exporter, three examples, licensed fonts and Codex/Claude Code installation instructions.
- Independent macOS clean-copy verification: 43 tests passed with managed Chromium; documented still and MP4 exports succeeded after adding the missing output-parent setup to the README.
- Codex project skill discovery succeeded. Claude Code-style folder packaging and export succeeded; a live Claude Code model invocation was not tested.
- The original personal skill remains unchanged. Candidate repository is private.

## Next steps

- Independent release review is complete. Verify Linux CI after the private push, then obtain public-release approval.

## Open questions

- Public visibility remains a user decision. Windows/WSL, physical mobile devices, Safari and screen-reader behavior remain unverified.

## Decisions

- Ship a portable skill folder and CLI, with neutral visual defaults and optional font configuration. Avoid a plugin wrapper, installer service or application in this release.
- Treat SVG as the editable source; HTML, PNG and MP4 are derived review/sharing outputs. Software, guidance and examples use MIT; bundled fonts retain OFL notices.
