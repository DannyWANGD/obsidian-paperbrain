# PaperBrain Console

PaperBrain Console is an Obsidian desktop control surface for the external
[PaperBrain Python pipeline](https://github.com/DannyWANGD/Cutting-edge_Paper_Reading).
It starts and stops pipeline commands, shows run progress and errors, and opens
the digests, briefs, notes, and PDFs written into the active vault.

The Python backend is not bundled with this plugin. PaperBrain Console is a
desktop-only integration because it starts a local child process and reads
files outside Obsidian's mobile sandbox.

The MIT License in this repository covers only the plugin code. The external
backend, papers, model services, and generated or downloaded content remain
subject to their own licenses and terms.

## Quick Start

If PaperBrain and the `wd` Conda environment already work on this computer,
plugin setup is three steps:

1. In BRAT, choose **Add beta plugin** and enter
   `https://github.com/DannyWANGD/obsidian-paperbrain`.
2. Open PaperBrain Console and select **Detect again**. The plugin finds the
   saved backend/current vault and the existing `wd` Python environment.
3. Select **Validate setup**, then choose a run mode and select **Run**.

That is the complete normal installation flow. PaperBrain does not require any
other Obsidian plugin. The companion plugins documented later are optional.
Only users who do not yet have the external PaperBrain pipeline need the
one-time backend setup below.

## Requirements

- Obsidian desktop 1.5.0 or later
- A compatible PaperBrain backend version 0.3.1 or later in the 0.3.x series
- Python 3.9 or later when using a backend checkout
- An API account and key for the LLM provider selected in the backend

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

## One-Time Backend Setup

Skip this section when your existing PaperBrain backend already runs in `wd`.
For a new machine, clone and prepare the backend separately from the plugin.
From the backend repository root:

```bash
conda create -n wd python=3.10 -y
conda activate wd
python -m pip install --upgrade pip
python -m pip install -e .
```

All backend commands and development checks in this project assume the `wd`
Conda environment. An editable install registers the `paperbrain` command and
also supports the plugin's Python script mode. Configure the backend YAML and
environment values as described by the backend project. Keep API keys in its
`.env` file or the operating-system environment, never in this plugin
repository.

## Configure PaperBrain Console

Open **Settings -> Community plugins -> PaperBrain Console** and use
**Detect again** once, then **Validate setup**. Detection checks only the saved
backend directory, the active vault, the current Conda environment, and the
`wd` entry returned by `conda env list --json`. It never scans other drives,
creates an environment, installs packages, or stores an API key.

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
| 0.3.x | 0.3.1 to <0.4.0 | 1.5.0 or later, desktop |
| 0.2.x | 0.3.1 to <0.4.0 | 1.5.0 or later, desktop |

New backend or plugin minor versions may change their command or result
contract. Keep both sides within a tested row of this table.

## Troubleshooting

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
