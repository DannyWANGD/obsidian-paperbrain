# Changelog

All notable changes to this project are documented in this file. Releases
follow [Semantic Versioning](https://semver.org/).

## [Unreleased]

## [0.3.0] - 2026-07-23

### Added

- Plugin-level process management that keeps a run alive when its console view
  is closed and restores the active context when the view is reopened.
- Inline three-step setup guidance with constrained backend and `wd` Conda
  detection plus offline config, environment, and provider diagnostics.
- First paid-run disclosure and an explicit confirmation before every forced
  state reset.
- Compact paper summary cards for narrow Obsidian sidebars.
- A documented, machine-readable snapshot of optional companion Obsidian
  plugins tested in the PaperBrain development vault.

### Changed

- Simplified the primary settings to runtime status, backend directory, `wd`
  Python, and default provider; specialist overrides now live under Advanced.
- Replaced fixed status colors and very small uppercase text with Obsidian theme
  variables, readable type, keyboard-accessible tabs, and reduced-motion rules.
- Made state, history, and brief reads asynchronous, prevented overlapping
  polls, and skipped unchanged state files by timestamp and size.

### Fixed

- Closing the console no longer terminates a background run.
- Runs that finish without an open console retain their final result and issue
  a concise Obsidian notice.
- Poll-driven refreshes retain the active panel, input focus, and scroll
  position.

## [0.2.0] - 2026-07-22

### Added

- Standalone plugin repository with reproducible builds, tests, and automated
  GitHub Release assets.
- Support for an installed `paperbrain` command as well as a local Python
  backend checkout.
- Separate backend and Obsidian vault path settings with configuration checks.
- Explicit documentation of the backend, network, privacy, cost, process, and
  file-access requirements.

### Changed

- Removed developer-machine paths and detected the active desktop vault by
  default.
- Made local calendar dates independent of UTC conversion.
- Made child-process cancellation, shutdown, output handling, and exit status
  reporting deterministic.

### Security

- Non-zero exits, invalid JSON results, and backend `ok: false` payloads are no
  longer presented as successful runs.
- Backend command, exit-code, and compatibility metadata are validated before
  a result can be presented as successful.
- Clipboard diagnostics redact configured paths and common credential patterns
  and use an explicit privacy-aware action label.
- Cancellation timers are bound to one process, and plugin shutdown terminates
  every child process owned by the plugin.

[Unreleased]: https://github.com/DannyWANGD/obsidian-paperbrain/compare/0.3.0...HEAD
[0.3.0]: https://github.com/DannyWANGD/obsidian-paperbrain/compare/0.2.0...0.3.0
[0.2.0]: https://github.com/DannyWANGD/obsidian-paperbrain/releases/tag/0.2.0
