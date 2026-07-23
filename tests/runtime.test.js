"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const {
  boundedAppend,
  buildInvocation,
  buildSpawnOptions,
  buildSiblingInvocation,
  detectVaultPath,
  detectBackendPath,
  detectWdPython,
  findExecutable,
  isCompatibleBackendVersion,
  isCurrentProcess,
  mergeFailurePayload,
  normalizeRuntimeSettings,
  parsePayload,
  processOutcome,
  redactDiagnostics,
  runConfirmationRequirements,
  safeExternalHttpUrl,
  toVaultRelativePath,
  validateRuntimeSettings,
  yesterday,
} = require("../src/runtime");

test("fresh settings detect the current vault and its local backend", () => {
  const vault = path.resolve("test-vault");
  const script = path.join(vault, "script", "paperbrain.py");
  const settings = normalizeRuntimeSettings({}, {
    detectedVaultPath: vault,
    existsSync: (value) => value === script,
  });
  assert.equal(settings.vaultPath, vault);
  assert.equal(settings.backendPath, vault);
  assert.equal(settings.pythonPath, "");
  assert.equal(settings.cliPath, "");
  assert.equal(settings.configPath, "");
  assert.equal(settings.executionMode, "auto");
  assert.equal(settings.defaultRunTime, undefined);
});

test("desktop vault detection uses the file-system adapter base path", () => {
  assert.equal(detectVaultPath({ vault: { adapter: { getBasePath: () => "D:\\Vault" } } }), "D:\\Vault");
  assert.equal(detectVaultPath({ vault: { adapter: { basePath: "/home/user/vault" } } }), "/home/user/vault");
  assert.equal(detectVaultPath({}), "");
});

test("legacy repoPath migrates to backendPath without replacing the vault", () => {
  const settings = normalizeRuntimeSettings({ repoPath: "C:\\backend", vaultPath: "D:\\vault" });
  assert.equal(settings.backendPath, "C:\\backend");
  assert.equal(settings.vaultPath, "D:\\vault");
  assert.equal(settings.repoPath, undefined);
});

test("settings v2 migrate to v3 without losing user choices", () => {
  const settings = normalizeRuntimeSettings({
    settingsVersion: 2,
    backendPath: "D:\\backend",
    pythonPath: "D:\\conda\\envs\\wd\\python.exe",
    provider: "doubao",
    paidRunDisclosureAccepted: true,
  });
  assert.equal(settings.settingsVersion, 3);
  assert.equal(settings.backendPath, "D:\\backend");
  assert.equal(settings.provider, "doubao");
  assert.equal(settings.paidRunDisclosureAccepted, true);
});

test("wd Python detection follows saved, current Conda, then env-list order", () => {
  const saved = path.resolve("saved", "python.exe");
  const current = path.resolve("conda", "envs", "wd");
  const listed = path.resolve("other", "envs", "wd");
  const currentPython = path.join(current, process.platform === "win32" ? "python.exe" : "bin/python");
  const listedPython = path.join(listed, process.platform === "win32" ? "python.exe" : "bin/python");
  assert.equal(detectWdPython({ savedPath: saved, existsSync: (value) => value === saved }).source, "saved");
  assert.equal(detectWdPython({
    env: { CONDA_PREFIX: current },
    condaJson: JSON.stringify({ envs: [listed] }),
    existsSync: (value) => value === currentPython || value === listedPython,
  }).source, "current-conda");
  assert.equal(detectWdPython({
    env: {},
    condaJson: JSON.stringify({ envs: [listed] }),
    existsSync: (value) => value === listedPython,
  }).path, listedPython);
});

test("backend detection only checks the saved checkout and current vault", () => {
  const saved = path.resolve("saved-backend");
  const vault = path.resolve("vault-backend");
  const vaultScript = path.join(vault, "script", "paperbrain.py");
  const checked = [];
  const found = detectBackendPath({
    savedPath: saved,
    vaultPath: vault,
    existsSync: (value) => { checked.push(value); return value === vaultScript; },
  });
  assert.equal(found, vault);
  assert.deepEqual(checked, [path.join(saved, "script", "paperbrain.py"), vaultScript]);
});

test("paid-run disclosure is once per settings profile while force always confirms", () => {
  assert.deepEqual(runConfirmationRequirements({ paidRunDisclosureAccepted: false }, { command: "run", force: false }), {
    paidDisclosure: true,
    forceReset: false,
  });
  assert.deepEqual(runConfirmationRequirements({ paidRunDisclosureAccepted: true }, { command: "run", force: true }), {
    paidDisclosure: false,
    forceReset: true,
  });
  assert.equal(runConfirmationRequirements({ paidRunDisclosureAccepted: false }, { command: "index" }).paidDisclosure, false);
});

