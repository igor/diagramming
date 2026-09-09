# Release candidate

## Scope

Prepare a fresh, neutral repository for review before public release. Include a cross-harness skill, an exporter, reusable examples and a README that explains outcomes and installation. Codex and Claude Code are required installation paths; other harnesses get a manual path without untested compatibility claims. Keep the existing personal installation unchanged.

## Dispatch

ROUTE: diagram-release → default (spec: lunaroute/glm-5.3 → exec: lunaroute/glm-5.3-flash-background). A reviewed verbatim plan will govern implementation. The user approved the proposed release shape, so the brainstorming gate is not repeated. Coordinator owns design decisions, verification and publishing authority; worker owns only assigned files. Work takes place in the current workspace with an explicit repository target, without a parallel checkout.

Expected source baseline: 34 exporter tests. Plan must preserve the existing safety and rendering checks, replace personal visual defaults, add portable dependency setup and font configuration, and document clean installation. Software/docs/examples use MIT; bundled fonts retain their upstream OFL notices. No public visibility change or release announcement in this phase.

## Plan review

Coordinator read the full plan and independently checked all 33 ordered replacement anchors against the source. Test arithmetic: 34 retained plus 9 additions, expected 43. Review tightened a pixel comparator whose proposed tolerance would count white as emphasis, made the first export independent of FFmpeg, added dependency setup to both personal install paths, and guarded project installation against existing targets. Temporary verification uses fresh directories without deletion. Source-specific plan and briefs remain outside the release repository to avoid exposing machine paths.

The spec writer also ran an unrequested temporary build simulation while preparing its plan. Those results are worker-reported only; they do not replace the separate execution and coordinator verification gates. Further simulation was stopped once the plan was available for review.

## Build dispatch

ROUTE: release build → GLM 5.3 Flash Background, following the reviewed plan. Expected deliverables: root skill, exporter and tests, neutral examples, font notices, package lock, CI and README. Coordinator owns clean installation checks, visual acceptance, privacy review, independent evaluation and commits. No live skill installation or publication is authorized by this dispatch.
