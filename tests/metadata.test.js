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
  for (const name of ["main.js", "manifest.json", "styles.css", "src/main.js", "src/runtime.js"]) {
    assert.equal(fs.existsSync(path.join(root, name)), true, `${name} should exist`);
  }
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
