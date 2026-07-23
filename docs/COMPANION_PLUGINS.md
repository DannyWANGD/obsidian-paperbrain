# Companion Obsidian plugins

PaperBrain Console has no required Obsidian plugin dependencies. The following
community plugins are enabled in the development vault and were checked with
PaperBrain Console 0.3.0. Install only the capabilities that fit your workflow.

| Plugin | Tested version | PaperBrain workflow | Notes |
| --- | ---: | --- | --- |
| BRAT (`obsidian42-brat`) | 2.0.2 | Install and update the PaperBrain beta from GitHub Releases | Recommended only while PaperBrain is in beta. |
| Dataview (`dataview`) | 0.5.68 | Query PaperBrain note properties and build research queues | PaperBrain-generated Markdown remains usable without Dataview. |
| Audio Player (`obsidian-audio-player`) | 0.1.1 | Play generated podcast audio with richer controls | Optional; Obsidian's native audio element remains supported. |
| floating toc (`floating-toc`) | 2.7.1 | Navigate long deep-analysis notes and research briefs | Most useful in reading views, not the console itself. |
| Highlightr (`highlightr-plugin`) | 1.2.2 | Add manual evidence and review highlights to generated notes | Highlights are user annotations and are not overwritten intentionally by PaperBrain. |
| Style Settings (`obsidian-style-settings`) | 1.0.9 | Tune the active Obsidian theme around the console | PaperBrain uses Obsidian theme variables and does not require a specific theme. |
| Immersive Translate (`immersive-translate`) | 0.0.2 | Translate generated research notes | Its floating controls can cover narrow panels; collapse the overlay while operating the console. |
| Smart Connections (`smart-connections`) | 4.1.8 | Explore semantic relationships among PaperBrain notes | Indexing and model/privacy settings belong to Smart Connections. |
| Copilot (`copilot`) | 3.2.3 | Ask follow-up questions across generated notes | Uses its own provider configuration and may incur separate model charges. |
| Claudian (`realclaudian`) | 2.0.24 | Advanced coding-agent workflows inside the vault | High-permission power-user tool; review its command and file-write permissions separately. |

The exact tested snapshot is also available in
[`companion-plugins.json`](companion-plugins.json) for tooling and release
audits. Version numbers document compatibility; they are not hard pins.

## Installation boundaries

- Install each companion from Obsidian Community plugins or its own official
  release channel. Do not copy another plugin's files into PaperBrain's folder.
- PaperBrain does not call companion plugin APIs, so disabling one cannot break
  the pipeline, console, notes, or artifacts.
- Each companion has its own license, data handling, network behavior, model
  costs, and update policy. Review those terms independently.
- When diagnosing layout issues, first close translation overlays and other
  floating controls, then test PaperBrain with the default Obsidian theme.
