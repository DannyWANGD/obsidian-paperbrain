"use strict";

const fs = require("fs");
const path = require("path");

const SETTINGS_VERSION = 2;
const EXECUTION_MODES = new Set(["auto", "cli", "python-script"]);
const MIN_BACKEND_VERSION = [0, 3, 1];
const MAX_BACKEND_VERSION = [0, 4, 0];
const SECRET_FIELD_PATTERN = /(?:api[_-]?key|authorization|password|secret|token)/i;

function textValue(value) {
  return value === undefined || value === null ? "" : String(value).trim();
}

function safeExternalHttpUrl(value) {
  const raw = textValue(value);
  if (!raw) return "";
  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return "";
    if (parsed.username || parsed.password) return "";
    return parsed.href;
  } catch (_) {
    return "";
  }
}

function detectVaultPath(app) {
  const adapter = app && app.vault && app.vault.adapter;
  if (!adapter) return "";
  try {
    if (typeof adapter.getBasePath === "function") {
      return textValue(adapter.getBasePath());
    }
  } catch (_) {
    // Fall through to the public basePath used by desktop file-system adapters.
  }
  return textValue(adapter.basePath);
}

function localDateKey(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function yesterday(now = new Date()) {
  const date = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  date.setDate(date.getDate() - 1);
  return localDateKey(date);
}

function defaultPythonCommand(platform = process.platform) {
  return platform === "win32" ? "python" : "python3";
}

function backendScriptPath(backendPath, pathApi = path) {
  const root = textValue(backendPath);
  return root ? pathApi.join(root, "script", "paperbrain.py") : "";
}

function normalizeRuntimeSettings(raw = {}, options = {}) {
  const existsSync = options.existsSync || fs.existsSync;
  const detectedVaultPath = textValue(options.detectedVaultPath);
  const legacyBackendPath = textValue(raw.repoPath);
  const vaultPath = textValue(raw.vaultPath) || detectedVaultPath;
  let backendPath = textValue(raw.backendPath) || legacyBackendPath;
  if (!backendPath && vaultPath) {
    const candidate = backendScriptPath(vaultPath);
    try {
      if (existsSync(candidate)) backendPath = vaultPath;
    } catch (_) {
      // Validation reports inaccessible paths later.
    }
  }
  const requestedMode = textValue(raw.executionMode);
  return {
    settingsVersion: SETTINGS_VERSION,
    executionMode: EXECUTION_MODES.has(requestedMode) ? requestedMode : "auto",
    cliPath: textValue(raw.cliPath),
    pythonPath: textValue(raw.pythonPath),
    backendPath,
    configPath: textValue(raw.configPath),
    vaultPath,
    provider: textValue(raw.provider) || "openrouter",
    generatePodcast: Boolean(raw.generatePodcast),
    cancelTimeoutSeconds: Math.max(3, Number(raw.cancelTimeoutSeconds) || 20),
    lastPreset: textValue(raw.lastPreset) || "daily",
  };
}

function pathExists(value, existsSync = fs.existsSync) {
  if (!value) return false;
  try {
    return Boolean(existsSync(value));
  } catch (_) {
    return false;
  }
}

function isAbsoluteExecutable(value, pathApi = path) {
  const executable = textValue(value);
  return Boolean(executable) && (pathApi.isAbsolute(executable) || executable.includes("/") || executable.includes("\\"));
}

function findExecutable(executable, options = {}) {
  const value = textValue(executable);
  const pathApi = options.pathApi || path;
  const existsSync = options.existsSync || fs.existsSync;
  const platform = options.platform || process.platform;
  const env = options.env || process.env;
  if (!value) return "";
  if (isAbsoluteExecutable(value, pathApi)) return pathExists(value, existsSync) ? value : "";
  const pathValue = env.PATH || env.Path || env.path || "";
  if (!pathValue) return "";
  const extensions = platform === "win32" && !pathApi.extname(value)
    ? textValue(env.PATHEXT || ".EXE;.CMD;.BAT;.COM").split(";").filter(Boolean)
    : [""];
  for (const directory of pathValue.split(pathApi.delimiter).filter(Boolean)) {
    for (const extension of extensions) {
      const candidate = pathApi.join(directory, `${value}${extension}`);
      if (pathExists(candidate, existsSync)) return candidate;
    }
  }
  return "";
}

function selectExecutionMode(settings, options = {}) {
  const requested = textValue(settings.executionMode) || "auto";
  if (requested === "cli" || requested === "python-script") return requested;
  if (textValue(settings.cliPath)) return "cli";
  const script = backendScriptPath(settings.backendPath, options.pathApi || path);
  return pathExists(script, options.existsSync || fs.existsSync) ? "python-script" : "cli";
}

function buildInvocation(settings, commandArgs, options = {}) {
  const pathApi = options.pathApi || path;
  const mode = options.mode || selectExecutionMode(settings, options);
  const vaultPath = textValue(settings.vaultPath);
  const backendPath = textValue(settings.backendPath);
  const cwd = backendPath || vaultPath;
  if (mode === "python-script") {
    const scriptPath = backendScriptPath(backendPath, pathApi);
    return {
      mode,
      executable: textValue(settings.pythonPath) || defaultPythonCommand(options.platform),
      prefixArgs: [scriptPath],
      args: [scriptPath, ...commandArgs],
      cwd,
      scriptPath,
    };
  }
  return {
    mode: "cli",
    executable: textValue(settings.cliPath) || "paperbrain",
    prefixArgs: [],
    args: [...commandArgs],
    cwd,
    scriptPath: "",
  };
}

function resolveRuntimePath(value, cwd, pathApi = path) {
  const raw = textValue(value);
  if (!raw) return "";
  return pathApi.isAbsolute(raw) ? pathApi.resolve(raw) : pathApi.resolve(cwd || ".", raw);
}

function validateRuntimeSettings(settings, options = {}) {
  const existsSync = options.existsSync || fs.existsSync;
  const pathApi = options.pathApi || path;
  const errors = [];
  const warnings = [];
  const vaultPath = textValue(settings.vaultPath);
  const configPath = textValue(settings.configPath);
  if (!vaultPath) {
    errors.push("Vault path is empty. Reopen the vault or set it in PaperBrain settings.");
  } else if (!pathExists(vaultPath, existsSync)) {
    errors.push(`Vault path does not exist: ${vaultPath}`);
  }
  const invocation = buildInvocation(settings, [], { ...options, existsSync, pathApi });
  if (!invocation.cwd) {
    errors.push("No working directory is available. Configure a backend checkout or vault path.");
  } else if (!pathExists(invocation.cwd, existsSync)) {
    errors.push(`Working directory does not exist: ${invocation.cwd}`);
  }
  const resolvedConfigPath = resolveRuntimePath(configPath, invocation.cwd, pathApi);
  if (resolvedConfigPath && !pathExists(resolvedConfigPath, existsSync)) {
    errors.push(`Backend config file does not exist: ${resolvedConfigPath}`);
  }

  if (invocation.mode === "python-script") {
    if (!textValue(settings.backendPath)) {
      errors.push("Python script mode requires a backend checkout path.");
    }
    if (!invocation.scriptPath || !pathExists(invocation.scriptPath, existsSync)) {
      errors.push(`PaperBrain backend script was not found: ${invocation.scriptPath || "<unset>"}`);
    }
    if (isAbsoluteExecutable(invocation.executable, pathApi) && !pathExists(invocation.executable, existsSync)) {
      errors.push(`Python executable was not found: ${invocation.executable}`);
    } else if (!isAbsoluteExecutable(invocation.executable, pathApi)) {
      const executable = findExecutable(invocation.executable, { ...options, existsSync, pathApi });
      if (!executable) errors.push(`Python executable was not found on PATH: ${invocation.executable}`);
    }
  } else if (isAbsoluteExecutable(invocation.executable, pathApi) && !pathExists(invocation.executable, existsSync)) {
    errors.push(`PaperBrain CLI executable was not found: ${invocation.executable}`);
  } else if (!isAbsoluteExecutable(invocation.executable, pathApi)) {
    const executable = findExecutable(invocation.executable, { ...options, existsSync, pathApi });
    if (!executable) errors.push(`PaperBrain CLI executable was not found on PATH: ${invocation.executable}`);
  }

  return { ok: errors.length === 0, errors, warnings, invocation };
}

function buildSiblingInvocation(invocation, commandArgs) {
  return {
    ...invocation,
    args: [...(invocation.prefixArgs || []), ...commandArgs],
  };
}

function buildSpawnOptions(settings, invocation, baseEnv = process.env) {
  const env = { ...(baseEnv || {}) };
  const vaultPath = textValue(settings.vaultPath);
  if (vaultPath) env.PAPERBRAIN_VAULT_PATH = vaultPath;
  else delete env.PAPERBRAIN_VAULT_PATH;
  const configPath = textValue(settings.configPath);
  if (configPath) env.PAPERBRAIN_CONFIG_PATH = resolveRuntimePath(configPath, invocation.cwd);
  else delete env.PAPERBRAIN_CONFIG_PATH;
  return {
    cwd: invocation.cwd,
    windowsHide: true,
    env,
  };
}

function toVaultRelativePath(value, vaultPath, pathApi = path) {
  const raw = textValue(value);
  const root = textValue(vaultPath);
  if (!raw || !root) return "";
  const absoluteRoot = pathApi.resolve(root);
  const absoluteValue = pathApi.isAbsolute(raw) ? pathApi.resolve(raw) : pathApi.resolve(absoluteRoot, raw);
  const relative = pathApi.relative(absoluteRoot, absoluteValue);
  if (!relative || relative === "." || relative === ".." || relative.startsWith(`..${pathApi.sep}`) || pathApi.isAbsolute(relative)) {
    return "";
  }
  return relative.split(pathApi.sep).join("/");
}

function parsePayload(stdout) {
  const value = textValue(stdout);
  if (!value) return null;
  try {
    return JSON.parse(value);
  } catch (_) {
    // The CLI may print progress before its final, pretty-printed JSON object.
  }
  const openings = [];
  for (let index = 0; index < value.length; index += 1) {
    if (value[index] === "{") openings.push(index);
  }
  for (let index = openings.length - 1; index >= 0; index -= 1) {
    try {
      const candidate = JSON.parse(value.slice(openings[index]));
      if (candidate && typeof candidate === "object" && !Array.isArray(candidate)) return candidate;
    } catch (_) {
      // Try the previous opening brace.
    }
  }
  return null;
}

function lastNonEmptyLine(value) {
  return textValue(value)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .pop() || "";
}

function compareVersions(left, right) {
  for (let index = 0; index < 3; index += 1) {
    if (left[index] !== right[index]) return left[index] - right[index];
  }
  return 0;
}

function isCompatibleBackendVersion(value) {
  const match = textValue(value).match(/^(\d+)\.(\d+)\.(\d+)$/);
  if (!match) return false;
  const version = match.slice(1).map(Number);
  return compareVersions(version, MIN_BACKEND_VERSION) >= 0
    && compareVersions(version, MAX_BACKEND_VERSION) < 0;
}

function redactDiagnosticText(value, sensitivePaths) {
  let result = String(value);
  for (const sensitivePath of sensitivePaths) {
    result = result.split(sensitivePath).join("[REDACTED_PATH]");
  }
  return result
    .replace(/\bBearer\s+[A-Za-z0-9._~+/-]+=*/gi, "Bearer [REDACTED_SECRET]")
    .replace(/\bsk-[A-Za-z0-9_-]{8,}\b/g, "[REDACTED_SECRET]")
    .replace(/((?:api[_-]?key|authorization|password|secret|token)\s*[=:]\s*)([^\s,;]+)/gi, "$1[REDACTED_SECRET]")
    .replace(/[A-Za-z]:[\\/][^\r\n"']+/g, "[REDACTED_PATH]")
    .replace(/\/(?:Users|home)\/[^\r\n"']+/g, "[REDACTED_PATH]");
}

function redactDiagnostics(value, sensitivePaths = []) {
  const paths = [...new Set(sensitivePaths.map(textValue).filter(Boolean))]
    .sort((left, right) => right.length - left.length);
  const visit = (item, key = "") => {
    if (SECRET_FIELD_PATTERN.test(key)) return "[REDACTED_SECRET]";
    if (typeof item === "string") return redactDiagnosticText(item, paths);
    if (Array.isArray(item)) return item.map((entry) => visit(entry));
    if (item && typeof item === "object") {
      return Object.fromEntries(Object.entries(item).map(([entryKey, entry]) => [entryKey, visit(entry, entryKey)]));
    }
    return item;
  };
  return visit(value);
}

function processOutcome({ code, signal, error, payload, stderr, expectedCommand = "" }) {
  const errorMessage = error && error.message;
  const payloadMessage = payload && payload.error && payload.error.message;
  const stderrMessage = lastNonEmptyLine(stderr);
  if (error) {
    return { ok: false, message: `Unable to start PaperBrain: ${errorMessage}`, reason: "spawn_error" };
  }
  if (signal) {
    return { ok: false, message: `PaperBrain stopped by signal ${signal}.`, reason: "signal" };
  }
  if (code !== 0) {
    return {
      ok: false,
      message: payloadMessage || stderrMessage || `PaperBrain exited with code ${code}.`,
      reason: "nonzero_exit",
    };
  }
  if (!payload) {
    return {
      ok: false,
      message: stderrMessage || "PaperBrain exited without a valid JSON result.",
      reason: "invalid_payload",
    };
  }
  if (typeof payload.ok !== "boolean") {
    return {
      ok: false,
      message: "PaperBrain returned JSON without the required boolean `ok` field.",
      reason: "invalid_payload",
    };
  }
  const payloadCommand = textValue(payload.command);
  if (!payloadCommand) {
    return {
      ok: false,
      message: "PaperBrain returned JSON without the required `command` field.",
      reason: "invalid_payload",
    };
  }
  if (textValue(expectedCommand) && payloadCommand !== textValue(expectedCommand)) {
    return {
      ok: false,
      message: `PaperBrain returned command ${payloadCommand}; expected ${textValue(expectedCommand)}.`,
      reason: "command_mismatch",
    };
  }
  if (!Number.isInteger(payload.exit_code)) {
    return {
      ok: false,
      message: "PaperBrain returned JSON without the required integer `exit_code` field.",
      reason: "invalid_payload",
    };
  }
  if (!isCompatibleBackendVersion(payload.backend_version)) {
    return {
      ok: false,
      message: `PaperBrain backend ${textValue(payload.backend_version) || "unknown"} is incompatible; expected >=0.3.1 and <0.4.0.`,
      reason: "incompatible_backend",
    };
  }
  if (payload.ok === false || payload.exit_code !== 0) {
    return {
      ok: false,
      message: payloadMessage || `PaperBrain reported exit code ${payload.exit_code || "failure"}.`,
      reason: "payload_failure",
    };
  }
  return { ok: true, message: `PaperBrain ${payloadCommand} completed.`, reason: "success" };
}

function mergeFailurePayload(payload, command, outcome, code, signal) {
  const base = payload && typeof payload === "object" && !Array.isArray(payload) ? { ...payload } : {};
  const backendError = base.error && typeof base.error === "object" && !Array.isArray(base.error)
    ? { ...base.error }
    : null;
  return {
    ...base,
    ok: false,
    command: base.command || command || "command",
    exit_code: Number.isInteger(base.exit_code) ? base.exit_code : (Number.isInteger(code) ? code : null),
    process_reason: outcome.reason,
    process_exit_code: Number.isInteger(code) ? code : null,
    process_signal: signal || "",
    error: backendError || {
      code: outcome.reason,
      message: outcome.message,
    },
  };
}

function isCurrentProcess(currentProcess, currentToken, expectedProcess, expectedToken) {
  return currentProcess === expectedProcess && currentToken === expectedToken;
}

function boundedAppend(current, incoming, maxLength = 200000) {
  const combined = `${current || ""}${incoming || ""}`;
  return combined.length <= maxLength ? combined : combined.slice(-maxLength);
}

module.exports = {
  SETTINGS_VERSION,
  backendScriptPath,
  boundedAppend,
  buildInvocation,
  buildSiblingInvocation,
  buildSpawnOptions,
  defaultPythonCommand,
  detectVaultPath,
  findExecutable,
  isCompatibleBackendVersion,
  isCurrentProcess,
  localDateKey,
  mergeFailurePayload,
  normalizeRuntimeSettings,
  parsePayload,
  processOutcome,
  redactDiagnostics,
  resolveRuntimePath,
  safeExternalHttpUrl,
  selectExecutionMode,
  toVaultRelativePath,
  validateRuntimeSettings,
  yesterday,
};
