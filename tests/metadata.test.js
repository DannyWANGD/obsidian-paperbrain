"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const childProcess = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");

function readJson(name) {
  return JSON.parse(fs.readFileSync(path.join(root, name), "utf8"));
}

test("package, manifest, and compatibility versions stay aligned", () => {
  const packageJson = readJson("package.json");
  const manifest = readJson("manifest.json");
  const versions = readJson("versions.json");
  assert.equal(packageJson.version, manifest.version);
  assert.equal(versions[manifest.version], manifest.minAppVersion);
  assert.match(manifest.version, /^\d+\.\d+\.\d+$/);
  assert.match(manifest.id, /^[a-z][a-z-]*$/);
  assert.equal(manifest.id.includes("obsidian"), false);
  assert.equal(manifest.id.endsWith("plugin"), false);
  assert.equal(manifest.isDesktopOnly, true);
  assert.equal(manifest.author, "DannyWANGD");
  assert.equal(manifest.authorUrl, "https://github.com/DannyWANGD");
});

test("release runtime assets and canonical source files exist", () => {
  for (const name of [
    "main.js", "manifest.json", "styles.css", "src/main.js", "src/runtime.js", "src/process-manager.js",
    "src/backend-installer.js", "src/backend-release.js", "src/miniforge-release.js",
  ]) {
    assert.equal(fs.existsSync(path.join(root, name)), true, `${name} should exist`);
  }
});

test("one-click installer assets are versioned, checksummed, and documented", () => {
  const { BACKEND_RELEASE } = require("../src/backend-release");
  const { MINIFORGE_RELEASE } = require("../src/miniforge-release");
  for (const asset of [
    ...Object.values(BACKEND_RELEASE.assets),
    ...Object.values(MINIFORGE_RELEASE.assets),
  ]) {
    assert.match(asset.sha256, /^[a-f0-9]{64}$/, `${asset.name} needs a fixed SHA-256`);
  }
  const readme = fs.readFileSync(path.join(root, "README.md"), "utf8");
  assert.match(readme, /Install backend/);
  assert.match(readme, /Miniforge 26\.3\.2-2/);
  assert.match(readme, /does not modify\s+(?:the )?system PATH/i);
  assert.match(readme, /~\/\.paperbrain\/runtime\/miniforge3/);
});

test("optional companion plugin snapshot stays versioned and dependency-free", () => {
  const manifest = readJson("manifest.json");
  const companions = readJson(path.join("docs", "companion-plugins.json"));
  assert.equal(companions.paperbrainVersion, manifest.version);
  assert.deepEqual(companions.required, []);
  const ids = companions.testedOptional.map((item) => item.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const id of ["obsidian42-brat", "dataview", "obsidian-audio-player", "smart-connections"]) {
    assert.equal(ids.includes(id), true, `${id} should be documented as optional`);
  }
});

test("release workflow publishes the beta assets as a prerelease", () => {
  const workflow = fs.readFileSync(path.join(root, ".github", "workflows", "release.yml"), "utf8");
  assert.match(workflow, /gh release create/);
  assert.match(workflow, /main\.js manifest\.json styles\.css checksums\.txt/);
  assert.match(workflow, /--prerelease/);
});

test("generated and local-only files stay outside source commits", () => {
  const ignore = fs.readFileSync(path.join(root, ".gitignore"), "utf8").split(/\r?\n/);
  for (const name of ["/main.js", "node_modules/", "data.json"]) {
    assert.equal(ignore.includes(name), true, `${name} should be ignored`);
  }

  const isIgnored = (name) => childProcess.spawnSync(
    "git",
    ["check-ignore", "--no-index", "--quiet", "--", name],
    { cwd: root },
  ).status === 0;
  assert.equal(isIgnored("main.js"), true, "the generated root bundle should be ignored");
  assert.equal(isIgnored("src/main.js"), false, "the canonical plugin source must be tracked");
});
