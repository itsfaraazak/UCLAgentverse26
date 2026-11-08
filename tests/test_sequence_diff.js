"use strict";

const assert = require("node:assert/strict");
const {render} = require("../web/sequence_diff.js");

class Element {
  constructor(tag, document) {
    this.tagName = tag;
    this.ownerDocument = document;
    this.children = [];
    this.attributes = {};
    this.dataset = {};
    this.listeners = {};
    this.className = "";
    this.textContent = "";
  }
  append(...nodes) { this.children.push(...nodes); }
  replaceChildren(...nodes) { this.children = nodes; }
  setAttribute(name, value) { this.attributes[name] = value; }
  addEventListener(name, callback) { this.listeners[name] = callback; }
  click() { this.listeners.click(); }
}
const document = {createElement(tag) { return new Element(tag, document); }};
const container = document.createElement("div");
const all = (node, predicate) => [
  ...(predicate(node) ? [node] : []),
  ...node.children.flatMap(child => all(child, predicate))
];
const cls = (root, name) => all(root, node => node.className.split(" ").includes(name));
const text = root => [root.textContent, ...root.children.map(text)].join(" ");
const result = (old, next, reference, changes, from = "a", to = "b") => ({
  from: {commit: from, kind: from === "reference" ? "reference" : "commit",
    sequence: {sequence: old, ...(reference === null ? {} : {reference: {sequence: reference}})}},
  to: {commit: to, kind: to === "reference" ? "reference" : "commit",
    sequence: {sequence: next, ...(reference === null ? {} : {reference: {sequence: reference}})}},
  sequence: {changes, raw_diff: "actual raw diff"}
});

const data = result("AVD", "AED", "AED", [{position: 2, old: "V", new: "E"}], "a", "reference");
const original = JSON.stringify(data);
const selections = [];
const api = render(container, data, {onSelect: selection => selections.push(selection)});
assert.equal(JSON.stringify(data), original);
assert.match(text(container), /To: Reference baseline/);
assert.match(text(container), /2: V → E; reference E/);
assert.match(text(container), /Positions 1–3/);
assert.equal(cls(container, "sequence-diff__residue--old")[0].textContent, "−V");
assert.equal(cls(container, "sequence-diff__residue--new")[0].textContent, "+E");
assert.equal(cls(container, "sequence-diff__row").length, 3);
cls(container, "sequence-diff__change")[0].click();
assert.deepEqual(selections, [{position: 2, old: "V", new: "E", reference: "E", changed: true}]);
assert.equal(all(container, n => n.attributes["aria-pressed"] === "true").length, 4);
const position1 = cls(container, "sequence-diff__residue").find(n => n.dataset.position === "1");
position1.click();
assert.deepEqual(selections[1], {position: 1, old: "A", new: "A", reference: "A", changed: false});
assert.equal(all(container, n => n.attributes["aria-pressed"] === "true").length, 3);
api.select(2);
assert.equal(selections.length, 2);
api.select(null);
assert.equal(all(container, n => n.attributes["aria-pressed"] === "true").length, 0);
assert.throws(() => api.select(0), RangeError);

const longOld = "A".repeat(120);
const longNew = "A".repeat(100) + "V" + "A".repeat(19);
const long = render(container, result(longOld, longNew, null, [{position: 101, old: "A", new: "V"}], "reference", "b"));
assert.equal(cls(container, "sequence-diff__block").length, 3);
assert.match(text(container), /Positions 101–120/);
assert.match(text(container), /From: Reference baseline/);
assert.equal(cls(container, "sequence-diff__row").length, 6);
api.destroy();
assert.equal(container.children.length, 1);
long.select(101);
assert.equal(all(container, n => n.attributes["aria-pressed"] === "true").length, 3);
long.destroy();
assert.equal(container.children.length, 0);

render(container, result("ABC", "ABC", "ABC", []));
assert.match(text(container), /No sequence differences/);
assert.equal(cls(container, "sequence-diff__residue--old").length, 0);
const previous = container.children[0];
assert.throws(() => render(container, result("ABC", "ABD", "ABC", [])), /Changes do not match/);
assert.throws(() => render(container, result("ABC", "AB", null, [])), /equal-length/);
assert.throws(() => render(container, result("ABC", "ABD", "ABC", [{position: 3, old: "X", new: "D"}])), /Invalid/);
assert.throws(() => render(container, result("ABC", "ABC", "AB", [])), /Reference/);
assert.equal(container.children[0], previous);
render(container, result("", "", null, []));
assert.match(text(container), /Empty sequences/);
console.log("Sequence diff checks passed");
