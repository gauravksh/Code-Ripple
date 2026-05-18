# Changelog

## 0.3.0

- Cockpit redesign of Workspace Pulse: real codicon icons, merge-readiness headline with blockers/cautions, Focus First attention list, passive warnings, and inline actions.
- Status bar now opens the dashboard on click and shows the active repo name when multiple are analyzed.
- Real-time updates: re-analyze on live document edits (debounced) in addition to file save and git state changes.
- Active repo auto-follows the editor: switching the active file to a different repo activates that repo in the cockpit.
- New engines: `mergeReadiness` and `focus` (deterministic, grounded ranking by risk / blast / churn / coverage gaps).
- Dashboard top-files: fixed text overlap by stacking per-file purpose under the path inside a proper grid row.

## 0.2.1

- Active-repo switcher: clickable Pulse rows, title-bar action, status-bar picker, and `CodeRipple: Switch Active Repository` command.
- Status bar now shows the active repo name when multiple are analyzed.

## 0.2.0

- Multi-repo discovery: sibling repos inside one workspace folder are now each analyzed independently.
- Flow + dashboard click-through fixed: nodes now resolve files against the correct repo root.
- Per-file purpose: each changed file now gets a short "why" line (heuristic or LLM).
- Change intent inference: feature / bugfix / refactor / auth / security / perf / api / config / tests / docs / infra classification with confidence + rationale.
- Trust score (0–100) with positive/negative signals (tests touched, risk, truncation, orphan files, big churn, …).
- Smart test intelligence: recommended tests, likely-impacted tests, missing-coverage files.
- Blast radius: external files, modules, and tests likely impacted by the change.
- Grounded Q&A: new `CodeRipple: Ask About Changes` command (LLM-grounded with deterministic fallback).
- Dashboard surfaces intent / trust / smart-tests / blast-radius cards and per-file purpose.
- Flow hover panel shows the per-file purpose.

## 0.1.0

- Initial scaffold: Workspace Pulse, Impact Map, Flow Diagram, agent + heuristic fallback.
