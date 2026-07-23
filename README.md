# PaperBrain Console

PaperBrain Console is an Obsidian desktop control surface for the external
[PaperBrain Python pipeline](https://github.com/DannyWANGD/PaperBrain).
It starts and stops pipeline commands, shows run progress and errors, and opens
the digests, briefs, notes, and PDFs written into the active vault.

The release keeps the Python backend separate from the Obsidian JavaScript
bundle, but the console provides a controlled one-click installer. PaperBrain
Console is desktop-only because it starts local child processes and reads files
outside Obsidian's mobile sandbox.

The MIT License in this repository covers only the plugin code. The external
backend, papers, model services, and generated or downloaded content remain
subject to their own licenses and terms.

## Quick Start

1. In BRAT, choose **Add beta plugin** and enter
   `https://github.com/DannyWANGD/obsidian-paperbrain`.
2. Enable **PaperBrain Console**, open it, and select **Install backend**.
3. Review the exact local and network changes, then select **Install backend**
   in the confirmation dialog. Existing Conda is preferred. If Conda is not
   available, the same action installs a private, verified Miniforge runtime.
4. Select **Open API key file**, replace the placeholder for your provider,
   and save the file.
5. Select **Validate setup**, choose a run mode, and select **Run**.

No terminal command, repository clone, or separate Python installation is
required for this normal desktop flow. PaperBrain does not require any other
Obsidian plugin; the companion plugins documented later are optional.

## Requirements

- Obsidian desktop 1.5.0 or later
- Approximately 1 GB of free disk space for the managed runtime and packages
- Network access to GitHub Releases, conda-forge, and PyPI during installation
- An API account and key for the LLM provider selected in the backend

Advanced users can instead supply a compatible PaperBrain backend in the
0.3.x series and Python 3.9 or later.

## Beta Installation Details

Until the plugin is available in the Obsidian Community directory, install a
GitHub Release through BRAT (recommended for the beta):

1. Install and enable BRAT in Obsidian.
2. Choose **Add beta plugin** and enter
   `https://github.com/DannyWANGD/obsidian-paperbrain`.
3. Enable **PaperBrain Console** under Community plugins.

For a manual installation:

1. Download `main.js`, `manifest.json`, and `styles.css` from the same release.
2. Place them in `<vault>/.obsidian/plugins/paperbrain/`.
3. Reload Obsidian and enable **PaperBrain Console** under Community plugins.

Do not mix files from different release versions.

## Controlled Backend Installer

**Install backend** always checks saved, active, PATH, inferred, and common
Conda locations first. When a working Conda installation is found, it is reused
and the installer creates or reuses its environment named `wd`.

When no Conda installation works, PaperBrain downloads Miniforge 26.3.2-2 from
the official conda-forge GitHub Release and installs it under
`~/.paperbrain/runtime/miniforge3`. This private installation does not modify
system PATH, initialize a shell, register system Python, or require an
administrator account. Windows x64, macOS x64/arm64, and Linux x64/arm64 are
supported. Windows arm64 is not currently supported by this automatic path.

The installer then:

1. Creates or reuses `wd` with Python 3.10.
2. Downloads the fixed PaperBrain backend wheel and hash-locked requirements
   from the `backend-0.3.4` GitHub Release.
3. Verifies every downloaded installer or backend asset against an embedded
   SHA-256 value before executing or installing it.
4. Installs locked dependencies from `https://pypi.org/simple` and installs the
   backend wheel without resolving unpinned dependencies.
5. Creates configuration under `~/.paperbrain/config` and points it at the
   active vault. Existing configuration and `.env` values are preserved.

The confirmation dialog appears before any download or environment change.
Installation progress and failures remain visible in the console, and failed
temporary downloads are removed. The plugin never asks for, reads, or stores
the API key in Obsidian settings.

To remove a PaperBrain-managed installation, close Obsidian and delete
`~/.paperbrain/runtime/miniforge3` and, if no longer needed,
`~/.paperbrain/config`. Do not delete an existing external Conda installation
that PaperBrain merely reused.

## Configure PaperBrain Console

Open **Settings -> Community plugins -> PaperBrain Console** and use
**Install or repair** for first-time setup, then **Validate setup**. Detection
checks only the saved backend directory, the active vault, current and common
Conda locations, and the `wd` entry returned by `conda env list --json`. It
never scans entire drives or stores an API key. Package installation occurs
only after the explicit installer confirmation.

- **Backend directory** is the checkout containing `script/paperbrain.py`.
- **wd Python** is the absolute Python executable in the existing `wd` Conda
  environment.
- **Default provider** controls the provider selected for a new run.
- **Advanced** contains CLI mode, config and vault overrides, podcast default,
  and the cancellation timeout.

**Validate setup** runs `doctor config`, `doctor env`, and `doctor llm` in that
order. It never adds `--live`, so validation does not send a model request.

Use the brain-circuit ribbon icon or the **Open console** command. Choose a
preset and date, run the pipeline, and inspect the timeline and artifacts in
the same view. The **Validate configuration** command checks local paths before
a run; `paperbrain doctor` performs deeper backend checks.

## Optional Companion Plugins

PaperBrain Console works independently, but the development vault also tests
BRAT, Dataview, Audio Player, floating toc, Highlightr, Style Settings,
Immersive Translate, Smart Connections, Copilot, and Claudian. See
[Companion Obsidian plugins](docs/COMPANION_PLUGINS.md) for exact plugin IDs,
tested versions, recommended uses, and privacy or UI cautions. No third-party
plugin code is bundled or redistributed by PaperBrain.

## Data, Network, and Cost Disclosures

PaperBrain Console itself does not provide telemetry, advertising, or paid
features. It stores only its local runtime settings in Obsidian. It does not
store API keys.

When you initiate an action, the plugin can:

- after explicit confirmation, download fixed Miniforge and PaperBrain release
  assets, verify their checksums, run the unattended Miniforge installer when
  Conda is absent, create `wd`, and install locked packages from PyPI;
- start a configured local executable and send it PaperBrain CLI arguments;
- read run records and generated artifacts under the configured vault;
- read the configured backend and config paths to validate them;
- request cancellation and terminate its own child processes during shutdown;
- copy redacted diagnostics to the system clipboard only when you explicitly
  request it. Configured paths and common credential patterns are masked on a
  best-effort basis; review the result before sharing it;
- open a paper URL in your browser when you select a Web action.

The external backend performs network requests to paper sources such as arXiv
and Hugging Face and to the LLM provider configured by you. Depending on the
pipeline mode, paper metadata, extracted PDF text, or rendered paper pages may
be sent to that provider. Provider accounts may incur usage charges. Review the
backend configuration and the provider's privacy and retention terms before
processing confidential or licensed material.

The backend writes digests, notes, PDFs, assets, indexes, cache files, and run
records to the configured vault. Back up important vaults and test new versions
with non-critical data first.

For SSRF protection, backend requests made to untrusted resource and PDF URLs
use DNS-pinned direct connections and do not honor environment HTTP proxy
settings. Paper-source and LLM API clients have separate networking behavior.
Networks that require an outbound proxy may therefore need an explicit trusted
egress design before PDF and resource-link validation will work.

## Compatibility

| Plugin | PaperBrain backend | Obsidian |
| --- | --- | --- |
| 0.4.x | 0.3.1 to <0.4.0; installer selects 0.3.4 | 1.5.0 or later, desktop |
| 0.3.x | 0.3.1 to <0.4.0 | 1.5.0 or later, desktop |
| 0.2.x | 0.3.1 to <0.4.0 | 1.5.0 or later, desktop |

New backend or plugin minor versions may change their command or result
contract. Keep both sides within a tested row of this table.

## Troubleshooting

- If installation fails, keep the console open and retry **Install backend**.
  Incomplete managed Miniforge files and temporary downloads are removed before
  a controlled retry.
- Corporate firewalls must allow GitHub Release downloads, conda-forge package
  channels, and `https://pypi.org/simple`. Checksum failures are never bypassed.
- If validation cannot resolve `paperbrain`, set the CLI executable to its
  absolute path. GUI applications often receive a different `PATH` than a
  terminal.
- If script mode fails, verify the Python executable and confirm the backend
  path contains `script/paperbrain.py`.
- If the console cannot find run records, confirm **Vault path** and the
  backend's effective vault path are identical, then run validation again.
- If a command exits without a valid JSON result, run the same command in a
  terminal and inspect its stderr and `Run_Records` error file.
- A non-zero exit or a backend payload with `ok: false` is treated as failure;
  the plugin does not report fallback output as a successful run.

## Development and Releases

```bash
npm ci
npm test
npm run check
```

Source lives under `src/`. The production build generates `main.js`; generated
bundles are intentionally excluded from source commits and attached to GitHub
Releases instead. A release tag must exactly match `manifest.json` and include
`main.js`, `manifest.json`, and `styles.css` from one successful build.

See [CONTRIBUTING.md](CONTRIBUTING.md), [SECURITY.md](SECURITY.md), and
[CHANGELOG.md](CHANGELOG.md) for project policies.
