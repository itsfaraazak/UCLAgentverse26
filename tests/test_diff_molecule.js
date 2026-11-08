"use strict";

// Run from repository root: node tests/test_diff_molecule.js (no WebGL required).
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const code = fs.readFileSync("web/diff_molecule.js", "utf8");
const pdb = fs.readFileSync("web/structures/2hhb.pdb", "utf8");
const canonical = "MVHLTPEEKSAVTALWGKVNVDEVGGEALGRLLVVYPWTQRFFESFGDLSTPDAVMGNPKVKAHGKKVLGAFSDGLAHLDNLKGTFATLSELHCDKLHVDPENFRLLGNVLVCVLAHHFGKEFTPPVQAAYQKVVAGVANALAHKYH";
function setup(options = {}) {
  const calls = [];
  let visible = !options.hidden, callback;
  const container = {style: {}, children: [], appendChild(child) { this.children.push(child); },
    getClientRects: () => visible ? [{}] : [],
    getBoundingClientRect: () => ({width: 500, height: 400})};
  const document = {activeElement: null};
  function element() {
    return {children: [], attributes: {}, style: {},
      focus() { document.activeElement = this; },
      set textContent(value) { this.text = value; this.children = []; },
      get textContent() { return this.text; },
      setAttribute(key, value) { this.attributes[key] = value; },
      addEventListener(event, fn) { this[event] = fn; },
      appendChild(child) { this.children.push(child); }};
  }
  const status = element();
  document.createElement = element;
  status.ownerDocument = document;
  const viewer = {};
  for (const name of ["addModel", "setStyle", "zoomTo", "resize", "render", "setClickable", "clear",
    "addLabel", "removeAllLabels", "linkViewer", "zoom"])
    viewer[name] = (...args) => calls.push([name, ...args]);
  const window = {$3Dmol: {createViewer: () => {
    calls.push(["create"]);
    if (options.noGL || (options.failSecond && calls.filter(c => c[0] === "create").length === 2))
      throw new Error("WebGL unavailable");
    return viewer;
  }}, ResizeObserver: class {
    constructor(fn) { callback = fn; }
    observe() {}
  }};
  vm.runInNewContext(code, {window, fetch: options.fetch || (async url => {
    assert.equal(url, "/structures/2hhb.pdb");
    return {ok: !options.fail, text: async () => options.pdb || pdb};
  })});
  return {api: window.diffMolecule, calls, status, container, document,
    reveal() { visible = true; callback(); }};
}
const change = position => ({position, reference: canonical[position - 1],
  from: canonical[position - 1], to: canonical[position - 1] === "A" ? "V" : "A"});
