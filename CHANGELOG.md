# Changelog

All notable changes to this project are documented in this file. Releases
follow [Semantic Versioning](https://semver.org/).

## [Unreleased]

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

[Unreleased]: https://github.com/DannyWANGD/obsidian-paperbrain/compare/0.2.0...HEAD
[0.2.0]: https://github.com/DannyWANGD/obsidian-paperbrain/releases/tag/0.2.0
