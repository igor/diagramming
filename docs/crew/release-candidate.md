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

## Verification

The builder reported 43 passing tests and all three rendered examples. The coordinator independently installed the lockfile in a fresh copy, installed managed Chromium, verified browser selection and ran all 43 tests: 43 pass, zero skipped. Tested source files match the repository byte-for-byte. The installed personal skill's 13 files match the coordinator's starting SHA-256 snapshot.

Codex project discovery returned the candidate skill enabled at the documented project location. An isolated Claude Code-style installation successfully exported a static diagram using its own installed dependencies. This checks packaging, not a live Claude Code model invocation. Skill frontmatter validation passed. Coordinator inspected all three final stills and representative decoded video frames; labels remain readable, fragments stay on their corridors and settled states are held.

## Clean-quickstart correction

The first exact README export command failed because the output parent directory did not exist. This was a documentation omission; the exporter retained its intended refusal behavior and the source test baseline remained passing. Coordinator added the missing parent-directory setup and clarified the CLI contract before rerunning. The initial worker dispatch also hit a mistyped terminal handle; the runtime rejected it, and dispatch succeeded after resolving the correct handle. No unintended terminal received a task.

The corrected README commands succeeded in the clean copy. Independently inspected MP4 metadata: H.264/yuv420p, 1280×640, 240 frames, exactly eight seconds. The offline desktop player screenshot showed the final still and playback controls. Default contrast ratios: primary text 16.29:1, secondary text 7.56:1 and meaningful marks 4.83:1 against white; primary text on emphasis 13.35:1.

## Evaluation dispatch

ROUTE: release review → full GLM 5.3, read-only. Rubric: plan adherence, dependency scope, error handling, behavior-pinning tests, installation accuracy, licensing and evidence for release claims. Findings are evidence for coordinator judgment, not a delegated release verdict. Linux CI remains pending until the private candidate is pushed.

## Review corrections

Independent review identified two concrete cleanup items: CLI help omitted the output-parent rule, and four README paragraphs exceeded the writing register's em-dash guidance. The coordinator also found overbroad statements about custom-font licensing and universal video-link behavior, and clarified Git's refusal of non-empty clone destinations. These are addressed with a bounded literal patch, including an assertion in the existing help test. The suite count remains 43. Disclosed platform and harness limitations remain unchanged; Linux CI is still pending. The review found no implementation drift or new dependency beyond the plan.

SPEC: coordinator-authored correction patch because the changes are small and exact. ROUTE: release corrections → GLM 5.3 Flash Background. Recheck the corrected claims and help assertion after execution, then run a bounded independent follow-up review.

The correction worker applied the literal patch without functional changes. Coordinator independently reran the complete suite in the repository: 43 pass, zero failures/skips. All relative documentation links resolve and skill validation passes. Authored source/docs pass the staged whitespace check. Untouched upstream OFL notices retain their original CRLF/trailing whitespace, and browser-generated SVG/HTML retain serialization whitespace; these are excluded from formatting checks to preserve source notices and generated hashes.

ROUTE: correction review → full GLM 5.3, reusing the reviewer's existing context for a bounded read-only pass of the changed help text, assertion and README paragraphs.

## Gate outcome

The follow-up review returned no new findings and confirmed both initial actionable findings resolved. Coordinator verdict: accepted as a private release candidate, based on the independent 43-test runs, clean setup checks, actual Codex discovery, packaging verification, visual inspection and privacy audit. Remaining platform limits are disclosed. Public visibility and a release announcement remain outside this gate; the next check is GitHub Actions on Ubuntu/Node 22.

## GitHub verification

Commit `2924755` passed [GitHub Actions run 34349450854](https://github.com/igor/diagram-authoring/actions/runs/34349450854): clean checkout, Node 22, pinned dependency install, managed Chromium with system dependencies, FFmpeg, 43 tests passing with zero failures/skips, and a full example export. The run completed successfully in 1m43s. GitHub emitted a non-blocking annotation that its v4 checkout/setup-node action wrappers use the runner's Node 24 compatibility override; the actual project test runtime was Node 22 as configured.

All task worker terminals are closed. Final source comparison still confirms all 13 files of the personal skill unchanged. Repository visibility remains private. The final documentation-only handoff commit skips CI; no executable, dependency, workflow or example changed after the successful run.
