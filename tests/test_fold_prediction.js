"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

class Element {
  constructor(tag, doc) { this.tag = tag; this.ownerDocument = doc; this.children = []; this.listeners = {}; this.textContent = ""; this.hidden = false; this.disabled = false; }
  append(...nodes) { for (const node of nodes) { node.parent = this; this.children.push(node); } }
  replaceChildren(...nodes) { this.children = []; this.append(...nodes); }
  addEventListener(type, callback) { this.listeners[type] = callback; }
  setAttribute() {}
  remove() { this.parent.children = this.parent.children.filter(child => child !== this); }
}
const doc = {createElement: tag => new Element(tag, doc)};
const window = {};
vm.runInNewContext(fs.readFileSync("web/fold_prediction.js", "utf8"), {window, AbortController, encodeURIComponent});
const all = node => [node, ...node.children.flatMap(all)];
const response = (data, ok = true) => ({ok, json: async () => data});
const tick = () => new Promise(resolve => setImmediate(resolve));
const head = "a".repeat(40), other = "b".repeat(40);
const pdb = "ATOM      1  CA  MET A   1       1.000   2.000   3.000\n";
function setup(options = {}) {
  let state = options.state || {branch: "main", head};
  const pending = [], viewers = [], host = new Element("div", doc);
  const fallback = new Element("p", doc);
  fallback.textContent = "Structure prediction is unavailable.";
  host.append(fallback);
  window.$3Dmol = {createViewer: () => {
    const viewer = {calls: [], addModel(...args) { this.calls.push(args); }, setStyle() {}, zoomTo() {}, render() {}, resize() {}, rotate() {}, zoom() {}, clear() { this.cleared = true; }};
    viewers.push(viewer); return viewer;
  }};
  const instance = window.FoldPrediction.mount(host, {...options, getState: () => state, fetch: (path, options) => new Promise(resolve => pending.push({path, options, resolve}))});
  assert.equal(host.children.includes(fallback), false);
  const nodes = all(host);
  return {host, instance, pending, viewers, setState: value => { state = value; },
    sequence: nodes.find(x => x.tag === "pre"), status: nodes.find(x => x.textContent === "Select a saved branch and commit." || x.textContent === "Loading saved sequence…"),
    predict: nodes.find(x => x.textContent === "Predict with ESMFold"),
    result: nodes.find(x => x.tag === "section" && x.hidden)};
}
const good = {head, sequence: "MVH", pdb, provider: "ESM Metagenomic Atlas", model: "ESMFold"};

