const { ItemView, Notice, Plugin, PluginSettingTab, Setting, normalizePath, setIcon } = require("obsidian");
const childProcess = require("child_process");
const fs = require("fs");
const path = require("path");
const {
  boundedAppend,
  buildInvocation,
  buildSiblingInvocation,
  buildSpawnOptions,
  detectVaultPath,
  isCurrentProcess,
  mergeFailurePayload,
  normalizeRuntimeSettings,
  parsePayload,
  processOutcome,
  redactDiagnostics,
  safeExternalHttpUrl,
  toVaultRelativePath,
  validateRuntimeSettings,
  yesterday,
} = require("./runtime");

const VIEW_TYPE = "paperbrain-console-view";

const DEFAULT_SETTINGS = {
  settingsVersion: 2,
  executionMode: "auto",
  cliPath: "",
  pythonPath: "",
  backendPath: "",
  configPath: "",
  vaultPath: "",
  provider: "openrouter",
  generatePodcast: false,
  cancelTimeoutSeconds: 20,
  lastPreset: "daily",
};

const PANELS = [
  { id: "run", label: "Run" },
  { id: "timeline", label: "Timeline" },
  { id: "briefs", label: "Briefs" },
  { id: "artifacts", label: "Artifacts" },
];

const PRESETS = [
  { id: "daily", label: "Daily full", mode: "run", generatePodcast: null, clearArxiv: true },
  { id: "quick", label: "Quick no podcast", mode: "run", generatePodcast: false, clearArxiv: true },
  { id: "fetch", label: "Fetch only", mode: "fetch", generatePodcast: false, clearArxiv: true },
  { id: "screen", label: "Screen only", mode: "screen", generatePodcast: false, clearArxiv: true },
  { id: "digest", label: "Digest only", mode: "digest", generatePodcast: false, clearArxiv: true },
  { id: "single-deep", label: "Single deep", mode: "deep", generatePodcast: false, clearArxiv: false },
  { id: "index", label: "Rebuild index", mode: "index", generatePodcast: false, clearArxiv: false },
];

const STAGES = [
  "fetch",
  "coarse",
  "screen",
  "deep",
  "digest",
  "index",
  "podcast",
];

const STAGE_DETAILS = {
  fetch: {
    label: "Fetch",
    detail: "Collect candidates",
    queue: "Waiting for fetched candidates to be written into state.json.",
  },
  coarse: {
    label: "Coarse",
    detail: "Fast triage",
    queue: "Fetched papers are visible; coarse scores and re-screen flags fill in as papers update.",
  },
  screen: {
    label: "Screen",
    detail: "Rigorous review",
    queue: "The queue shows final score, screening stage, quality bars, digest and deep-analysis decisions.",
  },
  deep: {
    label: "Deep",
    detail: "PDF and note work",
    queue: "PDF and Note columns update as local PDFs and detailed notes become available.",
  },
  digest: {
    label: "Digest",
    detail: "Daily digest",
    queue: "Digest badges identify papers selected for the daily digest.",
  },
  index: {
    label: "Index",
    detail: "Research index",
    queue: "Queue data stays visible while index and review files are refreshed.",
  },
  podcast: {
    label: "Podcast",
    detail: "Audio artifact",
    queue: "Podcast status appears in artifacts when audio generation is enabled.",
  },
};

const STAGE_TO_INDEX = {
  initialized: -1,
  fetch: 0,
  fetched: 0,
  coarse: 1,
  coarse_screened: 1,
  screen: 2,
  screened: 2,
  deep: 3,
  deep_analyzed: 3,
  digest: 4,
  digest_written: 4,
  index: 5,
  podcast: 6,
  completed: 6,
  failed: 6,
  cancelled: 6,
};

const OUTPUT_STAGE_HINTS = [
  { pattern: /searching arxiv|fetching from|fetched|target date/i, stage: "fetch" },
  { pattern: /coarse screening|stage-1|coarse-screen/i, stage: "coarse" },
  { pattern: /rigorous|stage-2|screening complete|screen_paper/i, stage: "screen" },
  { pattern: /deep analysis|analyzing:|extracting architecture|performing deep/i, stage: "deep" },
  { pattern: /daily digest|paperdigest|digest written/i, stage: "digest" },
  { pattern: /research index|knowledge gardening|rebuild index|index written/i, stage: "index" },
  { pattern: /podcast|audio/i, stage: "podcast" },
];

module.exports = class PaperBrainPlugin extends Plugin {
  async onload() {
    const stored = (await this.loadData()) || {};
    const detectedVaultPath = detectVaultPath(this.app);
    this.settings = normalizeRuntimeSettings(Object.assign({}, DEFAULT_SETTINGS, stored), {
      detectedVaultPath,
      existsSync: fs.existsSync,
    });
    this.views = new Set();
    const firstStart = !stored.settingsVersion;
    const migratedLegacyPath = Boolean(stored.repoPath && !stored.backendPath);
    if (firstStart || migratedLegacyPath) await this.saveSettings();
    this.addSettingTab(new PaperBrainSettingTab(this.app, this));
    this.registerView(VIEW_TYPE, (leaf) => {
      const view = new PaperBrainConsoleView(leaf, this);
      this.views.add(view);
      return view;
    });
    this.addRibbonIcon("brain-circuit", "PaperBrain Console", () => this.activateView());
    this.addCommand({
      id: "open-paperbrain-console",
      name: "Open console",
      callback: () => this.activateView(),
    });
    this.addCommand({
      id: "validate-paperbrain-configuration",
      name: "Validate configuration",
      callback: () => this.validateConfiguration(true),
    });
    const validation = this.validateConfiguration(false);
    if (firstStart) {
      if (validation.ok) {
        const mode = validation.invocation.mode === "cli" ? "CLI lookup from PATH" : "local Python backend";
        new Notice(`PaperBrain setup initialized with the current vault and ${mode}. Review plugin settings before the first run.`, 8000);
      } else {
        new Notice(`PaperBrain setup requires configuration: ${validation.errors[0]}`, 9000);
      }
    } else if (!validation.ok) {
      new Notice(`PaperBrain configuration needs attention: ${validation.errors[0]}`, 8000);
    }
  }

  async onunload() {
    for (const view of this.views || []) view.dispose("plugin unload");
    if (this.views) this.views.clear();
    this.app.workspace.detachLeavesOfType(VIEW_TYPE);
  }

  async activateView() {
    const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE);
    if (leaves.length) {
      this.app.workspace.revealLeaf(leaves[0]);
      return;
    }
    const leaf = this.app.workspace.getRightLeaf(false);
    await leaf.setViewState({ type: VIEW_TYPE, active: true });
    this.app.workspace.revealLeaf(leaf);
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }

  validateConfiguration(showNotice = false) {
    const validation = validateRuntimeSettings(this.settings, { existsSync: fs.existsSync });
    if (showNotice) {
      if (validation.ok) {
        const warning = validation.warnings[0] ? ` ${validation.warnings[0]}` : "";
        new Notice(`PaperBrain configuration is valid.${warning}`, 7000);
      } else {
        new Notice(`PaperBrain configuration is invalid: ${validation.errors.join(" ")}`, 9000);
      }
    }
    return validation;
  }
};

class PaperBrainConsoleView extends ItemView {
  constructor(leaf, plugin) {
    super(leaf);
    this.plugin = plugin;
    this.process = null;
    this.processToken = 0;
    this.stopTimer = null;
    this.activeInvocation = null;
    this.cancelProcess = null;
    this.stopping = false;
    this.disposed = false;
    this.stdout = "";
    this.stderr = "";
    this.lastPayload = null;
    this.state = null;
    this.showAllLogs = false;
    this.activePanel = "run";
    this.pollTimer = null;
    this.liveStage = "";
    this.liveMessage = "";
    this.lastOutputLine = "";
    this.panelScroll = {};
    this.renderedPanel = "";
    this.dateTouched = false;
    const defaultDate = yesterday();
    const preset = presetById(plugin.settings.lastPreset || "daily");
    this.form = {
      date: defaultDate,
      provider: plugin.settings.provider || "openrouter",
      mode: preset.mode,
      preset: preset.id,
      arxivUrl: "",
      briefMode: "week",
      briefDate: defaultDate,
      generatePodcast: !!plugin.settings.generatePodcast,
      forceRun: false,
    };
  }

