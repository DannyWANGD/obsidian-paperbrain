"use strict";

const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { backendAssetUrl } = require("./backend-release");
const { miniforgeAssetUrl } = require("./miniforge-release");
const { boundedAppend, cliExecutableForEnv, parseCondaEnvironmentList, parsePayload, pythonExecutableForEnv } = require("./runtime");

class BackendInstaller {
  constructor(options = {}) {
    this.spawn = options.spawn;
    this.download = options.download;
    this.fs = options.fs || fs.promises;
    this.platform = options.platform || process.platform;
    this.arch = options.arch || process.arch;
    this.path = options.pathApi || path;
    this.os = options.osApi || os;
    this.listeners = new Set();
    this.child = null;
    this.disposed = false;
    this.state = this.emptyState();
  }

  emptyState() {
    return {
      running: false,
      stopping: false,
      stage: "idle",
      logs: "",
      error: "",
      result: null,
    };
  }

  snapshot() {
    return { ...this.state, result: this.state.result ? { ...this.state.result } : null };
  }

  subscribe(listener) {
    this.listeners.add(listener);
    listener(this.snapshot(), "attach");
    return () => this.listeners.delete(listener);
  }

  emit(event) {
    const snapshot = this.snapshot();
    for (const listener of this.listeners) listener(snapshot, event);
  }

  setStage(stage, message) {
    this.state.stage = stage;
    if (message) this.appendLog(message, false);
    this.emit("stage");
  }

  appendLog(message, emit = true) {
    const line = String(message || "").trimEnd();
    if (!line) return;
    this.state.logs = boundedAppend(this.state.logs, `${this.state.logs ? "\n" : ""}${line}`, 200000);
    if (emit) this.emit("output");
  }

  async install(plan) {
    if (this.disposed) return { ok: false, reason: "disposed" };
    if (this.state.running) return { ok: false, reason: "already-running" };
    this.state = { ...this.emptyState(), running: true, stage: "starting" };
    this.emit("started");
    let tempDir = "";
    const installContext = { managedRootCreated: false, managedRuntimeReady: false };
    try {
      this.validatePlan(plan);
      tempDir = await this.fs.mkdtemp(this.path.join(this.os.tmpdir(), "paperbrain-installer-"));
      const conda = await this.ensureConda(plan, tempDir, installContext);
      this.setStage("detecting", "Checking the selected Conda installation for a wd environment.");
      const managedEnvRoot = conda.managed ? plan.miniforge.installDir : "";
      let envPath = await this.findWdEnvironment(conda.executable, managedEnvRoot);
      if (!envPath) {
        this.setStage("environment", "Creating the isolated Conda environment wd with Python 3.10.");
        const destination = conda.managed
          ? ["--prefix", this.path.join(plan.miniforge.installDir, "envs", "wd")]
          : ["--name", "wd"];
        await this.runCommand(conda.executable, [
          "create", "--yes", ...destination,
          "--override-channels", "--channel", "https://conda.anaconda.org/conda-forge", "python=3.10", "pip",
        ]);
        envPath = await this.findWdEnvironment(conda.executable, managedEnvRoot);
      } else {
        this.appendLog(`Reusing existing wd environment: ${envPath}`);
      }
      if (!envPath) throw new Error("Conda did not report a wd environment after creation.");

      const pythonPath = pythonExecutableForEnv(envPath, this.platform, this.path);
      const cliPath = cliExecutableForEnv(envPath, this.platform, this.path);
      const downloaded = {};
      for (const [key, asset] of Object.entries(plan.release.assets)) {
        this.setStage("download", `Downloading ${asset.name} from the fixed PaperBrain ${plan.release.version} release.`);
        const target = await this.downloadVerifiedAsset(backendAssetUrl(asset, plan.release), asset, tempDir);
        downloaded[key] = target;
      }

      this.setStage("dependencies", "Installing the locked Python dependencies from PyPI into wd.");
      await this.runCommand(pythonPath, [
        "-m", "pip", "install", "--disable-pip-version-check",
        "--index-url", "https://pypi.org/simple", "--require-hashes", "-r", downloaded.requirements,
      ]);
      this.setStage("backend", `Installing PaperBrain backend ${plan.release.version} into wd.`);
      await this.runCommand(pythonPath, [
        "-m", "pip", "install", "--disable-pip-version-check", "--no-deps", "--force-reinstall", downloaded.wheel,
      ]);
      this.setStage("configuration", "Creating the user-owned configuration without overwriting an existing .env file.");
      const bootstrap = await this.runCommand(cliPath, ["bootstrap", "--config-dir", plan.configDir, "--vault", plan.vaultPath]);
      const payload = parsePayload(bootstrap.stdout);
      if (!payload || payload.ok !== true || payload.command !== "bootstrap") {
        throw new Error("The installed backend did not return a valid bootstrap result.");
      }

      this.state.result = {
        ok: true,
        version: plan.release.version,
        envPath,
        pythonPath,
        cliPath,
        condaPath: conda.executable,
        condaManaged: conda.managed,
        managedRuntimePath: conda.managed ? plan.miniforge.installDir : "",
        configPath: payload.config_path,
        envFilePath: payload.env_path,
      };
      this.state.stage = "completed";
      this.appendLog("PaperBrain backend installation completed.", false);
      return this.state.result;
    } catch (error) {
      this.state.error = error && error.message ? error.message : String(error);
      this.state.stage = this.state.stopping ? "cancelled" : "failed";
      this.appendLog(`Installation ${this.state.stopping ? "cancelled" : "failed"}: ${this.state.error}`, false);
      return { ok: false, reason: this.state.stopping ? "cancelled" : "failed", error: this.state.error };
    } finally {
      this.child = null;
      if (installContext.managedRootCreated && !installContext.managedRuntimeReady) {
        try {
          await this.fs.rm(plan.miniforge.installDir, { recursive: true, force: true });
          await this.fs.rm(`${plan.miniforge.installDir}.paperbrain-installing`, { force: true });
          this.appendLog("Removed the incomplete managed Miniforge installation.", false);
        } catch (error) {
          this.appendLog(`Incomplete runtime cleanup failed: ${error.message}`, false);
        }
      }
      if (tempDir) {
        try {
          await this.fs.rm(tempDir, { recursive: true, force: true });
        } catch (error) {
          this.appendLog(`Temporary installer cleanup failed: ${error.message}`, false);
        }
      }
      this.state.running = false;
      this.state.stopping = false;
      this.emit("finished");
    }
  }

