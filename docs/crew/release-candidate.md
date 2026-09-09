# Release candidate

## Scope

Prepare a fresh, neutral repository for review before public release. Include a cross-harness skill, an exporter, reusable examples and a README that explains outcomes and installation. Codex and Claude Code are required installation paths; other harnesses get a manual path without untested compatibility claims. Keep the existing personal installation unchanged.

## Dispatch

ROUTE: diagram-release → default (spec: lunaroute/glm-5.3 → exec: lunaroute/glm-5.3-flash-background). A reviewed verbatim plan will govern implementation. The user approved the proposed release shape, so the brainstorming gate is not repeated. Coordinator owns design decisions, verification and publishing authority; worker owns only assigned files. Work takes place in the current workspace with an explicit repository target, without a parallel checkout.

Expected source baseline: 34 exporter tests. Plan must preserve the existing safety and rendering checks, replace personal visual defaults, add portable dependency setup and font configuration, and document clean installation. Software/docs/examples use MIT; bundled fonts retain their upstream OFL notices. No public visibility change or release announcement in this phase.