  getViewType() {
    return VIEW_TYPE;
  }

  getDisplayText() {
    return "PaperBrain Console";
  }

  getIcon() {
    return "brain-circuit";
  }

  async onOpen() {
    await this.loadState();
    this.render();
  }

  async onClose() {
    this.dispose("view closed");
    this.plugin.views.delete(this);
  }

  dispose(reason) {
    if (this.disposed) return;
    this.disposed = true;
    this.clearStopTimer();
    this.stopPolling();
    const active = this.process;
    const cancel = this.cancelProcess;
    this.process = null;
    this.cancelProcess = null;
    this.processToken += 1;
    this.activeInvocation = null;
    if (active) {
      this.appendLog(`terminating active process: ${reason}`);
      if (active.stdout) active.stdout.removeAllListeners();
      if (active.stderr) active.stderr.removeAllListeners();
      active.removeAllListeners();
      active.on("error", () => {});
      try {
        active.kill();
      } catch (_) {
        // The process may have exited between the check and kill call.
      }
    }
    if (cancel) {
      cancel.removeAllListeners();
      cancel.on("error", () => {});
      try {
        cancel.kill();
      } catch (_) {
        // The cancellation helper normally exits before the main process.
      }
    }
  }

  async loadState() {
    if (this.disposed) return;
    const statePath = this.currentStatePath();
    if (!statePath || !fs.existsSync(statePath)) {
      this.state = null;
      return;
    }
    try {
      this.state = JSON.parse(fs.readFileSync(statePath, "utf8"));
    } catch (error) {
      this.state = null;
      this.appendLog(`state read failed: ${error.message}`);
    }
  }

  currentRunId() {
    return `${this.form.date}`;
  }

  vaultPath(...parts) {
    const root = textValue(this.plugin.settings.vaultPath);
    return root ? path.join(root, ...parts) : "";
  }

  currentRunDir() {
    return this.vaultPath("Run_Records", this.currentRunId());
  }

  currentStatePath() {
    const runDir = this.currentRunDir();
    return runDir ? path.join(runDir, "state.json") : "";
  }

  render() {
    if (this.disposed) return;
    this.capturePaneScroll();
    const root = this.containerEl.children[1];
    root.empty();
    root.addClass("paperbrain-console");
    this.renderTopbar(root);
    this.renderPanelTabs(root);
    const shell = root.createDiv({ cls: "paperbrain-shell" });
    const pane = shell.createDiv({ cls: "paperbrain-pane paperbrain-active-pane" });
    if (this.activePanel === "run") {
      this.renderControls(pane);
      this.renderRunHistory(pane);
    } else if (this.activePanel === "timeline") {
      this.renderMain(pane);
    } else if (this.activePanel === "briefs") {
      this.renderBriefs(pane);
    } else {
      this.renderDetails(pane);
    }
    this.restorePaneScroll(pane, this.activePanel);
    this.renderedPanel = this.activePanel;
  }

  capturePaneScroll() {
    const pane = this.containerEl.querySelector(".paperbrain-pane");
    const key = this.renderedPanel || this.activePanel;
    if (pane && key) {
      this.panelScroll[key] = pane.scrollTop;
    }
  }

  restorePaneScroll(pane, key) {
    const scrollTop = this.panelScroll[key] || 0;
    requestAnimationFrame(() => {
      pane.scrollTop = scrollTop;
    });
  }

  renderPanelTabs(root) {
    const tabs = root.createDiv({ cls: "paperbrain-tabs" });
    PANELS.forEach((panel) => {
      const button = tabs.createEl("button", { text: panel.label });
      if (this.activePanel === panel.id) button.addClass("is-active");
      button.addEventListener("click", async () => {
        this.activePanel = panel.id;
        await this.loadState();
        this.render();
      });
    });
  }

  renderTopbar(root) {
    const bar = root.createDiv({ cls: "paperbrain-topbar" });
    const title = bar.createDiv({ cls: "paperbrain-title" });
    title.createEl("strong", { text: "PaperBrain Console" });
    const runtime = this.plugin.validateConfiguration(false).invocation;
    title.createEl("span", {
      text: `${this.plugin.settings.vaultPath} / ${runtime.mode === "cli" ? "CLI" : "Python backend"}`,
    });
    const right = bar.createDiv({ cls: "paperbrain-run-id" });
    right.setText(this.state ? `${this.state.run_id} / ${this.state.stage}` : `${this.currentRunId()} / idle`);
  }

  renderControls(parent) {
    const section = parent.createDiv({ cls: "paperbrain-section" });
    section.createEl("h3", { text: "Run" });
    this.renderPresetSelect(section);
    this.field(section, "Date", "date", this.form.date, (value) => {
      this.form.date = value || yesterday();
      this.dateTouched = true;
      this.refreshAfterInput();
    }, { type: "date", cls: "paperbrain-date-input", fieldCls: "paperbrain-date-field" });
    this.select(section, "Provider", "provider", this.form.provider, ["openrouter", "doubao"], (value) => {
      this.form.provider = value;
      this.plugin.settings.provider = value;
      this.plugin.saveSettings();
      this.refreshAfterInput();
    });
    this.field(section, "arXiv URL", "arxivUrl", this.form.arxivUrl, (value) => {
      this.form.arxivUrl = value;
      this.refreshAfterInput();
    });

    const toggles = section.createDiv({ cls: "paperbrain-toggle-row" });
    const podcast = toggles.createDiv({ cls: "paperbrain-toggle-field" });
    podcast.createEl("span", { text: "Podcast" });
    const podcastButton = podcast.createEl("button", {
      cls: `paperbrain-icon-toggle ${this.form.generatePodcast ? "is-active" : ""}`,
      attr: {
        "aria-label": "Toggle podcast generation",
        "aria-pressed": String(this.form.generatePodcast),
        type: "button",
      },
    });
    setIcon(podcastButton, this.form.generatePodcast ? "check" : "circle");
    podcastButton.addEventListener("click", () => {
      this.form.generatePodcast = !this.form.generatePodcast;
      this.render();
    });
    const force = toggles.createDiv({ cls: "paperbrain-toggle-field" });
    force.createEl("span", { text: "Force" });
    const forceButton = force.createEl("button", {
      cls: `paperbrain-icon-toggle ${this.form.forceRun ? "is-active" : ""}`,
      attr: {
        "aria-label": "Toggle force refresh",
        "aria-pressed": String(this.form.forceRun),
        type: "button",
      },
    });
    setIcon(forceButton, this.form.forceRun ? "check" : "circle");
    forceButton.addEventListener("click", () => {
      this.form.forceRun = !this.form.forceRun;
      this.render();
    });

    const actions = section.createDiv({ cls: "paperbrain-actions" });
    const runBtn = actions.createEl("button", { text: this.stopping ? "Stopping" : this.process ? "Running" : "Run" });
    runBtn.addClass("paperbrain-primary");
    runBtn.disabled = !!this.process;
    runBtn.addEventListener("click", () => this.runSelected());
    const stopBtn = actions.createEl("button", { text: "Stop" });
    stopBtn.addClass("paperbrain-danger");
    stopBtn.disabled = !this.process || this.stopping;
    stopBtn.addEventListener("click", () => this.stopRun());

    const utility = parent.createDiv({ cls: "paperbrain-section" });
    utility.createEl("h3", { text: "Tools" });
    const utilityActions = utility.createDiv({ cls: "paperbrain-actions" });
    utilityActions.createEl("button", { text: "Doctor" }).addEventListener("click", () => this.runDoctor());
    utilityActions.createEl("button", { text: "Refresh" }).addEventListener("click", async () => {
      await this.loadState();
      this.render();
    });
    const openActions = utility.createDiv({ cls: "paperbrain-actions" });
    openActions.createEl("button", { text: "Digest" }).addEventListener("click", () => this.openArtifact("daily_digest"));
    openActions.createEl("button", { text: "Report" }).addEventListener("click", () => this.openArtifact("screening_report"));
    openActions.createEl("button", { text: "Index" }).addEventListener("click", () => this.runIndex());
  }

