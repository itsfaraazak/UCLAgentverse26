"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const elements = new Map(), listeners = {}, pending = [], calls = [], rendered = [];
let created = false, mergeNoteConflict = false;
function makeElement() {
  return {value: "", textContent: "", hidden: false, disabled: false, children: [], listeners: {},
    classList: {toggle() {}}, addEventListener(name, fn) { this.listeners[name] = fn; },
    setAttribute() {}, removeAttribute() {}, replaceChildren(...nodes) { this.children = nodes; },
    append(...nodes) { this.children.push(...nodes); }, querySelector() { return this.button ||= makeElement(); }};
}
const document = {
  getElementById(id) { if (!elements.has(id)) elements.set(id, makeElement()); return elements.get(id); },
  createElement: makeElement, createTextNode: text => ({textContent: text}), querySelectorAll: () => []
};
const get = id => document.getElementById(id);
const a = "a".repeat(40), b = "b".repeat(40);
const seq = head => ({head, sequence: "E", reference: {sequence: "E", accession: "P68871", source_url: "/"}, substitutions: []});
const history = head => ({head, history: [{commit: head, message: "Change", timestamp: "today"}]});
const response = data => ({ok: true, json: async () => data});
const fetch = (path, options) => {
  calls.push({path, options});
  if (path === "/api/branches" && options.method === "POST") {
    created = true;
    return Promise.resolve(response({}));
  }
  if (path === "/api/branches") return Promise.resolve(response({branches: [
    {name: "main", head: a}, {name: "other", head: b}, ...(created ? [{name: "new", head: a}] : [])
  ]}));
  if (path.startsWith("/api/sequence/merge/preview?")) return Promise.resolve(response({
    base: a, target: a, source: b, merged_substitutions: [{position: 1, reference: "E", alternate: "V"}],
    conflicts: [], notes_conflict: mergeNoteConflict
  }));
  if (path === "/api/sequence/merge") return Promise.resolve(response({...seq(a), status: "merged"}));
  if (path.startsWith("/api/compare?")) return new Promise(resolve => pending.push(resolve));
  if (options.method === "POST") return Promise.resolve(response(seq(a)));
  if (path.endsWith("branch=new")) return Promise.resolve({ok: false, json: async () => ({error: "load failed"})});
  const head = path.endsWith("other") ? b : a;
  if (path.startsWith("/api/sequence?")) return Promise.resolve(response(seq(head)));
  if (path.startsWith("/api/notes?")) return Promise.resolve(response(history(head)));
  throw Error(path);
};
let mounted, branchChanges = 0;
const window = {
  addEventListener(name, fn) { listeners[name] = fn; }, dispatchEvent() {},
  AgentWorkspace: {mount(node, options) { mounted = options; return {branchChanged() { branchChanges++; }}; }},
  SequenceDiff: {render(node, data) { rendered.push(data); }}
};
class CustomEvent { constructor(type, options) { this.type = type; this.detail = options.detail; } }
const tick = () => new Promise(resolve => setImmediate(resolve));
const result = (from, to, changes) => ({
  from: {commit: from, sequence: seq(a)}, to: {commit: to, sequence: seq(a)},
  sequence: {diff: "", changes}, notes: {diff: "note patch"}
});
(async () => {
  vm.runInNewContext(fs.readFileSync("web/app.js", "utf8"), {document, window, fetch, CustomEvent});
  await tick();
  assert.equal(mounted.getBranch(), "main");
  get("residue-position").value = "1";
  get("replacement").value = "V";
  get("commit-message").value = "Propose variant";
  get("branch-select").value = "other";
  get("branch-select").listeners.change();
  await tick();
  assert.equal(branchChanges, 1);
  assert.equal(get("residue-position").value, "");
  get("branch-select").value = "main";
  get("branch-select").listeners.change();
  await tick();
  assert.equal(get("commit-message").value, "Propose variant");
  await get("substitution-form").listeners.submit({preventDefault() {}});
  const post = calls.find(call => call.path === "/api/sequence" && call.options.method === "POST");
  const body = JSON.parse(post.options.body);
  assert.equal(body.branch, "main");
  assert.equal(body.expected_head, a);
  assert.equal(body.message, "Propose variant");
  get("compare-from").value = "reference";
  get("compare-to").value = a;
  get("compare-to").listeners.change();
  get("compare-to").value = b;
  get("compare-to").listeners.change();
  assert.match(calls.at(-1).path, /branch=main$/);
  pending[1](response(result("reference", b, [{position: 1, old: "E", new: "V"}])));
  await tick();
  pending[0](response(result("reference", a, [])));
  await tick();
  assert.equal(window.hbbComparison.getState().to, b);
  assert.equal(rendered.length, 1);
  assert.equal(get("comparison-changes").children[0].children[1].textContent, "− E");
  assert.equal(get("comparison-changes").children[0].children[2].textContent, "+ V");
  assert.match(get("diff").textContent, /no research note/);
  get("merge-source").value = "other";
  mergeNoteConflict = true;
  await get("merge-preview").listeners.click();
  assert.equal(get("merge-commit").disabled, true);
  assert.match(get("merge-details").children[0].textContent, /historical note/);
  mergeNoteConflict = false;
  await get("merge-preview").listeners.click();
  assert.equal(get("merge-commit").disabled, false);
  assert.match(get("merge-details").children[0].textContent, /E1V/);
  get("merge-message").value = "Combine changes";
  await get("merge-commit").listeners.click();
  const merge = JSON.parse(calls.find(call => call.path === "/api/sequence/merge").options.body);
  assert.equal(merge.target_branch, "main");
  assert.equal(merge.source_branch, "other");
  assert.equal(merge.expected_target_head, a);
  assert.equal(merge.expected_source_head, b);
  assert.equal(merge.confirmed, true);
  get("residue-position").value = "1";
  get("replacement").value = "V";
  get("commit-message").value = "Keep draft";
  get("branch-name").value = "new";
  await get("branch-form").listeners.submit({preventDefault() {}});
  assert.equal(mounted.getBranch(), "new");
  assert.equal(get("sequence").textContent, "");
  assert.equal(get("sequence-source").children.length, 0);
  assert.equal(get("substitutions").children.length, 0);
  assert.equal(get("compare-from").value, "");
  assert.equal(window.hbbComparison.getState().status, "idle");
  assert.match(get("branch-status").textContent, /data unavailable/);
  assert.match(get("error").textContent, /load failed/);
  assert.equal(get("commit-message").value, "");
  get("branch-select").value = "main";
  get("branch-select").listeners.change();
  await tick();
  assert.equal(get("commit-message").value, "Keep draft");
  console.log("Frontend branch, draft and comparison checks passed");
})().catch(err => { console.error(err); process.exitCode = 1; });
