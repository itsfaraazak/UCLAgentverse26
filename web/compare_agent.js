"use strict";

(() => {
  const get = id => document.getElementById(id);
  const button = get("explain-submit"), status = get("explain-status"), result = get("explain-result");
  let generation = 0, pending = false, current = null;
  function setComparison(state) {
    generation += 1;
    get("explain-consent").checked = false;
    current = state && state.status === "ready" ? {from: state.from, to: state.to} : null;
    result.replaceChildren();
    button.disabled = !current || pending;
    status.textContent = current ? "Explanation will be tied to this selected commit pair." : "Select two commits to enable the AI assistant.";
  }
  window.addEventListener("hbb:comparison", event => setComparison(event.detail));
  setComparison(window.hbbComparison ? window.hbbComparison.getState() : null);
  get("explain-question").addEventListener("input", () => { get("explain-consent").checked = false; });
  get("explain-form").addEventListener("submit", async event => {
    event.preventDefault();
    if (!current || pending || !get("explain-consent").checked) return;
    const pair = {...current}, request = ++generation;
    get("explain-consent").checked = false;
    pending = true;
    button.disabled = true;
    result.replaceChildren();
    status.textContent = "Requesting an explanation from Gemini…";
    try {
      const response = await fetch("/api/agent/explain", {method: "POST", cache: "no-store",
        headers: {"Content-Type": "application/json"}, body: JSON.stringify({
          from: pair.from, to: pair.to, question: get("explain-question").value, consent: true})});
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Agent request failed.");
      if (request !== generation) return;
      if (data.from_commit !== pair.from || data.to_commit !== pair.to) throw new Error("Response did not match the selected commits.");
      const label = document.createElement("strong");
      label.textContent = "Gemini · unverified interpretation";
      const text = document.createElement("p");
      text.textContent = data.explanation;
      result.append(label, text);
      const note = document.createElement("p");
      note.textContent = "Context links below are not evidence for the model's claims:";
      result.append(note);
      for (const source of data.sources) {
        const link = document.createElement("a");
        link.href = source.url;
        link.textContent = `${source.label} ↗`;
        result.append(link, document.createTextNode("  "));
      }
      status.textContent = `Explanation for ${pair.from.slice(0, 10)} → ${pair.to.slice(0, 10)}.`;
    } catch (err) {
      if (request === generation) status.textContent = err.message;
    } finally {
      pending = false;
      button.disabled = !current;
    }
  });
})();
