"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { EventEmitter } = require("node:events");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { BackendInstaller, managedCondaExecutable } = require("../src/backend-installer");
const { MINIFORGE_RELEASE, resolveMiniforgeAsset } = require("../src/miniforge-release");

function sha(bytes) {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

function fixtureRelease(wheel, requirements) {
  return {
    repository: "example/PaperBrain",
    version: "0.3.4",
    tag: "backend-0.3.4",
    assets: {
      wheel: { name: "paperbrain-0.3.4-py3-none-any.whl", sha256: sha(wheel) },
      requirements: { name: "requirements.lock", sha256: sha(requirements) },
    },
  };
}

function completedChild(stdout = "", stderr = "", onStart = () => {}) {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.pid = 1234;
  child.kill = () => {
    process.nextTick(() => child.emit("close", null, "SIGTERM"));
    return true;
  };
  onStart();
  process.nextTick(() => {
    if (stdout) child.stdout.emit("data", Buffer.from(stdout));
    if (stderr) child.stderr.emit("data", Buffer.from(stderr));
    child.emit("close", 0, null);
  });
  return child;
}

async function temporaryRoot(t) {
  const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), "paperbrain-installer-test-"));
  t.after(() => fs.promises.rm(root, { recursive: true, force: true }));
  return root;
}

test("an existing Conda installation is preferred and its wd environment is reused", async (t) => {
  const root = await temporaryRoot(t);
  const wheel = Buffer.from("wheel");
  const requirements = Buffer.from("requirements");
  const release = fixtureRelease(wheel, requirements);
  const envPath = path.join(root, "existing-conda", "envs", "wd");
  const calls = [];
  const spawn = (executable, args) => {
    calls.push({ executable, args });
    if (args[0] === "--version") return completedChild("conda 26.3.1\n");
    if (args[0] === "env") return completedChild(JSON.stringify({ envs: [envPath] }));
    if (args[0] === "bootstrap") {
      return completedChild(JSON.stringify({
        ok: true,
        command: "bootstrap",
        config_path: path.join(root, "config", "config.yaml"),
        env_path: path.join(root, "config", ".env"),
      }));
    }
    return completedChild();
  };
  const installer = new BackendInstaller({
    spawn,
    download: async (url) => url.endsWith("requirements.lock") ? requirements : wheel,
  });
  const result = await installer.install({
    condaExecutable: path.join(root, "conda"),
    configDir: path.join(root, "config"),
    vaultPath: path.join(root, "vault"),
    release,
  });

  assert.equal(result.ok, true);
  assert.equal(result.condaManaged, false);
  assert.equal(result.envPath, envPath);
  assert.equal(calls.some((call) => call.args[0] === "create"), false);
  assert.equal(calls[0].executable, path.join(root, "conda"));
});

test("missing Conda installs verified Miniforge privately before creating wd", async (t) => {
  const root = await temporaryRoot(t);
  const managedRoot = path.join(root, "runtime", "miniforge3");
  const envPath = path.join(managedRoot, "envs", "wd");
  const externalWd = path.join(root, "external-conda", "envs", "wd");
  const wheel = Buffer.from("wheel");
  const requirements = Buffer.from("requirements");
  const miniforge = Buffer.from("miniforge-installer");
  const release = fixtureRelease(wheel, requirements);
  const miniforgeRelease = {
    repository: "conda-forge/miniforge",
    version: "test",
    tag: "test",
    assets: {},
  };
  const asset = { name: "Miniforge3-test-Windows-x86_64.exe", sha256: sha(miniforge), size: miniforge.length };
  let wdCreated = false;
  const calls = [];
  const spawn = (executable, args) => {
    calls.push({ executable, args });
    if (String(executable).endsWith(asset.name)) {
      const installDir = args.find((value) => value.startsWith("/D=")).slice(3);
      return completedChild("", "", () => {
        fs.mkdirSync(path.dirname(managedCondaExecutable(installDir, "win32")), { recursive: true });
        fs.writeFileSync(managedCondaExecutable(installDir, "win32"), "fake conda");
      });
    }
    if (args[0] === "--version") return completedChild("conda test\n");
    if (args[0] === "env") return completedChild(JSON.stringify({ envs: wdCreated ? [externalWd, envPath] : [externalWd] }));
    if (args[0] === "create") {
      wdCreated = true;
      return completedChild();
    }
    if (args[0] === "bootstrap") {
      return completedChild(JSON.stringify({
        ok: true,
        command: "bootstrap",
        config_path: path.join(root, "config", "config.yaml"),
        env_path: path.join(root, "config", ".env"),
      }));
    }
    return completedChild();
  };
  const installer = new BackendInstaller({
    spawn,
    platform: "win32",
    arch: "x64",
    download: async (url) => {
      if (url.endsWith(asset.name)) return miniforge;
      return url.endsWith("requirements.lock") ? requirements : wheel;
    },
  });
  const result = await installer.install({
    condaExecutable: "",
    configDir: path.join(root, "config"),
    vaultPath: path.join(root, "vault"),
    release,
    miniforge: { release: miniforgeRelease, asset, installDir: managedRoot },
  });

  assert.equal(result.ok, true);
  assert.equal(result.condaManaged, true);
  assert.equal(result.condaPath, managedCondaExecutable(managedRoot, "win32"));
  assert.equal(fs.existsSync(path.join(managedRoot, ".paperbrain-managed.json")), true);
  assert.equal(fs.existsSync(`${managedRoot}.paperbrain-installing`), false);
  assert.equal(calls.some((call) => call.args[0] === "create"), true);
  const createCall = calls.find((call) => call.args[0] === "create");
  assert.deepEqual(createCall.args.slice(0, 5), ["create", "--yes", "--prefix", envPath, "--override-channels"]);
  assert.equal(createCall.args[createCall.args.indexOf("--channel") + 1], "https://conda.anaconda.org/conda-forge");
  assert.equal(calls.findIndex((call) => String(call.executable).endsWith(asset.name)) < calls.findIndex((call) => call.args[0] === "create"), true);
});