  validatePlan(plan) {
    if (!plan || !plan.release || !plan.configDir || !plan.vaultPath) {
      throw new Error("The backend installation plan is incomplete.");
    }
    for (const asset of Object.values(plan.release.assets || {})) {
      if (!asset.name || !/^[a-f0-9]{64}$/.test(asset.sha256 || "")) {
        throw new Error(`The backend release manifest is incomplete for ${asset.name || "an asset"}.`);
      }
    }
    if (!plan.condaExecutable) {
      const miniforge = plan.miniforge || {};
      const asset = miniforge.asset || {};
      if (!miniforge.release || !miniforge.installDir || !asset.name || !/^[a-f0-9]{64}$/.test(asset.sha256 || "")) {
        throw new Error(`Automatic Miniforge installation is not available for ${this.platform}/${this.arch}.`);
      }
    }
  }

  async ensureConda(plan, tempDir, context) {
    if (plan.condaExecutable) {
      this.setStage("runtime", `Using the detected Conda executable: ${plan.condaExecutable}`);
      await this.runCommand(plan.condaExecutable, ["--version"]);
      return { executable: plan.condaExecutable, managed: false };
    }

    const root = plan.miniforge.installDir;
    const executable = managedCondaExecutable(root, this.platform, this.path);
    if (await this.exists(executable)) {
      this.setStage("runtime", `Reusing PaperBrain-managed Miniforge at ${root}.`);
      await this.runCommand(executable, ["--version"]);
      return { executable, managed: true };
    }

    const installingMarker = `${root}.paperbrain-installing`;
    const managedMarker = this.path.join(root, ".paperbrain-managed.json");
    const interruptedInstall = await this.exists(installingMarker);
    if (await this.exists(root)) {
      if (interruptedInstall || await this.exists(managedMarker)) {
        this.setStage("runtime", "Removing an incomplete PaperBrain-managed Miniforge runtime before retrying.");
        await this.fs.rm(root, { recursive: true, force: true });
        await this.fs.rm(installingMarker, { force: true });
      } else {
        throw new Error(`The managed runtime directory already exists but is not owned by PaperBrain: ${root}`);
      }
    } else if (interruptedInstall) {
      await this.fs.rm(installingMarker, { force: true });
    }

    context.managedRootCreated = true;
    await this.fs.mkdir(this.path.dirname(root), { recursive: true });
    await this.fs.writeFile(installingMarker, "PaperBrain managed installation in progress\n", { flag: "wx" });
    const asset = plan.miniforge.asset;
    this.setStage("runtime", `No Conda installation was found. Downloading verified Miniforge ${plan.miniforge.release.version}.`);
    const installer = await this.downloadVerifiedAsset(
      miniforgeAssetUrl(asset, plan.miniforge.release), asset, tempDir,
    );
    this.setStage("runtime", "Installing Miniforge in PaperBrain's private runtime directory without changing PATH.");
    if (this.platform === "win32") {
      await this.runCommand(installer, [
        "/InstallationType=JustMe",
        "/RegisterPython=0",
        "/S",
        `/D=${root}`,
      ]);
    } else {
      await this.runCommand("/bin/bash", [installer, "-b", "-p", root]);
    }
    if (!await this.exists(executable)) throw new Error("Miniforge installation completed without a usable Conda executable.");
    await this.runCommand(executable, ["--version"]);
    await this.fs.rm(installingMarker, { force: true });
    await this.fs.writeFile(managedMarker, JSON.stringify({
      owner: "PaperBrain",
      miniforgeVersion: plan.miniforge.release.version,
      platform: this.platform,
      arch: this.arch,
    }, null, 2));
    context.managedRuntimeReady = true;
    this.appendLog(`Miniforge ${plan.miniforge.release.version} is ready at ${root}.`);
    return { executable, managed: true };
  }

