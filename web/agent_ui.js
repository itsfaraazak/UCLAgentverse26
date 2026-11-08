"use strict";

(() => {
  const get = id => document.getElementById(id);
  let proposalToken = null, working = false;
  const status = get("agent-status"), output = get("agent-proposal"), approve = get("agent-approve");
  for (const letter of "ACDEFGHIKLMNPQRSTVWY") {
    const option = document.createElement("option");
    option.value = letter;
    option.textContent = letter;
    get("agent-alternate").append(option);
  }
  function line(text, tag = "p") {
    const item = document.createElement(tag);
    item.textContent = text;
    output.append(item);
  }
  for (const id of ["agent-position", "agent-alternate"]) {
    get(id).addEventListener("input", () => { get("agent-consent").checked = false; });
    get(id).addEventListener("change", () => { get("agent-consent").checked = false; });
  }
  async function call(path, body) {
    const response = await fetch(path, {method: "POST", cache: "no-store",
      headers: {"Content-Type": "application/json"}, body: JSON.stringify(body)});
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Agent request failed.");
    return result;
  }
  get("agent-form").addEventListener("submit", async event => {
    event.preventDefault();
    if (working) return;
    proposalToken = null;
    approve.hidden = true;
    output.replaceChildren();
    const position = Number(get("agent-position").value), alternate = get("agent-alternate").value;
    if (!Number.isInteger(position) || position < 1 || position > 147 || !get("agent-consent").checked) {
      status.textContent = "Select a valid position and confirm consent.";
      return;
    }
    get("agent-consent").checked = false;
    working = true;
    status.textContent = "Requesting a proposal from Gemini…";
    try {
      const result = await call("/api/agent/propose", {positions: [position],
        alternatives: alternate ? [{position, alternate}] : null, consent: true});
      const proposal = result.proposal;
      proposalToken = result.token;
      line(`${result.provider} · ${result.model} — speculative, unverified output`, "strong");
      proposal.changes.forEach(change => {
        line(`Position ${change.position}: ${change.before} → ${change.after} (reference ${change.reference})`, "h3");
        line(change.interpretation);
      });
      line(`Complete proposed substitutions: ${proposal.substitutions.map(c => `${c.reference}${c.position}${c.alternate}`).join(", ") || "none"}`);
      line(proposal.inference);
      line(proposal.limitations);
      status.textContent = `Proposal is based on ${proposal.base_head ? proposal.base_head.slice(0, 10) : "the empty history"}. Review before committing.`;
      approve.hidden = false;
    } catch (err) { status.textContent = err.message; }
    finally { working = false; }
  });
  approve.addEventListener("click", async () => {
    if (working || !proposalToken) return;
    working = true;
    approve.disabled = true;
    try {
      const state = await call("/api/agent/commit", {token: proposalToken, approved: true});
      proposalToken = null;
      approve.hidden = true;
      status.textContent = `Committed ${state.head.slice(0, 10)}. This is a sequence proposal, not validation.`;
      window.dispatchEvent(new Event("hbb:agent-committed"));
    } catch (err) {
      proposalToken = null;
      approve.hidden = true;
      status.textContent = `${err.message} Request and review a new proposal.`;
    } finally { working = false; approve.disabled = false; }
  });
})();