  renderPresetSelect(parent) {
    const field = parent.createDiv({ cls: "paperbrain-field" });
    field.createEl("label", { text: "Run mode" });
    const select = field.createEl("select");
    PRESETS.forEach((preset) => {
      const item = select.createEl("option", { text: preset.label, value: preset.id });
      item.selected = preset.id === this.form.preset;
    });
    select.addEventListener("change", () => this.applyPreset(select.value));
  }

  renderMain(parent) {
    const timeline = parent.createDiv({ cls: "paperbrain-section" });
    timeline.createEl("h3", { text: "Timeline" });
    this.renderTimeline(timeline);

    const status = parent.createDiv({ cls: "paperbrain-section" });
    status.createEl("h3", { text: "Live Status" });
    this.renderLiveStatus(status);

    const papers = parent.createDiv({ cls: "paperbrain-section" });
    papers.createEl("h3", { text: "Paper Queue" });
    this.renderPaperTable(papers);
  }

  renderDetails(parent) {
    const artifacts = parent.createDiv({ cls: "paperbrain-section" });
    artifacts.createEl("h3", { text: "Artifacts" });
    this.renderArtifacts(artifacts);

    const retry = parent.createDiv({ cls: "paperbrain-section" });
    retry.createEl("h3", { text: "Retry Panel" });
    this.renderRetryPanel(retry);

    const review = parent.createDiv({ cls: "paperbrain-section" });
    review.createEl("h3", { text: "Review Queue" });
    this.renderReviewQueue(review);

    const diagnostics = parent.createDiv({ cls: "paperbrain-section" });
    diagnostics.createEl("h3", { text: "Diagnostics" });
    if (this.lastPayload) {
      diagnostics.createEl("div", {
        cls: "paperbrain-muted",
        text: `${this.lastPayload.command || "command"} / exit ${this.lastPayload.exit_code ?? ""}`,
      });
    } else {
      diagnostics.createEl("div", { cls: "paperbrain-muted", text: "No command output yet." });
    }
    diagnostics.createEl("button", { cls: "paperbrain-copy-button", text: "Copy redacted diagnostics" })
      .addEventListener("click", () => this.copyDiagnostics());

    const logs = parent.createDiv({ cls: "paperbrain-section" });
    const head = logs.createDiv({ cls: "paperbrain-inline-actions" });
    head.createEl("h3", { text: "Logs" });
    const toggle = head.createEl("button", { text: this.showAllLogs ? "Warnings" : "All" });
    toggle.addEventListener("click", () => {
      this.showAllLogs = !this.showAllLogs;
      this.render();
    });
    this.renderLogs(logs);
  }

  renderLiveStatus(parent) {
    const snapshot = this.activitySnapshot();
    const board = parent.createDiv({ cls: `paperbrain-status-board is-${snapshot.tone}` });
    const head = board.createDiv({ cls: "paperbrain-status-head" });
    const marker = head.createDiv({ cls: "paperbrain-status-marker" });
    marker.createEl("span");
    const title = head.createDiv();
    title.createEl("strong", { text: snapshot.title });
    title.createEl("span", { text: snapshot.subtitle });

    const metrics = board.createDiv({ cls: "paperbrain-status-metrics" });
    snapshot.metrics.forEach((metric) => {
      const item = metrics.createDiv({ cls: "paperbrain-status-metric" });
      item.createEl("strong", { text: metric.value });
      item.createEl("span", { text: metric.label });
    });

    const latest = board.createDiv({ cls: "paperbrain-status-latest" });
    latest.createEl("span", { text: snapshot.latestLabel });
    latest.createEl("strong", { text: snapshot.latestText });
  }

  activitySnapshot() {
    const rawStage = this.liveStage || (this.state ? this.state.stage : "idle");
    const stage = normalizeStageForUi(rawStage);
    const meta = STAGE_DETAILS[stage] || { label: titleCase(rawStage || "Idle"), detail: "Ready" };
    const papers = (this.state && this.state.papers) || [];
    const stats = this.queueStats(papers);
    const errors = (this.state && this.state.errors) || [];
    const warningCount = this.warningCount();
    const latestLog = this.latestStateLog();
    const latestText = this.lastOutputLine || logText(latestLog) || "No activity recorded yet.";
    const isDone = this.state && this.state.stage === "completed" && !this.process;
    const isError = errors.length || rawStage === "failed" || rawStage === "cancelled";
    const tone = isError ? "error" : this.process ? "running" : isDone ? "done" : "idle";
    const title = this.process
      ? `${meta.label} is running`
      : isDone
        ? "Run completed"
        : isError
          ? "Run needs attention"
          : `${meta.label || "Idle"} status`;
    const subtitle = STAGE_DETAILS[stage]?.queue || meta.detail || "Waiting for a run.";
    return {
      tone,
      title,
      subtitle,
      latestLabel: latestLog ? `${eventLabel(latestLog)} / ${latestLog.ts || latestLog.created_at || ""}` : "Output",
      latestText,
      metrics: [
        { label: "papers", value: String(stats.total) },
        { label: "digest", value: String(stats.digest) },
        { label: "deep", value: String(stats.deep) },
        { label: "pdfs", value: String(stats.pdfs) },
        { label: "notes", value: String(stats.notes) },
        { label: "warn", value: String(warningCount) },
        { label: "err", value: String(errors.length) },
      ],
    };
  }

  latestStateLog() {
    const logs = ((this.state && this.state.logs) || []).filter(Boolean);
    return logs.length ? logs[logs.length - 1] : null;
  }

  warningCount() {
    const stateLogs = ((this.state && this.state.logs) || []).map(logText);
    const stderrLines = this.stderr.split(/\r?\n/);
    return [...stateLogs, ...stderrLines].filter((line) => /warn|warning|cooldown|rate limit/i.test(line)).length;
  }

  queueStats(papers) {
    const stats = {
      total: papers.length,
      digest: 0,
      deep: 0,
      pdfs: 0,
      notes: 0,
      localPdfs: 0,
      missingNotes: 0,
      high: 0,
    };
    papers.forEach((paper) => {
      const score = queueScoreValue(paper);
      if (score >= 7) stats.high += 1;
      if (paper.in_daily_digest) stats.digest += 1;
      if (paper.selected_for_deep_analysis) stats.deep += 1;
      if (textValue(paper.pdf_url)) stats.pdfs += 1;
      if (this.existingLocalPath(paper.pdf_path || paper.local_pdf_path)) stats.localPdfs += 1;
      const notePath = this.existingLocalPath(paper.note_path);
      if (notePath) stats.notes += 1;
      if (paper.note_path && !notePath) stats.missingNotes += 1;
    });
    return stats;
  }

  renderTimeline(parent) {
    const current = normalizeStageForUi(this.liveStage || (this.state ? this.state.stage : "idle"));
    const currentIndex = STAGE_TO_INDEX[current] ?? -1;
    const grid = parent.createDiv({ cls: "paperbrain-timeline" });
    STAGES.forEach((stage, index) => {
      const step = grid.createDiv({ cls: "paperbrain-step" });
      const meta = STAGE_DETAILS[stage];
      const status = this.stageStatus(current, index, currentIndex);
      if (status.className) step.addClass(status.className);
      step.createEl("strong", { text: meta.label });
      step.createEl("span", { cls: "paperbrain-step-detail", text: meta.detail });
      const state = step.createEl("span", { cls: "paperbrain-step-state" });
      state.createEl("i", { cls: "paperbrain-step-dot" });
      state.createEl("span", { text: status.text });
    });
  }

  stageStatus(current, index, currentIndex) {
    if (current === "failed" || current === "cancelled") {
      return index <= currentIndex ? { className: "is-error", text: "attention", kind: "error" } : { className: "", text: "waiting", kind: "waiting" };
    }
    if (current === "completed" || index < currentIndex) {
      return { className: "is-done", text: "done", kind: "done" };
    }
    if (index === currentIndex) {
      return { className: "is-active", text: this.process ? "running" : "active", kind: "active" };
    }
    return { className: "", text: "waiting", kind: "waiting" };
  }

