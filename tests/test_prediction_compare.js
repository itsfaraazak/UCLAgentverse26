"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

class Element {
  constructor(tag, doc) {
    this.tag = tag; this.ownerDocument = doc; this.children = []; this.listeners = {};
    this.textContent = ""; this.disabled = false; this.attributes = {};
  }
  append(...nodes) { for (const node of nodes) { node.parent = this; this.children.push(node); } }
  replaceChildren(...nodes) { this.children = []; this.append(...nodes); }
  addEventListener(type, callback) { this.listeners[type] = callback; }
  setAttribute(name, value) { this.attributes[name] = value; }
  remove() { this.parent.children = this.parent.children.filter(n => n !== this); }
}
const doc = {createElement: tag => new Element(tag, doc)};
const window = {};
let clock = 0, timerId = 0;
const timers = new Map();
function setTimeoutFake(fn, delay) {
  const id = ++timerId;
  timers.set(id, {fn, at: clock + delay});
  return id;
}
function advance(ms) {
  const end = clock + ms;
  while (true) {
    const next = [...timers.entries()].filter(([, timer]) => timer.at <= end)
      .sort((a, b) => a[1].at - b[1].at)[0];
    if (!next) break;
    clock = next[1].at;
    timers.delete(next[0]);
    next[1].fn();
  }
  clock = end;
}
vm.runInNewContext(fs.readFileSync("web/prediction_compare.js", "utf8"), {
  window, AbortController, setTimeout: setTimeoutFake, clearTimeout: id => timers.delete(id)
});
const all = node => [node, ...node.children.flatMap(all)];
const response = (data, ok = true) => ({ok, json: async () => data});
const tick = () => new Promise(resolve => setImmediate(resolve));
const head = "a".repeat(40), from = "reference", to = "b".repeat(40);
const data = {from: {commit: from, sequence: {sequence: "MA"}}, to: {commit: to, sequence: {sequence: "MV"}}};
const state = () => ({branch: "main", head, from, to, data});
function pdb(second) {
  return `ATOM      1  CA  MET A   1       1.000   2.000   3.000\nATOM      2  CA  ${second} A   2       2.000   2.000   3.000\n`;
}
function good(commit, sequence, file) {
  return {head, commit, sequence, pdb: file, provider: "ESM Metagenomic Atlas", model: "ESMFold"};
}
function setup(initial = state(), options = {}) {
  let current = initial;
  const pending = [], viewers = [], host = new Element("div", doc);
  window.$3Dmol = {createViewer: () => {
    const v = {calls: [], addModel(...a) { this.calls.push(["model", ...a]); },
      setStyle(...a) { this.calls.push(["style", ...a]); }, zoomTo() {}, render() {},
      resize() { this.resized = true; }, rotate() { this.rotated = true; },
      zoom() {}, clear() { this.cleared = true; }};
    viewers.push(v); return v;
  }};
  const api = window.PredictionCompare.mount(host, {...options, getState: () => current,
    fetch: (path, options) => new Promise(resolve => pending.push({path, options, resolve}))});
  const nodes = all(host);
  return {host, api, pending, viewers, setState: s => { current = s; },
    predict: nodes.find(n => n.tag === "button" && n.textContent.startsWith("Send both")),
    status: nodes.find(n => n.attributes.role === "status"),
    sequences: nodes.filter(n => n.tag === "pre"),
    messages: nodes.filter(n => n.tag === "p")};
}
function resolveBoth(ui, offset = 0) {
  ui.pending[offset].resolve(response(good(from, "MA", pdb("ALA"))));
  ui.pending[offset + 1].resolve(response(good(to, "MV", pdb("VAL"))));
}

