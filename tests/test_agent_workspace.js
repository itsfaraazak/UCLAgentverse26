"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

class Element {
  constructor(tag, doc) { this.tag = tag; this.ownerDocument = doc; this.children = []; this.listeners = {}; this.hidden = false; this.value = ""; this.checked = false; this.disabled = false; this.textContent = ""; }
  append(...children) { for (const child of children) { child.parent = this; this.children.push(child); } }
  replaceChildren(...children) { this.children = []; this.append(...children); }
  addEventListener(name, fn) { this.listeners[name] = fn; }
  setAttribute() {}
  remove() { this.removed = true; if (this.parent) this.parent.children = this.parent.children.filter(child => child !== this); }
}
const document = {createElement(tag) { return new Element(tag, document); }, createTextNode(text) { return {textContent: text}; }};
const window = {};
const timers = new Map();
let timerId = 0;
const fakeTimeout = (fn, ms) => { const id = ++timerId; timers.set(id, {fn, ms}); return id; };
const fakeClearTimeout = id => timers.delete(id);
vm.runInNewContext(fs.readFileSync("web/agent_workspace.js", "utf8"), {
  window, console, URL, AbortController, setTimeout: fakeTimeout, clearTimeout: fakeClearTimeout
});
const response = (body, ok = true) => ({ok, json: async () => body});
function descendants(el) { return [el, ...el.children.flatMap(child => child.children ? descendants(child) : [child])]; }
function setup() {
  const pending = [], committed = [], previews = [], host = new Element("div", document);
  let branch = "main";
  const instance = window.AgentWorkspace.mount(host, {getBranch: () => branch, fetch: (path, options) => new Promise((resolve, reject) => {
    pending.push({path, body: JSON.parse(options.body), resolve});
    if (options.signal) options.signal.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), {name: "AbortError"})));
  }), onCommitted: (state, b) => committed.push({state, branch: b}), onPreview: changes => previews.push(changes)});
  const all = descendants(host);
  return {host, instance, pending, committed, previews, setBranch: value => { branch = value; }, form: all.find(x => x.tag === "form"),
    question: all.find(x => x.tag === "textarea"), message: all.find(x => x.type === "text"),
    status: all.find(x => x.textContent === "Describe your research goal to begin."),
    approve: all.find(x => x.textContent === "Approve and commit"), reset: all.find(x => x.textContent === "Start over"),
    review: all.find(x => x.tag === "section" && x.hidden), full: all.find(x => x.tag === "pre")};
}
const submit = ui => ui.form.listeners.submit({preventDefault() {}});
const plan = {summary: "Investigate expression", steps: ["Find evidence"], uncertainty: ["Unknown effect"], citations: [{title: "Paper", url: "https://example.org/paper"}, {title: "unsafe", url: "javascript:alert(1)"}]};
const proposal = {base_head: "abc", changes: [{position: 7, old: "E", new: "V"}], substitutions: [{position: 7, reference: "E", alternate: "V"}]};

