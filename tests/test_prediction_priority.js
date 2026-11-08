"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const html = fs.readFileSync("web/index.html", "utf8");
const workspace = html.slice(html.indexOf('<section id="workspace"'), html.indexOf('<section id="history-view"'));
assert.ok(workspace.indexOf('id="fold-prediction"') < workspace.indexOf('id="molecule-view"'),
  "Edited-sequence prediction must precede the experimental reference viewer.");
assert.match(workspace, /<details class="panel structure-panel" id="reference-structure">/);
const history = html.slice(html.indexOf('<section id="history-view"'));
assert.ok(history.indexOf('id="prediction-compare"') < history.indexOf('id="diff-molecule-view"'),
  "Predicted models must precede the reference-only annotations.");
console.log("Prediction views precede reference context");