(async () => {
  const s = setup({hidden: true});
  assert.equal(s.calls.length, 0);
  await s.api.init(s.container, s.status);
  await s.api.show([change(7), change(20), change(1)]);
  assert.equal(s.calls.length, 0);
  s.reveal();
  await s.api.resize();
  assert.match(s.status.textContent, /2\/3.*M1 is cleaved/);
  assert.match(s.status.textContent, /not mutant coordinates or predictions of effect/);
  const highlights = s.calls.filter(c => c[0] === "setStyle" && c[1].resi);
  assert.deepEqual(highlights.map(c => c[1].resi), [6, 6, 19, 19]);
  assert.deepEqual(highlights.map(c => c[2].stick.color),
    ["#e5484d", "#30a46c", "#e5484d", "#30a46c"]);
  assert.match(s.status.textContent, /OLD red \/ NEW green.*REFERENCE 2HHB/);
  let buttons = s.status.children[0].children;
  assert.equal(buttons[3].disabled, true);
  assert.match(buttons[3].textContent, /UNMAPPED/);
  assert.match(buttons[1].textContent, /OLD E → NEW A; reference E/);
  buttons[1].focus();
  buttons[1].click();
  assert.equal(s.document.activeElement, buttons[1]);
  assert.equal(buttons[1].attributes["aria-pressed"], "true");
  assert.match(s.calls.filter(c => c[0] === "addLabel").at(-1)[1], /^NEW A7$/);
  s.status.children[0].children[0].click();
  assert.equal(buttons[1].attributes["aria-pressed"], "false");
  assert.equal(s.container.children.length, 2);
  assert.equal(s.calls.filter(c => c[0] === "addModel").length, 2);
  assert.equal(s.calls.filter(c => c[0] === "linkViewer").length, 2);
  assert.equal(s.container.style.height, "auto");
  assert.equal(s.container.style.overflow, "visible");
  const stableToolbar = s.status.children[0];
  buttons[1].focus();
  await s.api.resize();
  await s.api.init(s.container, s.status);
  assert.equal(s.status.children[0], stableToolbar);
  assert.equal(s.document.activeElement, buttons[1]);
  assert.ok(s.calls.some(c => c[0] === "zoom" && c[1] === 0.7));
  assert.ok(s.calls.filter(c => c[0] === "addLabel")
    .every(c => ["#9f2028", "#14643f"].includes(c[2].backgroundColor)));
  assert.ok(s.calls.find(c => c[0] === "addModel")[1].split("\n")
    .every(line => ["B", "D"].includes(line[21])));
  assert.equal(s.api.locate(7), true);
  assert.equal(s.api.locate(1), false);
  const click = s.calls.find(c => c[0] === "setClickable")[3];
  click({resi: 19});
  assert.equal(buttons[2].attributes["aria-pressed"], "true");
  assert.equal(s.calls.filter(c => c[0] === "zoomTo").at(-1)[1].resi, undefined);
  // Every canonical deposited beta residue must validate against the actual asset.
  const all = await s.api.show(Array.from({length: 146}, (_, i) => change(i + 2)));
  assert.equal(all.mapped.length, 146);
  assert.equal(all.issues.length, 0);
  for (const invalid of [[{...change(7), reference: "V"}], [change(0)],
    [{...change(7), to: "*"}], [change(7), change(7)], null]) {
    assert.equal((await s.api.show(invalid)).applied, false);
    assert.equal(s.api.locate(7), false);
  }
  assert.equal((await s.api.show([])).mapped.length, 0);
  // Commit-to-commit changes need not start at the canonical residue.
  assert.equal((await s.api.show([{position: 7, reference: "E", from: "V", to: "K"}])).mapped.length, 1);
  s.api.locate(7);
  assert.match(s.calls.filter(c => c[0] === "addLabel").at(-1)[1], /^NEW K7$/);
  assert.equal(s.calls.filter(c => c[0] === "addModel")[0][1],
    pdb.split("\n").filter(line => line.startsWith("ATOM  ") && ["B", "D"].includes(line[21])).join("\n"));
  const missing = setup({pdb: pdb.split("\n").filter(line =>
    !(line.startsWith("ATOM  ") && line.slice(21, 26) === "D   6")).join("\n")});
  await missing.api.init(missing.container, missing.status);
  assert.equal((await missing.api.show([change(7), change(20)])).mapped.length, 1);
  assert.match(missing.status.textContent, /missing or mismatched/);
  for (const options of [{fail: true}, {noGL: true}, {pdb: "invalid"}]) {
    const failed = setup(options);
    assert.equal((await failed.api.init(failed.container, failed.status)).applied, false);
    assert.match(failed.status.textContent, /unavailable.*retry/);
    assert.match(failed.status.children[0].textContent, /Retry loading/);
  }
  const partial = setup({failSecond: true});
  assert.equal((await partial.api.init(partial.container, partial.status)).applied, false);
  assert.equal(partial.calls.filter(c => c[0] === "clear").length, 1);
  assert.ok(partial.container.children.every(panel => panel.children[1].textContent === ""));
  assert.equal((await partial.api.init(partial.container, partial.status)).applied, true);
  assert.equal(partial.container.children.length, 2);
  let resolve;
  const slow = setup({fetch: () => new Promise(r => { resolve = r; })});
  const init = slow.api.init(slow.container, slow.status);
  const first = slow.api.show([change(7)]);
  const last = slow.api.show([change(20)]);
  resolve({ok: true, text: async () => pdb});
  await init;
  assert.equal((await first).superseded, true);
  assert.deepEqual(Array.from((await last).mapped), [20]);
  console.log("diff_molecule: real PDB mapping, lazy lifecycle, async, errors and annotations passed");
})().catch(error => { console.error(error); process.exitCode = 1; });
