# CodeRipple — Copilot Change Intelligence

See how your Copilot edits ripple through the codebase.

CodeRipple turns a multi-file change session into:

- **Workspace Pulse** — a compact cockpit (repo, branch, changes, risk, tests, one-line summary).
- **Impact Map** — semantic clusters → files → symbols, with drill-down.
- **Flow Diagram** — a visual graph of how the change propagates across modules.

Everything runs locally inside VS Code. When the Copilot Language Model API is available, CodeRipple uses it for semantic clustering and risk reasoning. Otherwise it falls back to a deterministic heuristic engine — you always get something useful.

## Features

- Auto-analyze on save / git state change (debounced).
- Sidebar with Workspace Pulse and Impact Map.
- Webview flow diagram with layered SVG layout, cluster halos, risk colouring, and node→file reveal.
- Strict JSON schema for the agent output — no hallucinated files.
- Privacy-first: no file contents are sent to the LM unless you opt in.

## Commands

| Command                     | Title                |
| --------------------------- | -------------------- |
| `coderipple.analyze`        | Analyze Changes      |
| `coderipple.refresh`        | Refresh Views        |
| `coderipple.openFlow`       | Open Flow Diagram    |
| `coderipple.explainCluster` | Explain This Cluster |
| `coderipple.toggleAuto`     | Toggle Auto-Analyze  |
| `coderipple.clearCache`     | Clear Cache          |
| `coderipple.showMetrics`    | Show Local Metrics   |

## Settings

See the `coderipple.*` settings (auto-analyze, debounceMs, model, maxFiles, languageMode, includeUntracked, includeSnippets, logLevel).

## Build

```bash
npm install          # install dev dependencies
npm run bundle       # produce out/extension.js (esbuild, production)
```

Press F5 in VS Code to launch an Extension Development Host with the
bundled extension loaded.

### Package

```bash
npx --yes @vscode/vsce package --no-dependencies --allow-missing-repository
```

Produces `coderipple-<version>.vsix` in the project root. Install it locally
with **Extensions: Install from VSIX…** in VS Code, or share the file
directly.

### Publish to the Marketplace

```bash
npx --yes @vscode/vsce login odysseylabs                # one-time, paste PAT
npx --yes @vscode/vsce publish                          # re-packages and uploads
# or upload an already-built vsix:
npx --yes @vscode/vsce publish --packagePath coderipple-0.3.0.vsix
```

The Personal Access Token must come from the Azure DevOps organization that
owns the `odysseylabs` publisher, with **Marketplace → Manage** scope.

## Privacy

CodeRipple sends only paths, change kinds, line counts, symbol names, and reference edges to the language model. File contents are never transmitted unless `coderipple.includeSnippets` is enabled. All processing happens in-process; there is no external server.

## License

MIT