  renderPaperTable(parent) {
    const papers = [...((this.state && this.state.papers) || [])].sort((a, b) => queueScoreValue(b) - queueScoreValue(a));
    if (!papers.length) {
      this.renderQueueEmpty(parent);
      return;
    }
    this.renderQueueSummary(parent, papers);
    const table = parent.createEl("table", { cls: "paperbrain-table" });
    const head = table.createEl("thead").createEl("tr");
    ["Title", "Score", "Stage", "PDF", "Note", "Digest", "Deep", "Quality", "Action"].forEach((label) => head.createEl("th", { text: label }));
    const body = table.createEl("tbody");
    papers.forEach((paper) => {
      const pdfPath = this.existingLocalPath(paper.pdf_path || paper.local_pdf_path);
      const notePath = this.existingLocalPath(paper.note_path);
      const pdfUrl = textValue(paper.pdf_url);
      const pdfStatus = pdfPath ? "local" : pdfUrl ? "url" : "no";
      const noteStatus = notePath ? "yes" : paper.note_path ? "missing" : "no";
      const row = body.createEl("tr");
      row.createEl("td", { cls: "paperbrain-title-cell", text: paper.title || paper.short_title || "Untitled" });
      row.createEl("td", { text: formatQueueScore(paper) });
      row.createEl("td", { text: paper.screening_stage || paperStageHint(paper) });
      row.createEl("td").appendChild(this.badge(pdfStatus, !!pdfPath, pdfPath || pdfUrl));
      row.createEl("td").appendChild(this.badge(noteStatus, !!notePath, notePath || paper.note_path || ""));
      row.createEl("td").appendChild(this.badge(paper.in_daily_digest ? "yes" : "no", paper.in_daily_digest));
      row.createEl("td").appendChild(this.badge(paper.selected_for_deep_analysis ? "yes" : "no", paper.selected_for_deep_analysis));
      this.renderQualityBars(row.createEl("td"), paper);
      const actions = row.createEl("td", { cls: "paperbrain-inline-actions" });
      if (notePath) {
        actions.createEl("button", { text: "Note" }).addEventListener("click", () => this.openPath(notePath));
      }
      if (pdfPath) {
        actions.createEl("button", { text: "PDF" }).addEventListener("click", () => this.openPath(pdfPath));
      }
      actions.createEl("button", { text: "Retry" }).addEventListener("click", () => this.retryPaperMode(paper, "run"));
    });
  }

  renderQueueEmpty(parent) {
    const stage = normalizeStageForUi(this.liveStage || (this.state ? this.state.stage : "idle"));
    const meta = STAGE_DETAILS[stage];
    const empty = parent.createDiv({ cls: "paperbrain-empty paperbrain-queue-empty" });
    empty.createEl("strong", { text: stage === "idle" ? "No run state loaded." : "No saved papers yet." });
    empty.createEl("span", {
      text: meta
        ? meta.queue
        : "Choose a run mode and start a command; the queue appears after PaperBrain writes papers to state.json.",
    });
  }

  renderQueueSummary(parent, papers) {
    const stats = this.queueStats(papers);
    const summary = parent.createDiv({ cls: "paperbrain-queue-summary" });
    [
      ["Total", stats.total],
      ["High", stats.high],
      ["Digest", stats.digest],
      ["Deep", stats.deep],
      ["Local PDFs", stats.localPdfs],
      ["Notes", stats.notes],
      ["Missing notes", stats.missingNotes],
    ].forEach(([label, value]) => {
      const item = summary.createDiv({ cls: "paperbrain-queue-stat" });
      item.createEl("strong", { text: String(value) });
      item.createEl("span", { text: label });
    });
  }

  renderQualityBars(parent, paper) {
    const fields = [
      ["Rel", "relevance"],
      ["Nov", "novelty"],
      ["Rig", "rigor"],
      ["Evd", "evidence"],
      ["Con", "confidence"],
    ];
    const wrap = parent.createDiv({ cls: "paperbrain-quality-bars" });
    fields.forEach(([label, key]) => {
      const value = Math.max(0, Math.min(10, qualityMetricValue(paper, key)));
      const bar = wrap.createDiv({ cls: "paperbrain-quality-bar" });
      bar.title = `${label}: ${value.toFixed(1)}`;
      bar.createEl("span", { text: label });
      const track = bar.createDiv({ cls: "paperbrain-quality-track" });
      const fill = track.createDiv({ cls: "paperbrain-quality-fill" });
      fill.style.width = `${value * 10}%`;
    });
  }

  renderArtifacts(parent) {
    const artifacts = (this.state && this.state.artifacts) || {};
    const entries = Object.entries(artifacts).filter(([, value]) => !!value);
    if (!entries.length) {
      parent.createDiv({ cls: "paperbrain-empty", text: "No artifacts yet." });
      return;
    }
    entries.forEach(([key, value]) => {
      const item = parent.createDiv({ cls: "paperbrain-artifact" });
      item.createEl("span", { text: key });
      const button = item.createEl("button", { text: "Open" });
      button.addEventListener("click", () => this.openPath(value));
    });
  }

  renderLogs(parent) {
    const lines = [];
    if (this.stderr.trim()) lines.push(this.stderr.trim());
    const stateLogs = ((this.state && this.state.logs) || []).map((log) => {
      return `${log.ts || log.created_at || ""} ${log.event_type || "log"} ${log.status || ""} ${log.stage || ""} ${log.message || ""}`.trim();
    });
    const filtered = this.showAllLogs
      ? stateLogs
      : stateLogs.filter((line) => /warn|error|fail|cancel/i.test(line));
    lines.push(...filtered.slice(-80));
    const log = parent.createDiv({ cls: "paperbrain-log" });
    log.setText(lines.filter(Boolean).join("\n") || "No warnings or errors.");
    requestAnimationFrame(() => {
      log.scrollTop = log.scrollHeight;
    });
  }

  renderRetryPanel(parent) {
    const papers = [...((this.state && this.state.papers) || [])]
      .sort((a, b) => number(b.score) - number(a.score))
      .slice(0, 8);
    if (!papers.length) {
      parent.createDiv({ cls: "paperbrain-empty", text: "No papers available for retry." });
      return;
    }
    const globalActions = parent.createDiv({ cls: "paperbrain-actions paperbrain-actions-wide" });
    globalActions.createEl("button", { text: "Rebuild Index" }).addEventListener("click", () => this.runIndex());
    globalActions.createEl("button", { text: "Refresh State" }).addEventListener("click", async () => {
      await this.loadState();
      this.render();
    });

    papers.forEach((paper) => {
      const item = parent.createDiv({ cls: "paperbrain-retry-item" });
      item.createEl("span", { text: paper.short_title || paper.title || "Untitled" });
      const actions = item.createDiv({ cls: "paperbrain-inline-actions" });
      actions.createEl("button", { text: "PDF" }).addEventListener("click", () => this.retryPaperMode(paper, "deep"));
      actions.createEl("button", { text: "Screen" }).addEventListener("click", () => this.retryPaperMode(paper, "screen"));
      actions.createEl("button", { text: "Deep" }).addEventListener("click", () => this.retryPaperMode(paper, "deep"));
    });
  }

  renderReviewQueue(parent) {
    const items = this.reviewPapers();
    if (!items.length) {
      parent.createDiv({ cls: "paperbrain-empty", text: "No papers need manual review." });
      return;
    }
    items.slice(0, 12).forEach(({ paper, reasons }) => {
      const item = parent.createDiv({ cls: "paperbrain-review-item" });
      item.createEl("strong", { text: paper.short_title || paper.title || "Untitled" });
      item.createEl("span", { text: reasons.join(" / ") });
      const actions = item.createDiv({ cls: "paperbrain-inline-actions" });
      actions.createEl("button", { text: "Retry" }).addEventListener("click", () => this.retryPaperMode(paper, "run"));
      if (paper.note_path) {
        actions.createEl("button", { text: "Note" }).addEventListener("click", () => this.openPath(paper.note_path));
      }
    });
  }