(async () => {
  const ui = setup();
  assert.equal(all(ui.host).some(x => x.textContent === "Pause automatic prediction"), false);
  assert.equal(ui.pending.length, 1);
  assert.equal(ui.pending[0].path, "/api/sequence?branch=main");
  assert.equal(ui.predict.disabled, true);
  ui.pending[0].resolve(response({head, sequence: "MVH"})); await tick();
  assert.equal(ui.sequence.textContent, "MVH");
  assert.equal(ui.predict.disabled, false);
  const request = ui.predict.listeners.click();
  assert.equal(ui.pending.length, 2);
  assert.deepEqual(JSON.parse(ui.pending[1].options.body), {branch: "main", expected_head: head, consent: true});
  ui.instance.stateChanged();
  assert.equal(ui.pending.length, 2);
  ui.pending[1].resolve(response(good)); await request;
  assert.equal(ui.result.hidden, false);
  assert.equal(ui.viewers[0].calls[0][0], pdb);
  assert.ok(all(ui.host).some(x => x.textContent.includes(head) && x.textContent.includes("ESMFold")));
  ui.instance.stateChanged();
  assert.equal(ui.result.hidden, false);
  ui.setState({branch: "main", head: other}); ui.instance.stateChanged();
  assert.equal(ui.result.hidden, true);
  assert.equal(ui.viewers[0].cleared, true);
  assert.equal(ui.sequence.textContent, "");
  ui.pending[2].resolve(response({head: other, sequence: "MVA"})); await tick();
  const stale = ui.predict.listeners.click();
  ui.setState({branch: "other", head}); ui.instance.stateChanged();
  ui.pending[3].resolve(response({...good, head: other, sequence: "MVA"})); await stale;
  assert.equal(ui.result.hidden, true);
  ui.pending[4].resolve(response({head, sequence: "MVH"})); await tick();
  const mismatch = ui.predict.listeners.click();
  ui.pending[5].resolve(response({...good, sequence: "MVA"})); await mismatch;
  assert.match(ui.status.textContent, /does not match/);
  assert.equal(ui.result.hidden, true);
  const failure = ui.predict.listeners.click();
  ui.pending[6].resolve(response({error: "Provider unavailable"}, false)); await failure;
  assert.match(ui.status.textContent, /Provider unavailable/);
  window.$3Dmol.createViewer = () => { throw new Error("WebGL"); };
  const noWebgl = ui.predict.listeners.click();
  ui.pending[7].resolve(response(good)); await noWebgl;
  assert.match(ui.status.textContent, /WebGL/);
  ui.instance.destroy();
  assert.equal(ui.host.children.length, 0);

  const racing = setup();
  racing.setState({branch: "new", head: other}); racing.instance.stateChanged();
  racing.pending[0].resolve(response({head, sequence: "OLD"})); await tick();
  assert.equal(racing.sequence.textContent, "");
  racing.pending[1].resolve(response({head: other, sequence: "MVA"})); await tick();
  assert.equal(racing.sequence.textContent, "MVA");
  const abandoned = racing.predict.listeners.click();
  racing.instance.destroy();
  racing.pending[2].resolve(response({...good, head: other, sequence: "MVA"})); await abandoned;
  assert.equal(racing.host.children.length, 0);

  const badHead = setup();
  badHead.pending[0].resolve(response({head: other, sequence: "MVH"})); await tick();
  assert.equal(badHead.predict.disabled, true);
  assert.match(badHead.status.textContent, /does not match/);

  const auto = setup({automatic: true, provider: "Modal", state: {branch: "main", head, active: false}});
  const notice = all(auto.host).find(x => x.className === "fold-privacy").textContent;
  assert.match(notice, /Automatic prediction is enabled/);
  assert.match(notice, /Modal/);
  assert.match(notice, /charges/);
  assert.match(notice, /patient/);
  assert.match(notice, /cannot be cancelled/);
  auto.pending[0].resolve(response({head, sequence: "MVH"})); await tick();
  assert.equal(auto.pending.length, 1);
  auto.setState({branch: "main", head, active: true}); auto.instance.stateChanged();
  assert.equal(auto.pending.length, 2);
  assert.deepEqual(JSON.parse(auto.pending[1].options.body), {branch: "main", expected_head: head, consent: true});
  auto.instance.stateChanged();
  auto.setState({branch: "main", head, active: false}); auto.instance.stateChanged();
  auto.setState({branch: "main", head, active: true}); auto.instance.stateChanged();
  assert.equal(auto.pending.length, 2);
  auto.setState({branch: "main", head: other}); auto.instance.stateChanged();
  auto.pending[2].resolve(response({head: other, sequence: "MVA"})); await tick();
  assert.equal(auto.pending.length, 4);
  auto.setState({branch: "main", head}); auto.instance.stateChanged();
  auto.pending[4].resolve(response({head, sequence: "MVH"})); await tick();
  assert.equal(auto.pending.length, 5);
  assert.equal(auto.predict.disabled, true);
  auto.pending[3].resolve(response({...good, head: other, sequence: "MVA", provider: "Modal"})); await tick();
  assert.equal(auto.result.hidden, true);
  auto.pending[1].resolve(response({...good, provider: "Modal"})); await tick();
  assert.equal(auto.result.hidden, true);
  assert.equal(auto.predict.disabled, false);
  const retry = auto.predict.listeners.click();
  assert.equal(auto.pending.length, 6);
  auto.pending[5].resolve(response({error: "Modal unavailable"}, false)); await retry;
  assert.match(auto.status.textContent, /Modal unavailable/);
  auto.instance.stateChanged();
  auto.setState({branch: "main", head, active: false}); auto.instance.stateChanged();
  auto.setState({branch: "main", head, active: true}); auto.instance.stateChanged();
  assert.equal(auto.pending.length, 6);
  assert.match(auto.status.textContent, /Modal unavailable/);
  const secondRetry = auto.predict.listeners.click();
  auto.setState({branch: null, head: null}); auto.instance.stateChanged();
  auto.pending[6].resolve(response({...good, provider: "Modal"})); await secondRetry;
  assert.equal(auto.result.hidden, true);
  assert.equal(auto.sequence.textContent, "");

  const completed = setup({automatic: true, provider: "Modal"});
  completed.pending[0].resolve(response({head, sequence: "MVH"})); await tick();
  completed.pending[1].resolve(response({...good, provider: "Modal"})); await tick();
  assert.equal(completed.result.hidden, false);
  completed.setState({branch: "main", head, active: false}); completed.instance.stateChanged();
  completed.setState({branch: "main", head, active: true}); completed.instance.stateChanged();
  assert.equal(completed.pending.length, 2);
  assert.equal(completed.result.hidden, false);
  completed.setState({branch: "new", head: other}); completed.instance.stateChanged();
  completed.pending[2].resolve(response({head: other, sequence: "MVA"})); await tick();
  completed.pending[3].resolve(response({error: "Automatic failure"}, false)); await tick();
  completed.instance.stateChanged();
  assert.equal(completed.pending.length, 4);
  assert.match(completed.status.textContent, /Automatic failure/);
  assert.equal(completed.predict.disabled, false);

  const staleLoad = setup({automatic: true, provider: "Modal"});
  staleLoad.setState({branch: "new", head: other}); staleLoad.instance.stateChanged();
  staleLoad.pending[0].resolve(response({head, sequence: "MVH"})); await tick();
  assert.equal(staleLoad.pending.length, 2);
  staleLoad.pending[1].resolve(response({head: other, sequence: "MVA"})); await tick();
  assert.equal(staleLoad.pending.length, 3);
  assert.equal(JSON.parse(staleLoad.pending[2].options.body).expected_head, other);

  const paused = setup({automatic: true, provider: "Modal"});
  const pause = all(paused.host).find(x => x.textContent === "Pause automatic prediction");
  pause.listeners.click();
  assert.equal(pause.textContent, "Resume automatic prediction");
  paused.pending[0].resolve(response({head, sequence: "MVH"})); await tick();
  assert.equal(paused.pending.length, 1);
  pause.listeners.click();
  assert.equal(pause.textContent, "Pause automatic prediction");
  assert.equal(paused.pending.length, 2);
  pause.listeners.click();
  pause.listeners.click();
  assert.equal(paused.pending.length, 2);
  paused.pending[1].resolve(response({error: "Failed"}, false)); await tick();
  pause.listeners.click();
  pause.listeners.click();
  assert.equal(paused.pending.length, 2);
  assert.match(paused.status.textContent, /Failed/);
  pause.listeners.click();
  paused.setState({branch: "new", head: other}); paused.instance.stateChanged();
  paused.pending[2].resolve(response({head: other, sequence: "MVA"})); await tick();
  assert.equal(paused.pending.length, 3);
  const manualWhilePaused = paused.predict.listeners.click();
  assert.equal(paused.pending.length, 4);
  paused.pending[3].resolve(response({error: "Manual failure"}, false)); await manualWhilePaused;
  pause.listeners.click();
  assert.equal(paused.pending.length, 4);

  const invalidAuto = setup({automatic: true, provider: "Modal"});
  invalidAuto.pending[0].resolve(response({head, sequence: "invalid"})); await tick();
  invalidAuto.instance.stateChanged();
  assert.equal(invalidAuto.pending.length, 1);
  assert.match(invalidAuto.status.textContent, /Could not load/);
  assert.throws(() => setup({automatic: true}), /requires Modal/);

  const reference = setup({state: {branch: "main", head: null}});
  assert.match(all(reference.host).map(node => node.textContent).join("\n"), /Reference sequence/);
  assert.equal(reference.pending[0].path, "/api/sequence?branch=main");
  reference.pending[0].resolve(response({head: null, sequence: "MVH"})); await tick();
  assert.equal(reference.sequence.textContent, "MVH");
  assert.equal(reference.predict.disabled, false);
  const referenceRequest = reference.predict.listeners.click();
  assert.deepEqual(JSON.parse(reference.pending[1].options.body), {branch: "main", expected_head: null, consent: true});
  reference.pending[1].resolve(response({...good, head: null, commit: "reference"})); await referenceRequest;
  assert.equal(reference.result.hidden, false);
  console.log("fold prediction tests passed");
})().catch(error => { console.error(error); process.exitCode = 1; });
