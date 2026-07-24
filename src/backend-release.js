"use strict";

const BACKEND_RELEASE = Object.freeze({
  repository: "DannyWANGD/PaperBrain",
  version: "0.3.5",
  tag: "backend-0.3.5",
  dependencyProbe: Object.freeze({
    requirement: "openai==2.46.0",
    sha256: "672381db55efb3a1e2610f29304c130cccdd0b319bace4d492b2443cb64c1e7c",
  }),
  assets: Object.freeze({
    wheel: Object.freeze({
      name: "paperbrain-0.3.5-py3-none-any.whl",
      sha256: "44e4e10fcd2fb85f6a8f2c5f92fa1149762847fe6c00687c2cb04008810f3cbb",
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