  async downloadVerifiedAsset(url, asset, tempDir) {
    const bytes = await this.download(url);
    const actual = crypto.createHash("sha256").update(bytes).digest("hex");
    if (actual !== asset.sha256) throw new Error(`SHA-256 verification failed for ${asset.name}.`);
    const target = this.path.join(tempDir, asset.name);
    await this.fs.writeFile(target, bytes, { flag: "wx" });
    this.appendLog(`Verified ${asset.name}: ${actual}`);
    return target;
  }

  async exists(target) {
    try {
      await this.fs.access(target);
      return true;
    } catch (_) {
      return false;
    }
  }

  async findWdEnvironment(condaExecutable, requiredRoot = "") {
    const result = await this.runCommand(condaExecutable, ["env", "list", "--json"]);
    return parseCondaEnvironmentList(result.stdout)
      .find((entry) => this.path.basename(entry).toLowerCase() === "wd" && this.isWithinRoot(entry, requiredRoot)) || "";
  }

  isWithinRoot(target, requiredRoot) {
    if (!requiredRoot) return true;
    const relative = this.path.relative(this.path.resolve(requiredRoot), this.path.resolve(target));
    return relative !== "" && relative !== ".." && !relative.startsWith(`..${this.path.sep}`) && !this.path.isAbsolute(relative);
  }

  runCommand(executable, args) {
    if (this.state.stopping) return Promise.reject(new Error("Installation cancelled."));
    this.appendLog(`$ ${executable} ${args.join(" ")}`);
    return new Promise((resolve, reject) => {
      let stdout = "";
      let stderr = "";
      let settled = false;
      const child = this.spawn(executable, args, { windowsHide: true, env: { ...process.env } });
      this.child = child;
      child.stdout.on("data", (data) => {
        const text = String(data);
        stdout = boundedAppend(stdout, text);
        this.appendLog(text.trimEnd());
      });
      child.stderr.on("data", (data) => {
        const text = String(data);
        stderr = boundedAppend(stderr, text);
        this.appendLog(text.trimEnd());
      });
      child.once("error", (error) => {
        if (settled) return;
        settled = true;
        if (this.child === child) this.child = null;
        reject(error);
      });
      child.once("close", (code, signal) => {
        if (settled) return;
        settled = true;
        if (this.child === child) this.child = null;
        if (code === 0 && !signal) resolve({ stdout, stderr });
        else reject(new Error(lastLine(stderr) || `${executable} exited with ${signal || code}.`));
      });
    });
  }

  stop() {
    if (!this.state.running || this.state.stopping) return false;
    this.state.stopping = true;
    this.emit("stopping");
    if (this.child) this.child.kill();
    return true;
  }

  dispose() {
    this.disposed = true;
    this.state.stopping = true;
    if (this.child) this.child.kill();
    this.child = null;
    this.listeners.clear();
  }
}

function managedCondaExecutable(root, platform = process.platform, pathApi = path) {
  return platform === "win32"
    ? pathApi.join(root, "Scripts", "conda.exe")
    : pathApi.join(root, "bin", "conda");
}

function lastLine(value) {
  return String(value || "").split(/\r?\n/).map((line) => line.trim()).filter(Boolean).at(-1) || "";
}

module.exports = { BackendInstaller, managedCondaExecutable };