(async () => {
  const ui = setup();
  await submit(ui);
  assert.equal(ui.pending.length, 0);
  assert.match(ui.status.textContent, /message/);
  assert.equal(descendants(ui.host).some(x => x.type === "checkbox"), false);
  const privacy = descendants(ui.host).find(x => x.className === "agent-workspace-privacy");
  assert.equal(privacy.textContent, "Sending shares your conversation and current sequence with Gemini and an external research service. Do not include patient or sensitive information.");
  assert.equal(descendants(ui.host).some(x => /Europe PMC/.test(x.textContent)), false);
  ui.question.value = "Improve stability";
  const first = submit(ui);
  assert.deepEqual(ui.pending[0].body, {branch: "main", messages: [{role: "user", content: "Improve stability"}], consent: true});
  assert.equal(ui.status.textContent, "Loading…");
  assert.equal(ui.question.value, "");
  assert.ok(descendants(ui.host).some(x => x.textContent === "Improve stability"));
  ui.pending[0].resolve(response({assistant_message: "Let's clarify.", questions: ["Which condition?"]}));
  await first;
  assert.equal(ui.review.hidden, true);
  ui.question.value = "At room temperature";
  ui.question.listeners.input();
  const second = submit(ui);
  assert.deepEqual(ui.pending[1].body.messages, [{role: "user", content: "Improve stability"}, {role: "assistant", content: "Let's clarify.\nWhich condition?"}, {role: "user", content: "At room temperature"}]);
  ui.pending[1].resolve(response({assistant_message: "Here is a plan.", plan, proposal, token: "secret"}));
  await second;
  assert.equal(ui.review.hidden, false);
  assert.deepEqual(JSON.parse(ui.full.textContent), {plan, proposal});
  const links = descendants(ui.host).filter(x => x.tag === "a");
  assert.equal(links.length, 1);
  assert.equal(links[0].href, "https://example.org/paper");
  assert.equal(links[0].rel, "noopener noreferrer");
  assert.equal(ui.previews.at(-1)[0].position, 7);
  await ui.approve.listeners.click();
  assert.match(ui.status.textContent, /commit message/);
  ui.message.value = "Record proposal";
  const commit = ui.approve.listeners.click();
  assert.deepEqual(ui.pending[2].body, {token: "secret", approved: true, message: "Record proposal"});
  ui.setBranch("other"); ui.instance.branchChanged();
  ui.pending[2].resolve(response({head: "new"}));
  await commit;
  assert.equal(ui.committed[0].branch, "main");
  assert.match(ui.status.textContent, /branch main/);

  const retry = setup();
  retry.question.value = "Research goal";
  const fail = submit(retry);
  retry.pending[0].resolve(response({error: "Provider unavailable or no key"}, false));
  await fail;
  assert.match(retry.status.textContent, /no key/);
  assert.equal(retry.question.value, "Research goal");
  const again = submit(retry);
  assert.equal(retry.status.textContent, "Loading…");
  assert.deepEqual(retry.pending[1].body, retry.pending[0].body);
  retry.pending[1].resolve(response({assistant_message: "Research only.", plan}));
  await again;
  assert.equal(retry.review.hidden, false);
  assert.equal(retry.approve.disabled, false);
  assert.equal(descendants(retry.host).find(x => x.children && x.children.includes(retry.approve)).hidden, true);
  await retry.approve.listeners.click();
  assert.equal(retry.pending.length, 2);

  const timed = setup();
  timed.question.value = "A slower follow-up";
  const waiting = submit(timed);
  const scheduled = [...timers.values()].find(item => item.ms === 25000);
  assert.ok(scheduled);
  scheduled.fn();
  await waiting;
  assert.match(timed.status.textContent, /took too long/);
  assert.equal(timed.question.value, "A slower follow-up");
  assert.equal(descendants(timed.host).some(x => x.textContent === "A slower follow-up"), false);

  const followup = setup();
  followup.question.value = "Study HBB";
  const initialResearch = submit(followup);
  followup.pending[0].resolve(response({assistant_message: "Here is a plan.", plan}));
  await initialResearch;
  followup.question.value = "Why that first step?";
  followup.question.listeners.input();
  const nextResearch = submit(followup);
  assert.match(followup.pending[1].body.messages[1].content, /Previous unverified plan: Investigate expression/);
  assert.match(followup.pending[1].body.messages[1].content, /Find evidence/);
  followup.pending[1].resolve(response({assistant_message: "Follow-up"}));
  await nextResearch;

  const rejected = setup();
  rejected.question.value = "Explore";
  const proposed = submit(rejected);
  rejected.pending[0].resolve(response({assistant_message: "Plan", plan, proposal, token: "t"}));
  await proposed;
  rejected.message.value = "Record plan";
  const failedCommit = rejected.approve.listeners.click();
  rejected.pending[1].resolve(response({error: "Stale head"}, false));
  await failedCommit;
  assert.equal(rejected.review.hidden, true);
  assert.match(rejected.status.textContent, /refresh its history/);
  await rejected.approve.listeners.click();
  assert.equal(rejected.pending.length, 2);

  const stale = setup();
  stale.question.value = "Old";
  const old = submit(stale);
  stale.question.value = "New"; stale.question.listeners.input();
  const fresh = submit(stale);
  stale.pending[0].resolve(response({assistant_message: "Old reply", plan, token: "old"}));
  await old;
  assert.equal(stale.review.hidden, true);
  assert.equal(stale.form.children.find(x => x.textContent === "Send message").disabled, true);
  stale.pending[1].resolve(response({assistant_message: "New reply"}));
  await fresh;
  assert.equal(stale.review.hidden, true);
  assert.equal(descendants(stale.host).some(x => x.textContent === "Old reply"), false);

  const switched = setup();
  switched.question.value = "Explore";
  const pending = submit(switched);
  switched.setBranch("other"); switched.instance.branchChanged(); switched.setBranch("main");
  switched.pending[0].resolve(response({assistant_message: "Stale", plan, token: "t"}));
  await pending;
  assert.equal(switched.review.hidden, true);
  assert.match(switched.status.textContent, /branch changed/);
  switched.question.value = "Again";
  const gone = submit(switched);
  switched.instance.destroy();
  switched.pending[1].resolve(response({assistant_message: "Late"}));
  await gone;
  assert.equal(switched.host.children.length, 0);

  const drafts = setup();
  drafts.question.value = "A detailed unsent goal";
  drafts.question.listeners.input();
  drafts.setBranch("other"); drafts.instance.branchChanged();
  assert.equal(drafts.question.value, "");
  drafts.setBranch("main"); drafts.instance.branchChanged();
  assert.equal(drafts.question.value, "A detailed unsent goal");

  const cleared = setup();
  cleared.question.value = "Discard this goal";
  const clearing = submit(cleared);
  assert.equal(cleared.status.textContent, "Loading…");
  cleared.reset.listeners.click();
  assert.equal(cleared.question.value, "");
  assert.match(cleared.status.textContent, /Conversation cleared/);
  cleared.pending[0].resolve(response({assistant_message: "Discarded reply", plan, token: "old"}));
  await clearing;
  assert.equal(cleared.review.hidden, true);
  assert.equal(descendants(cleared.host).some(x => x.textContent === "Discarded reply"), false);
  cleared.setBranch("other"); cleared.instance.branchChanged();
  cleared.setBranch("main"); cleared.instance.branchChanged();
  assert.equal(cleared.question.value, "");
  cleared.question.value = "Fresh goal";
  const restarted = submit(cleared);
  assert.equal(cleared.status.textContent, "Loading…");
  assert.deepEqual(cleared.pending[1].body, {branch: "main", messages: [{role: "user", content: "Fresh goal"}], consent: true});
  cleared.pending[1].resolve(response({assistant_message: "Fresh reply"}));
  await restarted;
  console.log("agent workspace tests passed");
})().catch(error => { console.error(error); process.exitCode = 1; });
