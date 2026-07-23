"use strict";

const BACKEND_RELEASE = Object.freeze({
  repository: "DannyWANGD/PaperBrain",
  version: "0.3.4",
  tag: "backend-0.3.4",
  assets: Object.freeze({
    wheel: Object.freeze({
      name: "paperbrain-0.3.4-py3-none-any.whl",
      sha256: "9dc7c435f62c6930e07df8b0219c73d5a2e5149b13cf2b7495a5c2af5280eb38",
    }),
    requirements: Object.freeze({
      name: "requirements.lock",
      sha256: "2a7394540a7552cd1bbbb88e9c440ae3c493e25e5d30a7c8300281831d30de7c",
    }),
  }),
});

function backendAssetUrl(asset, release = BACKEND_RELEASE) {
  return `https://github.com/${release.repository}/releases/download/${release.tag}/${asset.name}`;
}

module.exports = { BACKEND_RELEASE, backendAssetUrl };