  renderBriefs(parent) {
    const briefDate = this.form.briefDate || this.form.date || yesterday();
    this.form.briefDate = briefDate;
    const period = briefPeriod(this.form.briefMode || "week", briefDate);
    const existing = this.findBrief(period.label);

    const controls = parent.createDiv({ cls: "paperbrain-section" });
    controls.createEl("h3", { text: "Briefs" });
    this.select(controls, "Period", "briefMode", this.form.briefMode || "week", ["week", "month"], (value) => {
      this.form.briefMode = value;
      this.render();
    });
    this.field(controls, "Date", "briefDate", briefDate, (value) => {
      this.form.briefDate = value || yesterday();
      this.render();
    }, { type: "date", cls: "paperbrain-date-input", fieldCls: "paperbrain-date-field" });
    const actions = controls.createDiv({ cls: "paperbrain-actions" });
    actions.createEl("button", { text: "Generate" }).addEventListener("click", () => this.runBrief(period));
    const openButton = actions.createEl("button", { text: "Open" });
    openButton.disabled = !existing;
    openButton.addEventListener("click", () => existing && this.openPath(existing));

    const summary = this.readDailyDigestSummary(period.start, period.end);
    const metricsSection = parent.createDiv({ cls: "paperbrain-section" });
    metricsSection.createEl("h3", { text: period.label, cls: "paperbrain-date-text" });
    const metrics = metricsSection.createDiv({ cls: "paperbrain-status-metrics paperbrain-brief-metrics" });
    [
      { label: "days", value: `${summary.daysFound}/${period.days}` },
      { label: "papers", value: String(summary.entries.length) },
      { label: "high", value: String(summary.highCount) },
      { label: "brief", value: existing ? "ready" : "none" },
    ].forEach((metric) => {
      const item = metrics.createDiv({ cls: "paperbrain-status-metric" });
      item.createEl("strong", { text: metric.value });
      item.createEl("span", { text: metric.label });
    });

    const topSection = parent.createDiv({ cls: "paperbrain-section" });
    topSection.createEl("h3", { text: "Top Papers" });
    const topEntries = summary.entries.slice(0, 8);
    if (!topEntries.length) {
      topSection.createDiv({ cls: "paperbrain-empty", text: "No daily digest entries found." });
    } else {
      topEntries.forEach((entry) => {
        const item = topSection.createDiv({ cls: "paperbrain-brief-item" });
        const meta = item.createDiv();
        meta.createEl("strong", { text: entry.title || "Untitled" });
        meta.createEl("span", { text: `${entry.date} / ${formatScore(entry.score)}`, cls: "paperbrain-date-text" });
        const itemActions = item.createDiv({ cls: "paperbrain-inline-actions" });
        if (entry.digestPath) {
          itemActions.createEl("button", { text: "Digest" }).addEventListener("click", () => this.openPath(entry.digestPath));
        }
        const externalUrl = safeExternalHttpUrl(entry.url);
        if (externalUrl) {
          itemActions.createEl("button", { text: "Web" }).addEventListener("click", () => {
            window.open(externalUrl, "_blank", "noopener,noreferrer");
          });
        }
      });
    }

    this.renderBriefHistory(parent);
  }

  renderBriefHistory(parent) {
    const section = parent.createDiv({ cls: "paperbrain-section" });
    section.createEl("h3", { text: "Research Briefs" });
    const history = this.readBriefHistory().slice(0, 10);
    if (!history.length) {
      section.createDiv({ cls: "paperbrain-empty", text: "No research briefs found." });
      return;
    }
    history.forEach((item) => {
      const row = section.createDiv({ cls: "paperbrain-brief-item" });
      const meta = row.createDiv();
      meta.createEl("strong", { text: item.label, cls: "paperbrain-date-text" });
      meta.createEl("span", { text: item.modified, cls: "paperbrain-date-text" });
      const actions = row.createDiv({ cls: "paperbrain-inline-actions" });
      actions.createEl("button", { text: "Open" }).addEventListener("click", () => this.openPath(item.path));
    });
  }

  runBrief(period) {
    const args = ["brief", "--mode", period.type, "--date", this.form.briefDate || yesterday()];
    this.spawnPaperBrain(args);
  }

  findBrief(label) {
    const root = this.vaultPath("Research_Briefs");
    if (!root) return "";
    const direct = path.join(root, `${label}-ResearchBrief.md`);
    if (fs.existsSync(direct)) return direct;
    if (!fs.existsSync(root)) return "";
    try {
      const match = fs.readdirSync(root).find((name) => name.endsWith("-ResearchBrief.md") && name.includes(label));
      return match ? path.join(root, match) : "";
    } catch (error) {
      this.appendLog(`brief lookup failed: ${error.message}`);
      return "";
    }
  }

  readBriefHistory() {
    const root = this.vaultPath("Research_Briefs");
    if (!fs.existsSync(root)) return [];
    try {
      return fs.readdirSync(root)
        .filter((name) => name.endsWith("-ResearchBrief.md"))
        .map((name) => {
          const fullPath = path.join(root, name);
          const stat = fs.statSync(fullPath);
          return {
            path: fullPath,
            label: name.replace(/-ResearchBrief\.md$/, ""),
            modified: new Date(stat.mtimeMs).toISOString().slice(0, 16).replace("T", " "),
            sort: stat.mtimeMs,
          };
        })
        .sort((a, b) => b.sort - a.sort);
    } catch (error) {
      this.appendLog(`brief history read failed: ${error.message}`);
      return [];
    }
  }

  readDailyDigestSummary(startDate, endDate) {
    const dailyRoot = this.vaultPath("Daily_Papers");
    if (!dailyRoot) return { daysFound: 0, highCount: 0, entries: [] };
    const entries = [];
    let daysFound = 0;
    dateRange(startDate, endDate).forEach((dateKey) => {
      const digestPath = path.join(dailyRoot, `${dateKey}-PaperDigest.md`);
      if (!fs.existsSync(digestPath)) return;
      daysFound += 1;
      entries.push(...this.readDailyDigestEntries(digestPath, dateKey));
    });
    entries.sort((a, b) => number(b.score) - number(a.score));
    return {
      daysFound,
      highCount: entries.filter((entry) => number(entry.score) >= 8).length,
      entries,
    };
  }