test("a failed checksum prevents package installation", async (t) => {
  const root = await temporaryRoot(t);
  const release = fixtureRelease(Buffer.from("expected"), Buffer.from("requirements"));
  const envPath = path.join(root, "envs", "wd");
  const calls = [];
  const installer = new BackendInstaller({
    spawn: (executable, args) => {
      calls.push({ executable, args });
      if (args[0] === "--version") return completedChild("conda test\n");
      if (args[0] === "env") return completedChild(JSON.stringify({ envs: [envPath] }));
      return completedChild();
    },
    download: async () => Buffer.from("tampered"),
  });
  const result = await installer.install({
    condaExecutable: "conda",
    configDir: path.join(root, "config"),
    vaultPath: path.join(root, "vault"),
    release,
  });

  assert.equal(result.ok, false);
  assert.match(result.error, /SHA-256 verification failed/);
  assert.equal(calls.some((call) => call.args.includes("pip")), false);
});

test("stop during a download prevents package installation and finishes as cancelled", async (t) => {
  const root = await temporaryRoot(t);
  const wheel = Buffer.from("wheel");
  const requirements = Buffer.from("requirements");
  const release = fixtureRelease(wheel, requirements);
  const envPath = path.join(root, "envs", "wd");
  const calls = [];
  let releaseDownload;
  const downloadStarted = new Promise((resolve) => { releaseDownload = resolve; });
  let finishDownload;
  const pendingDownload = new Promise((resolve) => { finishDownload = resolve; });
  const installer = new BackendInstaller({
    spawn: (executable, args) => {
      calls.push({ executable, args });
      if (args[0] === "--version") return completedChild("conda test\n");
      if (args[0] === "env") return completedChild(JSON.stringify({ envs: [envPath] }));
      return completedChild();
    },
    download: async () => {
      releaseDownload();
      return pendingDownload;
    },
  });
  const installation = installer.install({
    condaExecutable: "conda",
    configDir: path.join(root, "config"),
    vaultPath: path.join(root, "vault"),
    release,
  });
  await downloadStarted;
  assert.equal(installer.stop(), true);
  finishDownload(wheel);
  const result = await installation;

  assert.equal(result.ok, false);
  assert.equal(result.reason, "cancelled");
  assert.equal(calls.some((call) => call.args.includes("pip")), false);
});

test("the embedded Miniforge manifest covers supported desktop architectures", () => {
  for (const [platform, arch] of [
    ["win32", "x64"], ["darwin", "x64"], ["darwin", "arm64"], ["linux", "x64"], ["linux", "arm64"],
  ]) {
    const asset = resolveMiniforgeAsset(platform, arch, MINIFORGE_RELEASE);
    assert.ok(asset, `${platform}/${arch} should be supported`);
    assert.match(asset.sha256, /^[a-f0-9]{64}$/);
    assert.ok(asset.size > 50 * 1024 * 1024);
  }
  assert.equal(resolveMiniforgeAsset("win32", "arm64", MINIFORGE_RELEASE), null);
});