(async () => {
  const identical = setup({...state(), data: {from: data.from, to: {commit: to, sequence: {sequence: "MA"}}}});
  assert.equal(identical.predict.disabled, true);
  assert.match(identical.status.textContent, /sequences are identical/);
  await identical.predict.listeners.click();
  assert.equal(identical.pending.length, 0);
  const ui = setup();
  assert.equal(ui.pending.length, 0);
  assert.deepEqual(ui.sequences.map(n => n.textContent), ["MA", "MV"]);
  assert.ok(ui.messages.some(n => /both full selected protein sequences.*retention is not verified.*sensitive or patient data/i.test(n.textContent)));
  const run = ui.predict.listeners.click();
  assert.equal(ui.pending.length, 2);
  for (const [i, commit] of [from, to].entries()) {
    assert.equal(ui.pending[i].path, "/api/structure/predict");
    assert.deepEqual(JSON.parse(ui.pending[i].options.body), {branch: "main", expected_head: head, commit, consent: true});
  }
  ui.api.stateChanged();
  assert.equal(ui.pending[0].options.signal.aborted, false);
  resolveBoth(ui); await run;
  assert.equal(ui.viewers.length, 2);
  assert.equal(ui.viewers[0].calls[0][1], pdb("ALA"));
  assert.equal(ui.viewers[1].calls[0][1], pdb("VAL"));
  assert.equal(ui.viewers[0].calls[2][1].resi[0], 2);
  assert.equal(ui.viewers[0].calls[2][2].stick.color, "red");
  assert.equal(ui.viewers[1].calls[2][2].stick.color, "green");
  ui.api.stateChanged(); ui.api.resize();
  assert.equal(ui.viewers[0].resized, true);
  all(ui.host).find(n => n.attributes["aria-label"] === "Rotate From structure").listeners.click();
  assert.equal(ui.viewers[0].rotated, true);
  assert.equal(ui.viewers[1].rotated, undefined);
  assert.deepEqual(data, {from: {commit: from, sequence: {sequence: "MA"}}, to: {commit: to, sequence: {sequence: "MV"}}});
  ui.setState({...state(), head: "c".repeat(40)});
  ui.api.stateChanged();
  assert.equal(ui.viewers[0].cleared, true);
  assert.equal(ui.predict.disabled, false);

  const partial = setup();
  const p = partial.predict.listeners.click();
  assert.equal(partial.status.textContent, "Waiting for prediction…");
  assert.equal(partial.messages.filter(n => n.textContent === "Waiting for prediction…").length, 3);
  partial.pending[0].resolve(response(good(from, "MA", pdb("ALA"))));
  await tick();
  assert.equal(partial.viewers.length, 1);
  assert.equal(partial.messages.filter(n => n.textContent === "Waiting for prediction…").length, 2);
  partial.pending[1].resolve(response({error: "offline"}, false));
  await p;
  assert.equal(partial.viewers.length, 1);
  assert.ok(partial.messages.some(n => /Prediction failed: offline/.test(n.textContent)));
  assert.match(partial.status.textContent, /unavailable/);
  partial.api.stateChanged();
  assert.match(partial.status.textContent, /unavailable/);
  assert.equal(partial.predict.disabled, false);
  assert.equal(partial.predict.textContent, "Retry To");
  const partialRetry = partial.predict.listeners.click();
  assert.equal(partial.pending.length, 3);
  assert.equal(JSON.parse(partial.pending[2].options.body).commit, to);
  assert.equal(partial.viewers[0].cleared, undefined);
  partial.pending[2].resolve(response(good(to, "MV", pdb("VAL"))));
  await partialRetry;
  assert.equal(partial.viewers.length, 2);
  assert.equal(partial.predict.disabled, true);

  const timedOut = setup();
  const timeoutJob = timedOut.predict.listeners.click();
  timedOut.pending[0].resolve({...response({error: "Prediction provider timed out."}, false), status: 504});
  timedOut.pending[1].resolve({...response({error: "Prediction provider timed out."}, false), status: 504});
  await timeoutJob;
  assert.equal(timedOut.viewers.length, 0);
  assert.ok(timedOut.messages.every(n => !/Prediction loaded/.test(n.textContent)));
  assert.equal(timedOut.messages.filter(n => /may still be running.*additional charges/.test(n.textContent)).length, 2);

  for (const bad of [
    {...good(from, "MA", pdb("ALA")), commit: to},
    {...good(from, "MA", pdb("ALA")), head: "wrong"},
    {...good(from, "MA", pdb("ALA")), sequence: "MV"},
    good(from, "MA", pdb("VAL")),
    good(from, "MA", pdb("ALA").replace("A   2", "A   3"))
  ]) {
    const x = setup(), job = x.predict.listeners.click();
    x.pending[0].resolve(response(bad));
    x.pending[1].resolve(response(good(to, "MV", pdb("VAL"))));
    await job;
    assert.equal(x.viewers.length, 1);
    assert.ok(x.messages.some(n => /Prediction failed/.test(n.textContent)));
  }
  const late = setup({...state(), data: null});
  assert.equal(late.predict.disabled, true);
  late.setState(state()); late.api.stateChanged();
  assert.equal(late.predict.disabled, false);
  const job = late.predict.listeners.click();
  late.setState({...state(), to: "new", data: null}); late.api.stateChanged();
  assert.equal(late.pending[0].options.signal.aborted, true);
  resolveBoth(late); await job;
  assert.equal(late.viewers.length, 0);
  assert.equal(late.predict.disabled, true);

  const unavailable = setup();
  delete window.$3Dmol;
  const no3d = unavailable.predict.listeners.click();
  resolveBoth(unavailable); await no3d;
  assert.ok(unavailable.messages.some(n => /WebGL and 3Dmol/.test(n.textContent)));
  window.$3Dmol = {createViewer: () => ({
    addModel() {}, setStyle() {}, zoomTo() {}, render() {}, clear() {}
  })};
  await unavailable.predict.listeners.click();
  assert.equal(unavailable.pending.length, 2);
  assert.match(unavailable.status.textContent, /Both predictions loaded/);
  const destroyed = setup();
  const inFlight = destroyed.predict.listeners.click();
  destroyed.api.destroy();
  resolveBoth(destroyed); await inFlight; await tick();
  assert.equal(destroyed.host.children.length, 0);
  assert.equal(destroyed.viewers.length, 0);

  const automatic = setup({...state(), data: null, active: false}, {automatic: true, provider: "Modal"});
  assert.equal(automatic.pending.length, 0);
  assert.ok(automatic.messages.some(n => /Automatic mode sends both full selected protein sequences to Modal.*charges.*does not cancel/i.test(n.textContent)));
  assert.ok(automatic.messages.some(n => /not reliable evidence of a mutation effect/i.test(n.textContent)));
  for (const invalid of [
    {...state(), branch: ""}, {...state(), head: ""}, {...state(), from: ""},
    {...state(), to: ""}, {...state(), data: null},
    {...state(), data: {...data, to: {...data.to, commit: "wrong"}}},
    {...state(), data: {...data, to: {...data.to, sequence: {sequence: "M?"}}}},
    {...state(), data: {...data, to: {...data.to, sequence: {sequence: "M"}}}},
    {...state(), data: {...data, to: {...data.to, sequence: {sequence: "MA"}}}}
  ]) {
    automatic.setState(invalid); automatic.api.stateChanged();
    assert.equal(automatic.pending.length, 0);
  }
  automatic.setState({...state(), active: false}); automatic.api.stateChanged();
  assert.equal(automatic.pending.length, 0);
  automatic.setState({...state(), active: true}); automatic.api.stateChanged();
  assert.equal(automatic.pending.length, 0);
  advance(600);
  assert.equal(automatic.pending.length, 2);
  automatic.api.stateChanged();
  automatic.setState({...state(), active: false}); automatic.api.stateChanged();
  automatic.setState({...state(), active: true}); automatic.api.stateChanged();
  assert.equal(automatic.pending.length, 2);
  automatic.pending[0].resolve(response({error: "offline"}, false));
  automatic.pending[1].resolve(response({error: "offline"}, false));
  await tick();
  assert.match(automatic.status.textContent, /unavailable/);
  assert.equal(automatic.messages.filter(n => /Prediction failed: offline/.test(n.textContent)).length, 2);
  automatic.api.stateChanged();
  automatic.setState({...state(), active: false}); automatic.api.stateChanged();
  automatic.setState({...state(), active: true}); automatic.api.stateChanged();
  assert.equal(automatic.pending.length, 2);
  assert.match(automatic.status.textContent, /unavailable/);
  const retry = automatic.predict.listeners.click();
  assert.equal(automatic.pending.length, 4);
  automatic.pending[2].resolve(response({error: "offline"}, false));
  automatic.pending[3].resolve(response({error: "offline"}, false));
  await retry;
  automatic.api.stateChanged();
  assert.equal(automatic.pending.length, 4);

  const successful = setup(state(), {automatic: true, provider: "Modal"});
  advance(600);
  successful.pending[0].resolve(response({...good(from, "MA", pdb("ALA")), provider: "Modal"}));
  successful.pending[1].resolve(response({...good(to, "MV", pdb("VAL")), provider: "Modal"}));
  await tick();
  assert.equal(successful.viewers.length, 2);
  assert.match(successful.status.textContent, /Both predictions loaded/);
  successful.setState({...state(), active: false}); successful.api.stateChanged();
  successful.setState({...state(), active: true}); successful.api.stateChanged();
  assert.equal(successful.pending.length, 2);
  assert.match(successful.status.textContent, /Both predictions loaded/);

  const modalPartial = setup(state(), {automatic: true, provider: "Modal"});
  advance(600);
  assert.equal(modalPartial.messages.filter(n => n.textContent === "Waiting for prediction…").length, 3);
  modalPartial.pending[1].resolve(response({...good(to, "MV", pdb("VAL")), provider: "Modal"}));
  modalPartial.pending[0].resolve({...response({error: "Capacity busy. Try again later."}, false), status: 503});
  await tick();
  assert.equal(modalPartial.predict.textContent, "Retry From");
  assert.ok(modalPartial.messages.some(n => /Capacity busy. Try again later/.test(n.textContent)));
  modalPartial.api.stateChanged();
  assert.equal(modalPartial.pending.length, 2);
  const modalRetry = modalPartial.predict.listeners.click();
  assert.equal(modalPartial.pending.length, 3);
  assert.equal(JSON.parse(modalPartial.pending[2].options.body).commit, from);
  modalPartial.setState({...state(), head: "c".repeat(40), active: false});
  modalPartial.api.stateChanged();
  assert.equal(modalPartial.pending[2].options.signal.aborted, true);
  modalPartial.pending[2].resolve(response({...good(from, "MA", pdb("ALA")), provider: "Modal"}));
  await modalRetry;
  assert.equal(modalPartial.viewers.length, 1);
  assert.equal(modalPartial.viewers[0].cleared, true);

  const changing = setup(state(), {automatic: true});
  advance(600);
  assert.equal(changing.pending.length, 2); // Missing active defaults to active.
  changing.setState({...state(), head: "c".repeat(40)}); changing.api.stateChanged();
  assert.equal(changing.pending[0].options.signal.aborted, true);
  advance(600);
  assert.equal(changing.pending.length, 4);
  resolveBoth(changing); await tick();
  assert.equal(changing.viewers.length, 0);
  changing.pending[2].resolve(response({error: "new failure"}, false));
  changing.pending[3].resolve(response({error: "new failure"}, false));
  await tick();
  changing.setState(state()); changing.api.stateChanged();
  assert.equal(changing.pending.length, 4); // Previously attempted state is not retried.
  const changedData = {...data, to: {...data.to, sequence: {sequence: "MC"}}};
  changing.setState({...state(), data: changedData}); changing.api.stateChanged();
  advance(600);
  assert.equal(changing.pending.length, 4); // Same identity stays suppressed despite changed data.
  changing.api.destroy();

  const hiddenManual = setup({...state(), active: false}, {automatic: true});
  const manualJob = hiddenManual.predict.listeners.click();
  assert.equal(hiddenManual.pending.length, 2);
  hiddenManual.setState({...state(), active: true}); hiddenManual.api.stateChanged();
  resolveBoth(hiddenManual); await manualJob;
  hiddenManual.api.stateChanged();
  assert.equal(hiddenManual.pending.length, 2);

  const paused = setup({...state(), data: null}, {automatic: true});
  const pause = all(paused.host).find(n => n.textContent === "Pause automatic prediction");
  assert.equal(pause.attributes["aria-pressed"], "false");
  pause.listeners.click();
  assert.equal(pause.textContent, "Resume automatic prediction");
  assert.equal(pause.attributes["aria-pressed"], "true");
  paused.setState(state()); paused.api.stateChanged();
  assert.equal(paused.pending.length, 0);
  pause.listeners.click();
  advance(600);
  assert.equal(paused.pending.length, 2);
  pause.listeners.click();
  assert.equal(paused.pending[0].options.signal.aborted, false);
  pause.listeners.click();
  assert.equal(paused.pending.length, 2);
  paused.pending[0].resolve(response({error: "offline"}, false));
  paused.pending[1].resolve(response({error: "offline"}, false));
  await tick();
  pause.listeners.click(); pause.listeners.click();
  assert.equal(paused.pending.length, 2);
  const pausedRetry = paused.predict.listeners.click();
  assert.equal(paused.pending.length, 4);
  paused.pending[2].resolve(response({error: "offline"}, false));
  paused.pending[3].resolve(response({error: "offline"}, false));
  await pausedRetry;

  const pausedHidden = setup({...state(), data: null, active: false}, {automatic: true});
  const hiddenPause = all(pausedHidden.host).find(n => n.textContent === "Pause automatic prediction");
  hiddenPause.listeners.click();
  pausedHidden.setState({...state(), active: false}); pausedHidden.api.stateChanged();
  hiddenPause.listeners.click();
  assert.equal(pausedHidden.pending.length, 0);
  pausedHidden.setState({...state(), active: true}); pausedHidden.api.stateChanged();
  advance(600);
  assert.equal(pausedHidden.pending.length, 2);
  pausedHidden.api.destroy();
  assert.ok(!all(ui.host).some(n => /automatic prediction$/.test(n.textContent)));

  const debounce = setup(state(), {automatic: true, provider: "Modal"});
  advance(400);
  debounce.setState({...state(), head: "d".repeat(40)}); debounce.api.stateChanged();
  advance(599);
  assert.equal(debounce.pending.length, 0);
  debounce.api.stateChanged(); // Unchanged updates do not restart the timer.
  advance(1);
  assert.equal(debounce.pending.length, 2);
  assert.equal(JSON.parse(debounce.pending[0].options.body).expected_head, "d".repeat(40));
  debounce.api.destroy();

  const gated = setup(state(), {automatic: true});
  const gatedPause = all(gated.host).find(n => n.textContent === "Pause automatic prediction");
  advance(300);
  gatedPause.listeners.click();
  advance(600);
  assert.equal(gated.pending.length, 0);
  gatedPause.listeners.click();
  gated.setState({...state(), active: false}); gated.api.stateChanged();
  advance(600);
  assert.equal(gated.pending.length, 0);
  gated.setState(state()); gated.api.stateChanged();
  advance(300);
  const immediate = gated.predict.listeners.click();
  assert.equal(gated.pending.length, 2);
  advance(600);
  assert.equal(gated.pending.length, 2);
  resolveBoth(gated); await immediate;
  gated.api.destroy();

  const staleTimer = setup(state(), {automatic: true});
  staleTimer.setState({...state(), data: {...data, to: {...data.to, sequence: {sequence: "MC"}}}});
  advance(600); // No stateChanged notification: the callback must still fail closed.
  assert.equal(staleTimer.pending.length, 0);
  staleTimer.api.destroy();

  const bounded = setup(state(), {automatic: true});
  for (let i = 0; i < 101; i++) {
    bounded.setState({...state(), head: `head-${i}`});
    bounded.api.stateChanged();
    bounded.predict.listeners.click();
  }
  bounded.setState({...state(), head: "head-0"});
  bounded.api.stateChanged();
  advance(600);
  assert.equal(bounded.pending.length, 204); // Oldest attempt was evicted.
  bounded.api.destroy();
  console.log("prediction compare tests passed");
})().catch(error => { console.error(error); process.exitCode = 1; });