  readDailyDigestEntries(digestPath, dateKey) {
    try {
      const raw = fs.readFileSync(digestPath, "utf8");
      return raw.split(/\n(?=###\s+)/)
        .map((chunk) => {
          const match = chunk.match(/^###\s+(.+?)\s+\(Score:\s*([0-9]+(?:\.[0-9]+)?)\/10\)/m);
          if (!match) return null;
          const link = digestField(chunk, "Link");
          return {
            title: cleanDigestTitle(match[1]),
            score: number(match[2]),
            date: dateKey,
            url: firstUrl(link),
            digestPath,
          };
        })
        .filter(Boolean);
    } catch (error) {
      this.appendLog(`daily digest read failed: ${error.message}`);
      return [];
    }
  }

  field(parent, label, key, value, onChange, options = {}) {
    const field = parent.createDiv({ cls: "paperbrain-field" });
    if (options.fieldCls) field.addClass(options.fieldCls);
    field.createEl("label", { text: label });
    const input = field.createEl("input");
    input.type = options.type || "text";
    if (options.cls) input.addClass(options.cls);
    input.value = value || "";
    input.addEventListener("change", () => onChange(input.value));
  }

  select(parent, label, key, value, options, onChange) {
    const field = parent.createDiv({ cls: "paperbrain-field" });
    field.createEl("label", { text: label });
    const select = field.createEl("select");
    options.forEach((option) => {
      const item = select.createEl("option", { text: option, value: option });
      item.selected = option === value;
    });
    select.addEventListener("change", () => onChange(select.value));
  }

  badge(text, good, title = "") {
    const badge = document.createElement("span");
    badge.className = `paperbrain-badge ${good ? "is-good" : "is-warn"}`;
    badge.textContent = text;
    if (title) badge.title = title;
    return badge;
  }

  existingLocalPath(value) {
    const raw = textValue(value);
    if (!raw) return "";
    const vaultRoot = this.plugin.settings.vaultPath;
    if (!path.isAbsolute(raw) && !vaultRoot) return "";
    const candidate = path.isAbsolute(raw) ? raw : path.join(vaultRoot, raw);
    try {
      return fs.existsSync(candidate) ? candidate : "";
    } catch (error) {
      return "";
    }
  }

  applyPreset(id) {
    const preset = PRESETS.find((item) => item.id === id);
    if (!preset) return;
    this.form.preset = id;
    this.form.mode = preset.mode;
    if (preset.generatePodcast !== null) {
      this.form.generatePodcast = !!preset.generatePodcast;
    }
    if (preset.clearArxiv) {
      this.form.arxivUrl = "";
    }
    this.plugin.settings.lastPreset = id;
    this.plugin.saveSettings();
    this.refreshAfterInput();
  }

  renderRunHistory(parent) {
    const section = parent.createDiv({ cls: "paperbrain-section" });
    section.createEl("h3", { text: "Run History" });
    const history = this.readRunHistory().slice(0, 12);
    if (!history.length) {
      section.createDiv({ cls: "paperbrain-empty", text: "No historical runs found." });
      return;
    }
    history.forEach((item) => {
      const row = section.createDiv({ cls: "paperbrain-history-item" });
      const meta = row.createDiv();
      meta.createEl("strong", { text: item.run_id || "unknown-run", cls: "paperbrain-date-text" });
      meta.createEl("span", { text: `${item.stage || "unknown"} / ${item.updated_at || item.date || ""}`, cls: "paperbrain-date-text" });
      const actions = row.createDiv({ cls: "paperbrain-inline-actions" });
      actions.createEl("button", { text: "Load" }).addEventListener("click", async () => {
        this.form.date = item.date || this.form.date;
        this.form.provider = item.provider || this.form.provider;
        const modes = item.run_modes || [];
        const singleOnly = modes.includes("single") && !modes.includes("daily");
        this.form.arxivUrl = singleOnly || (item.single_paper && !modes.length) ? this.firstPaperUrl(item) : "";
        this.activePanel = "timeline";
        await this.loadState();
        this.render();
      });
      if (item.artifacts && item.artifacts.daily_digest) {
        actions.createEl("button", { text: "Digest" }).addEventListener("click", () => this.openPath(item.artifacts.daily_digest));
      }
    });
  }

  readRunHistory() {
    const root = this.vaultPath("Run_Records");
    const items = [];
    if (!fs.existsSync(root)) return items;
    try {
      fs.readdirSync(root, { withFileTypes: true }).forEach((entry) => {
        if (entry.isDirectory()) {
          const statePath = path.join(root, entry.name, "state.json");
          if (fs.existsSync(statePath)) {
            const item = this.readStateSummary(statePath);
            if (item) items.push(item);
          }
        } else if (entry.isFile() && entry.name.endsWith("-run-state.json")) {
          const item = this.readStateSummary(path.join(root, entry.name));
          if (item) items.push(item);
        }
      });
    } catch (error) {
      this.appendLog(`run history read failed: ${error.message}`);
    }
    return items.sort((a, b) => textValue(b.updated_at).localeCompare(textValue(a.updated_at)));
  }

  readStateSummary(statePath) {
    try {
      const data = JSON.parse(fs.readFileSync(statePath, "utf8"));
      return {
        run_id: data.run_id || path.basename(path.dirname(statePath)),
        date: data.date || "",
        provider: data.provider || this.form.provider,
        providers: data.providers || [],
        run_modes: data.run_modes || [],
        single_paper: !!data.single_paper,
        stage: data.stage || "",
        updated_at: data.updated_at || data.created_at || "",
        artifacts: data.artifacts || {},
        papers: data.papers || [],
      };
    } catch (error) {
      return null;
    }
  }

  firstPaperUrl(item) {
    const paper = (item.papers || [])[0] || {};
    const arxivId = extractArxivId(paper.arxiv_id || paper.paper_id || paper.pdf_url || paper.url);
    return textValue(paper.url) || (arxivId ? `https://arxiv.org/abs/${arxivId}` : "") || textValue(paper.pdf_url);
  }

  reviewPapers() {
    return [...((this.state && this.state.papers) || [])]
      .map((paper) => {
        const reasons = [];
        const flags = Array.isArray(paper.red_flags) ? paper.red_flags : [];
        if (number(paper.confidence) > 0 && number(paper.confidence) < 5) reasons.push("low confidence");
        if (flags.length > 2) reasons.push("many red flags");
        if (number(paper.score) >= 7 && !this.existingLocalPath(paper.pdf_path || paper.local_pdf_path)) reasons.push("high score missing PDF");
        if (paper.selected_for_deep_analysis && !this.existingLocalPath(paper.note_path)) reasons.push("deep selected missing note");
        if (paper.should_rescreen && paper.screening_stage === "coarse_only") reasons.push("needs re-screen");
        return { paper, reasons };
      })
      .filter((item) => item.reasons.length)
      .sort((a, b) => number(b.paper.score) - number(a.paper.score));
  }

  refreshAfterInput() {
    this.loadState().then(() => this.render());
  }

  runSelected() {
    const mode = this.form.mode;
    const args = [mode];
    if (mode === "index") {
      this.form.forceRun = false;
      this.spawnPaperBrain(args);
      return;
    }
    const arxivUrl = this.form.arxivUrl.trim();
    const omitAutoArxivDate = mode !== "digest" && arxivUrl && !this.dateTouched;
    if (!omitAutoArxivDate) args.push("--date", this.form.date);
    args.push("--provider", this.form.provider);
    if (mode !== "digest") {
      if (!this.form.generatePodcast) args.push("--no-podcast");
      if (arxivUrl) args.push("--arxiv-url", arxivUrl);
    }
    if (this.form.forceRun && ["run", "fetch", "screen", "deep"].includes(mode)) {
      args.push("--force");
    }
    this.form.forceRun = false;
    this.spawnPaperBrain(args);
  }

  runDoctor() {
    this.spawnPaperBrain(["doctor"]);
  }

  runIndex() {
    this.form.mode = "index";
    this.spawnPaperBrain(["index"]);
  }

  stopRun() {
    if (!this.process || this.stopping) return;
    const activeProcess = this.process;
    const activeToken = this.processToken;
    const activeInvocation = this.activeInvocation;
    this.stopping = true;
    this.render();
    if (activeInvocation) {
      const cancelInvocation = buildSiblingInvocation(activeInvocation, ["cancel", "--reason", "plugin_stop"]);
      try {
        const cancel = childProcess.spawn(cancelInvocation.executable, cancelInvocation.args, {
          ...buildSpawnOptions(this.plugin.settings, cancelInvocation),
        });
        this.cancelProcess = cancel;
        let cancelFailed = false;
        cancel.once("error", (error) => {
          if (this.cancelProcess === cancel) this.cancelProcess = null;
          cancelFailed = true;
          this.appendLog(`cancel request failed: ${error.message}`);
          new Notice(`PaperBrain cancellation request failed: ${error.message}`, 8000);
          this.render();
        });
        cancel.once("close", (code) => {
          if (this.cancelProcess === cancel) this.cancelProcess = null;
          if (cancelFailed) return;
          if (code === 0) {
            new Notice("PaperBrain cancellation requested.");
          } else {
            this.appendLog(`cancel command exited with code ${code}`);
            new Notice(`PaperBrain cancellation command exited with code ${code}.`, 8000);
            this.render();
          }
        });
      } catch (error) {
        this.appendLog(`cancel request failed: ${error.message}`);
        new Notice(`PaperBrain cancellation request failed: ${error.message}`, 8000);
      }
    }
    this.clearStopTimer();
    const timeout = Math.max(3, Number(this.plugin.settings.cancelTimeoutSeconds || 20)) * 1000;
    this.stopTimer = window.setTimeout(() => {
      this.stopTimer = null;
      if (isCurrentProcess(this.process, this.processToken, activeProcess, activeToken)) {
        this.appendLog("hard stop after cancel timeout");
        try {
          activeProcess.kill();
          new Notice("PaperBrain process was terminated after the cancellation timeout.");
        } catch (error) {
          this.appendLog(`hard stop failed: ${error.message}`);
          new Notice(`PaperBrain hard stop failed: ${error.message}`, 8000);
        }
        this.render();
      }
    }, timeout);
  }

  clearStopTimer() {
    if (this.stopTimer) {
      window.clearTimeout(this.stopTimer);
      this.stopTimer = null;
    }
  }

  spawnPaperBrain(commandArgs) {
    if (this.disposed) return;
    if (this.process) {
      new Notice("PaperBrain is already running.");
      return;
    }
    const validation = this.plugin.validateConfiguration(false);
    if (!validation.ok) {
      new Notice(`PaperBrain configuration is invalid: ${validation.errors.join(" ")}`, 9000);
      return;
    }
    const invocation = buildInvocation(this.plugin.settings, commandArgs, { existsSync: fs.existsSync });
    this.stdout = "";
    this.stderr = "";
    this.lastPayload = null;
    this.liveStage = "";
    this.liveMessage = "";
    this.lastOutputLine = "";
    this.stopping = false;
    this.clearStopTimer();
    const token = this.processToken + 1;
    this.processToken = token;
    let process;
    try {
      process = childProcess.spawn(invocation.executable, invocation.args, {
        ...buildSpawnOptions(this.plugin.settings, invocation),
      });
    } catch (error) {
      const outcome = processOutcome({ error, payload: null, stderr: "" });
      this.lastPayload = mergeFailurePayload(null, commandArgs[0], outcome, null, null);
      this.appendLog(`spawn failed: ${error.message}`);
      new Notice(outcome.message, 9000);
      this.render();
      return;
    }
    this.process = process;
    this.activeInvocation = invocation;
    this.startPolling();
    this.render();
    process.stdout.on("data", (data) => {
      const text = data.toString();
      this.stdout = boundedAppend(this.stdout, text);
      this.updateLiveStageFromOutput(text);
      this.render();
    });
    process.stderr.on("data", (data) => {
      const text = data.toString();
      this.stderr = boundedAppend(this.stderr, text);
      this.updateLiveStageFromOutput(text);
      this.render();
    });
    let settled = false;
    const finalize = async ({ code = null, signal = null, error = null }) => {
      if (settled) return;
      settled = true;
      const ownsSlot = isCurrentProcess(this.process, this.processToken, process, token);
      const payload = parsePayload(this.stdout);
      const outcome = processOutcome({
        code,
        signal,
        error,
        payload,
        stderr: this.stderr,
        expectedCommand: commandArgs[0],
      });
      if (!ownsSlot) return;
      this.clearStopTimer();
      this.lastPayload = outcome.ok
        ? payload
        : mergeFailurePayload(payload, commandArgs[0], outcome, code, signal);
      if (outcome.ok) {
        new Notice(outcome.message);
      } else {
        this.appendLog(`${outcome.reason}: ${outcome.message}`);
        new Notice(outcome.message, 9000);
      }
      if (payload && payload.date) {
        this.form.date = payload.date;
        this.dateTouched = false;
      }
      this.process = null;
      this.activeInvocation = null;
      this.stopping = false;
      this.stopPolling();
      this.liveStage = "";
      if (!this.disposed) {
        await this.loadState();
        this.render();
      }
    };
    process.once("error", (error) => finalize({ error }));
    process.once("close", (code, signal) => finalize({ code, signal }));
  }

  startPolling() {
    this.stopPolling();
    if (this.disposed) return;
    this.pollTimer = window.setInterval(async () => {
      if (this.disposed || !this.process) {
        this.stopPolling();
        return;
      }
      await this.loadState();
      if (this.state && this.state.stage && this.state.stage !== "initialized") {
        this.advanceLiveStage(this.state.stage);
      }
      this.render();
    }, 2000);
  }

  stopPolling() {
    if (this.pollTimer) {
      window.clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }

  updateLiveStageFromOutput(text) {
    const line = lastNonEmptyLine(text);
    if (line) {
      this.liveMessage = line;
      this.lastOutputLine = line;
    }
    const stage = inferStageFromOutput(text);
    if (stage) this.advanceLiveStage(stage);
  }

  advanceLiveStage(stage) {
    const next = normalizeStageForUi(stage);
    if (!next || next === "initialized" || next === "idle") return;
    const current = normalizeStageForUi(this.liveStage);
    if (!current || isTerminalStage(next) || stageIndex(next) >= stageIndex(current)) {
      this.liveStage = next;
    }
  }

  openArtifact(key) {
    const artifacts = (this.state && this.state.artifacts) || {};
    if (!artifacts[key]) {
      new Notice(`No ${key} artifact for this run.`);
      return;
    }
    this.openPath(artifacts[key]);
  }

  openPath(value) {
    const relativePath = toVaultRelativePath(value, this.plugin.settings.vaultPath);
    if (!relativePath) {
      new Notice(`Artifact is outside the vault or missing: ${value}`);
      return;
    }
    const relative = normalizePath(relativePath);
    const file = this.app.vault.getAbstractFileByPath(relative);
    if (file) {
      this.app.workspace.getLeaf(true).openFile(file);
      return;
    }
    new Notice(`Artifact is outside the vault or missing: ${value}`);
  }

  retryPaper(paper) {
    this.retryPaperMode(paper, "run");
  }

  retryPaperMode(paper, mode) {
    const arxivId = extractArxivId(paper.arxiv_id || paper.paper_id || paper.pdf_url || paper.url);
    const url = textValue(paper.url) || (arxivId ? `https://arxiv.org/abs/${arxivId}` : "") || textValue(paper.pdf_url);
    if (!url) {
      new Notice("No retry URL or paper id is available.");
      return;
    }
    this.form.mode = mode;
    this.form.arxivUrl = url;
    this.activePanel = "run";
    this.render();
    new Notice(`Paper loaded for ${mode} retry.`);
  }

  copyDiagnostics() {
    const payload = {
      lastPayload: this.lastPayload,
      state: this.state
        ? {
            run_id: this.state.run_id,
            stage: this.state.stage,
            errors: this.state.errors || [],
            artifacts: this.state.artifacts || {},
          }
        : null,
      stderr: this.stderr.slice(-4000),
      stdout: this.stdout.slice(-4000),
      recentLogs: ((this.state && this.state.logs) || []).slice(-20),
    };
    const redacted = redactDiagnostics(payload, [
      this.plugin.settings.vaultPath,
      this.plugin.settings.backendPath,
      this.plugin.settings.configPath,
      this.plugin.settings.cliPath,
      this.plugin.settings.pythonPath,
    ]);
    navigator.clipboard.writeText(JSON.stringify(redacted, null, 2))
      .then(() => new Notice("Redacted PaperBrain diagnostics copied. Review before sharing."))
      .catch((error) => {
        this.appendLog(`clipboard copy failed: ${error.message}`);
        this.render();
      });
  }

  appendLog(line) {
    this.stderr = `${this.stderr}\n${line}`.trim();
  }
}

class PaperBrainSettingTab extends PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display() {
    const { containerEl } = this;
    containerEl.empty();
    const validation = this.plugin.validateConfiguration(false);
    new Setting(containerEl)
      .setName("Runtime status")
      .setDesc(validation.ok
        ? `${validation.invocation.mode === "cli" ? "CLI" : "Python script"} mode is ready.${validation.warnings[0] ? ` ${validation.warnings[0]}` : ""}`
        : validation.errors.join(" "))
      .addButton((button) => button
        .setButtonText("Validate")
        .onClick(() => this.plugin.validateConfiguration(true)));
    new Setting(containerEl)
      .setName("Execution mode")
      .setDesc("Auto uses a backend script when found, otherwise the installed paperbrain CLI.")
      .addDropdown((dropdown) => dropdown
        .addOption("auto", "Auto")
        .addOption("cli", "Installed CLI")
        .addOption("python-script", "Python script")
        .setValue(this.plugin.settings.executionMode)
        .onChange(async (value) => {
          this.plugin.settings.executionMode = value;
          await this.plugin.saveSettings();
          this.display();
        }));
    new Setting(containerEl)
      .setName("CLI executable")
      .setDesc("Optional absolute path or command name. Leave empty to use paperbrain from PATH.")
      .addText((input) => input
        .setPlaceholder("paperbrain")
        .setValue(this.plugin.settings.cliPath)
        .onChange(async (value) => {
          this.plugin.settings.cliPath = value.trim();
          await this.plugin.saveSettings();
        }));
    new Setting(containerEl)
      .setName("Python executable")
      .setDesc("Optional absolute path or command name for Python script mode.")
      .addText((input) => input
        .setPlaceholder(process.platform === "win32" ? "python" : "python3")
        .setValue(this.plugin.settings.pythonPath)
        .onChange(async (value) => {
          this.plugin.settings.pythonPath = value.trim();
          await this.plugin.saveSettings();
        }));
    new Setting(containerEl)
      .setName("Backend checkout path")
      .setDesc("Folder containing script/paperbrain.py. It may be separate from the Obsidian vault.")
      .addText((input) => input
        .setValue(this.plugin.settings.backendPath)
        .onChange(async (value) => {
          this.plugin.settings.backendPath = value.trim();
          await this.plugin.saveSettings();
        }));
    new Setting(containerEl)
      .setName("Backend config file")
      .setDesc("Optional config YAML path, passed to both installed CLI and Python script runs.")
      .addText((input) => input
        .setValue(this.plugin.settings.configPath)
        .onChange(async (value) => {
          this.plugin.settings.configPath = value.trim();
          await this.plugin.saveSettings();
        }));
    new Setting(containerEl)
      .setName("Vault path")
      .setDesc("Detected from the current desktop vault on first load. Run records and artifacts are read here.")
      .addText((input) => input
        .setValue(this.plugin.settings.vaultPath)
        .onChange(async (value) => {
          this.plugin.settings.vaultPath = value.trim();
          await this.plugin.saveSettings();
        }));
    new Setting(containerEl)
      .setName("Default provider")
      .addDropdown((dropdown) => dropdown
        .addOption("openrouter", "openrouter")
        .addOption("doubao", "doubao")
        .setValue(this.plugin.settings.provider)
        .onChange(async (value) => {
          this.plugin.settings.provider = value;
          await this.plugin.saveSettings();
        }));
    new Setting(containerEl)
      .setName("Generate podcast by default")
      .addToggle((toggle) => toggle
        .setValue(!!this.plugin.settings.generatePodcast)
        .onChange(async (value) => {
          this.plugin.settings.generatePodcast = value;
          await this.plugin.saveSettings();
        }));
    new Setting(containerEl)
      .setName("Cancel timeout seconds")
      .addText((text) => text
        .setValue(String(this.plugin.settings.cancelTimeoutSeconds))
        .onChange(async (value) => {
          this.plugin.settings.cancelTimeoutSeconds = Math.max(3, Number(value || 20));
          await this.plugin.saveSettings();
        }));
  }
}

function parseDateUtc(dateText) {
  const match = textValue(dateText).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return parseDateUtc(yesterday());
  return new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
}

function formatDateUtc(date) {
  return date.toISOString().slice(0, 10);
}

function briefPeriod(mode, dateText) {
  const anchor = parseDateUtc(dateText);
  if (mode === "month") {
    const start = new Date(Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth(), 1));
    const end = new Date(Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth() + 1, 0));
    return {
      type: "month",
      label: formatDateUtc(start).slice(0, 7),
      start: formatDateUtc(start),
      end: formatDateUtc(end),
      days: dateRange(formatDateUtc(start), formatDateUtc(end)).length,
    };
  }
  const day = anchor.getUTCDay() || 7;
  const start = new Date(anchor);
  start.setUTCDate(anchor.getUTCDate() - day + 1);
  const end = new Date(start);
  end.setUTCDate(start.getUTCDate() + 6);
  const thursday = new Date(start);
  thursday.setUTCDate(start.getUTCDate() + 3);
  const yearStart = new Date(Date.UTC(thursday.getUTCFullYear(), 0, 1));
  const week = Math.ceil((((thursday - yearStart) / 86400000) + 1) / 7);
  return {
    type: "week",
    label: `${thursday.getUTCFullYear()}-W${String(week).padStart(2, "0")}`,
    start: formatDateUtc(start),
    end: formatDateUtc(end),
    days: 7,
  };
}

function dateRange(startDate, endDate) {
  const dates = [];
  const current = parseDateUtc(startDate);
  const end = parseDateUtc(endDate);
  while (current <= end) {
    dates.push(formatDateUtc(current));
    current.setUTCDate(current.getUTCDate() + 1);
  }
  return dates;
}

function digestField(text, label) {
  const pattern = new RegExp(`-\\s+\\*\\*[^*\\n]*${label}\\*\\*:\\s*([\\s\\S]*?)(?=\\n-\\s+\\*\\*|\\n---|$)`, "i");
  const match = String(text || "").match(pattern);
  return match ? match[1].replace(/\s+/g, " ").trim() : "";
}

function cleanDigestTitle(title) {
  return textValue(title).replace(/^[^\w]+/u, "").trim();
}

function firstUrl(text) {
  const match = textValue(text).match(/https?:\/\/[^)\s]+/);
  return match ? match[0] : "";
}

