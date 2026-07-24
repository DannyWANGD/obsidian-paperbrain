"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const Module = require("node:module");
const path = require("node:path");

class ObsidianBase {}
let openedModalDetails = null;

class ModalStub extends ObsidianBase {
  constructor(app) {
    super();
    this.app = app;
  }

  open() {
    openedModalDetails = this.details;
    if (typeof this.resolve === "function") {
      const resolve = this.resolve;
      this.resolve = null;
      resolve(true);
    }
  }

  close() {}
}

function loadPluginClass() {
  const originalLoad = Module._load;
  Module._load = function load(request, parent, isMain) {
    if (request === "obsidian") {
      return {
        ItemView: ObsidianBase,
        Modal: ModalStub,
        Notice: class Notice {},
        Plugin: ObsidianBase,
        PluginSettingTab: ObsidianBase,
        Setting: class Setting {},
        normalizePath: (value) => value,
        setIcon: () => {},
      };
    }
    return originalLoad.call(this, request, parent, isMain);
  };
  try {
    const bundlePath = path.resolve(__dirname, "..", "main.js");
    delete require.cache[bundlePath];
    return require(bundlePath);
  } finally {
    Module._load = originalLoad;
  }
}

test("built main.js exports an Obsidian plugin class", () => {
  assert.equal(typeof loadPluginClass(), "function");
});

test("backend installation passes the resolved automatic dependency source to the installer", async () => {
  const PluginClass = loadPluginClass();
  const plugin = new PluginClass();
  let installPlan = null;
  openedModalDetails = null;
  plugin.app = {};
  plugin.settings = {
    dependencySource: "auto",
    customDependencyIndex: "",
    vaultPath: "/tmp/paperbrain-vault",
  };
  plugin.processManager = { snapshot: () => ({ running: false }) };
  plugin.backendInstaller = {
    snapshot: () => ({ running: false }),
    install: async (plan) => {
      installPlan = plan;
      return { ok: false };
    },
  };
  plugin.detectCondaExecutable = async () => "/tmp/conda";

  await plugin.installBackend();

  assert.equal(openedModalDetails.dependencyIndex.id, "auto");
  assert.ok(installPlan);
  assert.equal(installPlan.dependencyIndex.id, "auto");
  assert.equal(installPlan.dependencyIndex.candidates.length, 4);
});
