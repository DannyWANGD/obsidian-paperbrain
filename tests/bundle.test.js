"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const Module = require("node:module");
const path = require("node:path");

test("built main.js exports an Obsidian plugin class", () => {
  class ObsidianBase {}
  const originalLoad = Module._load;
  Module._load = function load(request, parent, isMain) {
    if (request === "obsidian") {
      return {
        ItemView: ObsidianBase,
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
    const PluginClass = require(bundlePath);
    assert.equal(typeof PluginClass, "function");
  } finally {
    Module._load = originalLoad;
  }
});