function number(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function formatScore(value) {
  return number(value).toFixed(1);
}

function hasNumericValue(value) {
  const n = Number(value);
  return Number.isFinite(n);
}

function queueScoreValue(paper) {
  if (hasNumericValue(paper.score)) return number(paper.score);
  if (hasNumericValue(paper.coarse_score)) return number(paper.coarse_score);
  return 0;
}

function formatQueueScore(paper) {
  if (hasNumericValue(paper.score)) return formatScore(paper.score);
  if (hasNumericValue(paper.coarse_score)) return `${formatScore(paper.coarse_score)}c`;
  return "new";
}

function qualityMetricValue(paper, key) {
  if (hasNumericValue(paper[key])) return number(paper[key]);
  const fallback = {
    relevance: "coarse_relevance",
    rigor: "coarse_method_completeness",
    evidence: "coarse_evidence",
  }[key];
  return fallback && hasNumericValue(paper[fallback]) ? number(paper[fallback]) : 0;
}

function paperStageHint(paper) {
  if (paper.selected_for_deep_analysis) return "deep";
  if (paper.in_daily_digest) return "digest";
  if (hasNumericValue(paper.score)) return "screened";
  if (hasNumericValue(paper.coarse_score)) return paper.should_rescreen ? "coarse / stage2" : "coarse";
  return textValue(paper.source) || "fetched";
}

function textValue(value) {
  return typeof value === "string" ? value.trim() : "";
}

function extractArxivId(value) {
  const match = textValue(value).match(/(\d{4}\.\d{4,5})(?:v\d+)?/);
  return match ? match[1] : "";
}

function presetById(id) {
  return PRESETS.find((item) => item.id === id) || PRESETS[0];
}

function normalizeStageForUi(stage) {
  const value = textValue(stage);
  return stageAlias(value) || value || "idle";
}

function stageAlias(stage) {
  const value = textValue(stage);
  if (value === "fetched") return "fetch";
  if (value === "coarse_screened") return "coarse";
  if (value === "screened") return "screen";
  if (value === "deep_analyzed") return "deep";
  if (value === "digest_written") return "digest";
  if (STAGES.includes(value)) return value;
  return "";
}

function stageIndex(stage) {
  const value = normalizeStageForUi(stage);
  return STAGE_TO_INDEX[value] ?? -1;
}

function isTerminalStage(stage) {
  return ["completed", "failed", "cancelled"].includes(textValue(stage));
}

function titleCase(value) {
  const text = textValue(value);
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : "";
}

function eventLabel(log) {
  return textValue(log.event_type || "log").replace(/_/g, " ");
}

function logText(log) {
  if (!log) return "";
  return `${log.message || ""} ${log.title || ""}`.trim() || eventLabel(log);
}

function lastNonEmptyLine(text) {
  const lines = String(text || "").split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  return lines.length ? lines[lines.length - 1] : "";
}

function inferStageFromOutput(text) {
  const value = String(text || "");
  for (const hint of OUTPUT_STAGE_HINTS) {
    if (hint.pattern.test(value)) return hint.stage;
  }
  return "";
}