test("auto invocation prefers a local script and falls back to installed CLI", () => {
  const backend = path.resolve("backend");
  const script = path.join(backend, "script", "paperbrain.py");
  const base = { executionMode: "auto", backendPath: backend, vaultPath: path.resolve("vault"), pythonPath: "", cliPath: "" };
  const python = buildInvocation(base, ["doctor"], { existsSync: (value) => value === script, platform: "linux" });
  assert.equal(python.mode, "python-script");
  assert.equal(python.executable, "python3");
  assert.deepEqual(python.args, [script, "doctor"]);

  const cli = buildInvocation({ ...base, backendPath: "" }, ["doctor"], { existsSync: () => false });
  assert.equal(cli.mode, "cli");
  assert.equal(cli.executable, "paperbrain");
  assert.deepEqual(cli.args, ["doctor"]);
});

test("explicit CLI and Python modes retain the configured executable", () => {
  const cli = buildInvocation({ executionMode: "cli", cliPath: "pb", backendPath: "", vaultPath: "D:\\vault" }, ["index"]);
  assert.equal(cli.executable, "pb");
  assert.deepEqual(cli.prefixArgs, []);

  const python = buildInvocation({ executionMode: "python-script", pythonPath: "py", backendPath: "D:\\backend", vaultPath: "D:\\vault" }, ["index"]);
  const cancel = buildSiblingInvocation(python, ["cancel", "--reason", "test"]);
  assert.deepEqual(cancel.args.slice(-3), ["cancel", "--reason", "test"]);
  assert.equal(cancel.executable, "py");
});

test("validation checks vault, backend script, executable, and optional config", () => {
  const vault = path.resolve("vault");
  const backend = path.resolve("backend");
  const config = path.resolve("paperbrain.yaml");
  const script = path.join(backend, "script", "paperbrain.py");
  const python = path.resolve("python.exe");
  const existing = new Set([vault, backend, config, script, python]);
  const settings = {
    executionMode: "python-script",
    pythonPath: python,
    cliPath: "",
    backendPath: backend,
    configPath: config,
    vaultPath: vault,
  };
  assert.equal(validateRuntimeSettings(settings, { existsSync: (value) => existing.has(value) }).ok, true);
  const invalid = validateRuntimeSettings({ ...settings, configPath: path.resolve("missing.yaml") }, { existsSync: (value) => existing.has(value) });
  assert.equal(invalid.ok, false);
  assert.match(invalid.errors.join(" "), /config file does not exist/i);
});

test("PATH executable discovery makes CLI validation actionable", () => {
  const bin = path.resolve("bin");
  const executable = path.join(bin, process.platform === "win32" ? "paperbrain.EXE" : "paperbrain");
  assert.equal(findExecutable("paperbrain", {
    env: { PATH: bin, PATHEXT: ".EXE;.CMD" },
    existsSync: (value) => value === executable,
  }), executable);
  const vault = path.resolve("vault");
  const invalid = validateRuntimeSettings({
    executionMode: "cli",
    cliPath: "paperbrain",
    backendPath: "",
    configPath: "",
    vaultPath: vault,
  }, {
    env: { PATH: bin, PATHEXT: ".EXE;.CMD" },
    existsSync: (value) => value === vault,
  });
  assert.equal(invalid.ok, false);
  assert.match(invalid.errors.join(" "), /not found on PATH/i);
});

test("spawn options preserve the environment and pass vault/config contracts", () => {
  const settings = { vaultPath: "D:\\vault", configPath: "config\\paperbrain.yaml" };
  const invocation = { cwd: "D:\\backend" };
  const options = buildSpawnOptions(settings, invocation, { PATH: "bin", KEEP: "yes" });
  assert.equal(options.cwd, "D:\\backend");
  assert.equal(options.windowsHide, true);
  assert.equal(options.env.PATH, "bin");
  assert.equal(options.env.KEEP, "yes");
  assert.equal(options.env.PAPERBRAIN_VAULT_PATH, "D:\\vault");
  assert.equal(options.env.PAPERBRAIN_CONFIG_PATH, path.resolve("D:\\backend", "config\\paperbrain.yaml"));
  const defaults = buildSpawnOptions({ vaultPath: "D:\\vault", configPath: "" }, invocation, {
    PAPERBRAIN_CONFIG_PATH: "stale.yaml",
    PAPERBRAIN_VAULT_PATH: "stale-vault",
  });
  assert.equal(defaults.env.PAPERBRAIN_CONFIG_PATH, undefined);
  assert.equal(defaults.env.PAPERBRAIN_VAULT_PATH, "D:\\vault");
});

test("yesterday uses local calendar components around local midnight", () => {
  assert.equal(yesterday(new Date(2026, 0, 1, 0, 15)), "2025-12-31");
  assert.equal(yesterday(new Date(2026, 6, 22, 23, 59)), "2026-07-21");
});

test("vault relative paths accept vault files and reject traversal", () => {
  const vault = path.resolve("vault");
  const note = path.join(vault, "Research_Notes", "paper.md");
  assert.equal(toVaultRelativePath(note, vault), "Research_Notes/paper.md");
  assert.equal(toVaultRelativePath(path.resolve("outside", "paper.md"), vault), "");
});

test("external links allow only credential-free HTTP(S) URLs", () => {
  assert.equal(safeExternalHttpUrl("https://arxiv.org/abs/2606.00001"), "https://arxiv.org/abs/2606.00001");
  assert.equal(safeExternalHttpUrl("http://example.com/paper"), "http://example.com/paper");
  assert.equal(safeExternalHttpUrl("javascript:alert(1)"), "");
  assert.equal(safeExternalHttpUrl("file:///etc/passwd"), "");
  assert.equal(safeExternalHttpUrl("https://user:secret@example.com/paper"), "");
  assert.equal(safeExternalHttpUrl("not a URL"), "");
});

test("payload parser extracts the final pretty-printed JSON object", () => {
  const stdout = "progress\nmore progress\n{\n  \"ok\": true,\n  \"command\": \"doctor\"\n}\n";
  assert.deepEqual(parsePayload(stdout), { ok: true, command: "doctor" });
  assert.equal(parsePayload("not json"), null);
});

test("process outcome rejects nonzero exits and invalid payloads", () => {
  const nonzero = processOutcome({ code: 7, signal: null, payload: { ok: true }, stderr: "failed" });
  assert.equal(nonzero.ok, false);
  assert.equal(nonzero.reason, "nonzero_exit");
  const invalid = processOutcome({ code: 0, signal: null, payload: null, stderr: "" });
  assert.equal(invalid.ok, false);
  assert.equal(invalid.reason, "invalid_payload");
  const malformed = processOutcome({ code: 0, signal: null, payload: {}, stderr: "" });
  assert.equal(malformed.ok, false);
  assert.equal(malformed.reason, "invalid_payload");
  const success = processOutcome({
    code: 0,
    signal: null,
    payload: { ok: true, command: "doctor", exit_code: 0, backend_version: "0.3.1" },
    stderr: "",
    expectedCommand: "doctor",
  });
  assert.equal(success.ok, true);
});

test("process outcome enforces the backend result contract and compatibility range", () => {
  const valid = { ok: true, command: "run", exit_code: 0, backend_version: "0.3.9" };
  assert.equal(isCompatibleBackendVersion("0.3.1"), true);
  assert.equal(isCompatibleBackendVersion("0.3.99"), true);
  assert.equal(isCompatibleBackendVersion("0.3"), false);
  assert.equal(isCompatibleBackendVersion("0.3.0"), false);
  assert.equal(isCompatibleBackendVersion("0.4.0"), false);
  assert.equal(processOutcome({ code: 0, payload: valid, expectedCommand: "run" }).ok, true);
  assert.equal(processOutcome({ code: 0, payload: { ...valid, command: "doctor" }, expectedCommand: "run" }).reason, "command_mismatch");
  assert.equal(processOutcome({ code: 0, payload: { ...valid, exit_code: "0" }, expectedCommand: "run" }).reason, "invalid_payload");
  assert.equal(processOutcome({ code: 0, payload: { ...valid, backend_version: "0.4.0" }, expectedCommand: "run" }).reason, "incompatible_backend");
  assert.equal(processOutcome({ code: 0, payload: { ok: true, exit_code: 0, backend_version: "0.3.1" }, expectedCommand: "run" }).reason, "invalid_payload");
});

test("diagnostic copies redact credentials and local absolute paths without mutating input", () => {
  const source = {
    api_key: "top-secret",
    message: "Authorization=Bearer abc.def and token=visible",
    artifact: "D:\\Private Vault\\Research_Notes\\Paper.md",
    nested: ["sk-abcdefghijklmnop", "/home/researcher/vault/Paper.md"],
  };
  const redacted = redactDiagnostics(source, ["D:\\Private Vault"]);
  const serialized = JSON.stringify(redacted);
  assert.equal(serialized.includes("top-secret"), false);
  assert.equal(serialized.includes("abc.def"), false);
  assert.equal(serialized.includes("visible"), false);
  assert.equal(serialized.includes("Private Vault"), false);
  assert.equal(serialized.includes("researcher"), false);
  assert.equal(serialized.includes("abcdefghijklmnop"), false);
  assert.equal(source.api_key, "top-secret");
});

test("process failure metadata preserves the backend structured error", () => {
  const payload = {
    ok: false,
    command: "run",
    exit_code: 4,
    error: {
      code: "llm_failure",
      message: "provider unavailable",
      suggestion: "retry later",
      exception: "RuntimeError",
      retryable: true,
    },
  };
  const outcome = processOutcome({ code: 4, signal: null, payload, stderr: "" });
  const merged = mergeFailurePayload(payload, "run", outcome, 4, null);
  assert.deepEqual(merged.error, payload.error);
  assert.equal(merged.process_reason, "nonzero_exit");
  assert.equal(merged.process_exit_code, 4);
  assert.equal(merged.process_signal, "");
});

test("hard-stop guards cannot match a replacement process", () => {
  const first = {};
  const second = {};
  assert.equal(isCurrentProcess(first, 1, first, 1), true);
  assert.equal(isCurrentProcess(second, 2, first, 1), false);
  assert.equal(isCurrentProcess(first, 2, first, 1), false);
});

test("bounded output retains the newest data", () => {
  assert.equal(boundedAppend("12345", "67890", 6), "567890");
});
