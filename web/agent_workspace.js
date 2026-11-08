"use strict";

(() => {
  function mount(container, callbacks = {}) {
    const doc = container.ownerDocument;
    const request = callbacks.fetch || window.fetch.bind(window);
    let destroyed = false, generation = 0, active = null;
    let messages = [], token = null, proposalBranch = null;
    let conversationBranch = null;
    const branchDrafts = new Map();
    const root = doc.createElement("section");
    root.className = "agent-workspace";
    function element(tag, text, parent = root) {
      const node = doc.createElement(tag);
      if (text !== undefined) node.textContent = text;
      parent.append(node);
      return node;
    }
    element("h2", "Research assistant");
    element("p", "Describe your research goal, even if you do not know which changes to make. The assistant can ask questions and suggest a plan; its output is unverified, not clinical guidance.");
    const conversation = element("section");
    conversation.className = "agent-conversation";
    conversation.setAttribute("aria-label", "Conversation");
    const form = element("form");
    const questionLabel = element("label", "Your message", form);
    const question = element("textarea", undefined, questionLabel);
    question.required = true;
    question.placeholder = "What would you like to investigate, and why?";
    const privacy = element("p", "Sending shares your conversation and current sequence with Gemini and an external research service. Do not include patient or sensitive information.", form);
    privacy.className = "agent-workspace-privacy";
    const submit = element("button", "Send message", form);
    submit.type = "submit";
    const reset = element("button", "Start over", form);
    reset.type = "button";
    const status = element("p", "Describe your research goal to begin.");
    status.setAttribute("role", "status");
    status.setAttribute("aria-live", "polite");
    const review = element("section");
    review.hidden = true;
    element("h3", "Review the proposed plan", review);
    const planView = element("div", undefined, review);
    const details = element("details", undefined, review);
    element("summary", "Complete plan details", details);
    const full = element("pre", undefined, details);
    element("p", "A plan is a proposal, not a validated biological result. Committing records the approved proposal; it does not edit or predict a 3D structure.", review);
    const commitArea = element("div", undefined, review);
    const messageLabel = element("label", "Commit message", commitArea);
    const message = element("input", undefined, messageLabel);
    message.type = "text";
    message.maxLength = 200;
    message.required = true;
    message.placeholder = "Describe what you are recording";
    const approve = element("button", "Approve and commit", commitArea);
    approve.type = "button";
    container.replaceChildren(root);

    function currentBranch() {
      return typeof callbacks.getBranch === "function" ? callbacks.getBranch() : null;
    }
    function controls() {
      const committing = active && active.kind === "commit";
      submit.disabled = !!active;
      reset.disabled = !!committing;
      question.disabled = !!committing;
      message.disabled = approve.disabled = !!active;
    }
    function invalidate() {
      token = null;
      proposalBranch = null;
      review.hidden = true;
      planView.replaceChildren();
      full.textContent = "";
      message.value = "";
      if (typeof callbacks.onPreview === "function") callbacks.onPreview([]);
    }
    function clearPendingPlan() {
      generation++;
      if (active && active.kind === "plan") {
        if (active.controller) active.controller.abort();
        if (active.pendingNode) active.pendingNode.remove();
        active = null;
      }
      controls();
    }
    function addMessage(role, content) {
      const item = element("article", undefined, conversation);
      item.className = "agent-message";
      element("strong", role === "user" ? "You" : "Assistant", item);
      element("p", content, item);
      return item;
    }
    function list(title, values, parent) {
      if (!Array.isArray(values) || !values.length) return;
      element("h4", title, parent);
      const ul = element("ul", undefined, parent);
      for (const value of values) element("li", typeof value === "string" ? value : JSON.stringify(value), ul);
    }
    function safeUrl(value) {
      if (typeof value !== "string") return null;
      try {
        const url = new URL(value);
        return (url.protocol === "https:" || url.protocol === "http:") && !url.username && !url.password ? url.href : null;
      } catch (_) { return null; }
    }
    function showPlan(plan, result, branch) {
      invalidate();
      if (typeof plan.summary === "string") element("p", plan.summary, planView);
      list("Steps", plan.steps, planView);
      list("Uncertainty and limitations", plan.uncertainty, planView);
      if (Array.isArray(plan.citations) && plan.citations.length) {
        element("h4", "Sources consulted — verify claims independently", planView);
        const ul = element("ul", undefined, planView);
        for (const citation of plan.citations) {
          const item = element("li", undefined, ul);
          const title = citation && typeof citation.title === "string" ? citation.title : "Source";
          const url = safeUrl(citation && citation.url);
          if (url) {
            const link = element("a", title, item);
            link.href = url;
            link.target = "_blank";
            link.rel = "noopener noreferrer";
          } else element("span", `${title} (no safe link available)`, item);
          if (citation && (citation.excerpt || citation.query || citation.retrieved_at)) {
            const provenance = element("details", undefined, item);
            element("summary", "Abstract excerpt and search details", provenance);
            if (citation.provider) element("p", `Retrieved from ${citation.provider}. Excerpt may be truncated.`, provenance);
            if (citation.excerpt) element("p", citation.excerpt, provenance);
            if (citation.query) element("p", `Search: ${citation.query}`, provenance);
            if (citation.retrieved_at) element("p", `Retrieved: ${citation.retrieved_at}`, provenance);
            const providerUrl = safeUrl(citation.provider_url);
            if (providerUrl) {
              const provider = element("a", "View provider record ↗", provenance);
              provider.href = providerUrl;
              provider.target = "_blank";
              provider.rel = "noopener noreferrer";
            }
          }
        }
      } else element("p", "No evidence links were provided. Verify claims independently.", planView);
      if (result.proposal && Array.isArray(result.proposal.changes)) {
        element("h4", "Sequence preview", planView);
        for (const change of result.proposal.changes) {
          const row = element("div", undefined, planView);
          row.className = "agent-change";
          element("span", `Position ${change.position}`, row);
          const old = element("span", `− ${change.old}`, row);
          old.className = "agent-change-before";
          element("span", "→", row);
          const next = element("span", `+ ${change.new}`, row);
          next.className = "agent-change-after";
        }
        if (result.proposal.details) element("p", result.proposal.details, planView);
        if (result.proposal.limitations) element("p", result.proposal.limitations, planView);
        if (Array.isArray(result.proposal.substitutions)) {
          const all = result.proposal.substitutions.map(item =>
            `${item.reference}${item.position}${item.alternate}`).join(", ") || "Reference sequence";
          element("p", `Complete resulting substitutions: ${all}`, planView);
        }
        const source = result.proposal.source && result.proposal.source.clinvar;
        if (source && safeUrl(source.url)) {
          const link = element("a", `Verify ${source.accession_version || "ClinVar record"} ↗`, planView);
          link.href = safeUrl(source.url);
          link.target = "_blank";
          link.rel = "noopener noreferrer";
        }
      }
      full.textContent = JSON.stringify({plan, ...(result.proposal ? {proposal: result.proposal} : {})}, null, 2);
      token = typeof result.token === "string" && result.token ? result.token : null;
      proposalBranch = token ? branch : null;
      commitArea.hidden = !token;
      if (typeof plan.commit_message === "string") message.value = plan.commit_message.slice(0, 200);
      review.hidden = false;
      if (token && result.proposal && Array.isArray(result.proposal.changes) &&
          result.proposal.changes.every(c => c && Number.isInteger(c.position) && c.position > 0 &&
            typeof c.old === "string" && typeof c.new === "string") &&
          typeof callbacks.onPreview === "function") callbacks.onPreview(result.proposal.changes);
    }
    question.addEventListener("input", () => {
      if (!conversationBranch) conversationBranch = currentBranch();
      clearPendingPlan();
      invalidate();
      status.textContent = "Message changed. Send it when ready.";
    });
    reset.addEventListener("click", () => {
      if (active && active.kind === "commit") return;
      clearPendingPlan();
      messages = [];
      if (conversationBranch) branchDrafts.delete(conversationBranch);
      conversation.replaceChildren();
      question.value = "";
      invalidate();
      status.textContent = "Conversation cleared. Describe your research goal to begin.";
    });
    async function post(path, body, signal) {
      const response = await request(path, {method: "POST", cache: "no-store",
        headers: {"Content-Type": "application/json"}, body: JSON.stringify(body),
        ...(signal ? {signal} : {})});
      let result;
      try { result = await response.json(); } catch (_) { throw new Error("The server returned an unreadable response."); }
      if (!response.ok) throw new Error(typeof result.error === "string" ? result.error : "Request failed.");
      return result;
    }
    form.addEventListener("submit", async event => {
      event.preventDefault();
      if (active || destroyed) return;
      const text = question.value.trim(), branch = currentBranch();
      if (!text || !branch) {
        status.textContent = "Enter a message and select a branch.";
        return;
      }
      if (messages.length >= 12) {
        status.textContent = "This conversation has reached its limit. Start over and include the key context in your next message.";
        return;
      }
      conversationBranch = branch;
      invalidate();
      const nextMessages = messages.concat([{role: "user", content: text}]);
      const controller = new AbortController();
      const operation = {kind: "plan", generation, branch, controller, text,
        pendingNode: addMessage("user", text), timedOut: false};
      question.value = "";
      active = operation;
      const timer = setTimeout(() => { operation.timedOut = true; controller.abort(); }, 25000);
      controls();
      status.textContent = "Loading…";
      try {
        const result = await post("/api/agent/plan", {branch, messages: nextMessages, consent: true}, controller.signal);
        if (destroyed || active !== operation || generation !== operation.generation) return;
        if (currentBranch() !== branch) {
          status.textContent = "The selected branch changed. Start a new conversation for that branch.";
          messages = [];
          conversation.replaceChildren();
          return;
        }
        if (!result || typeof result.assistant_message !== "string" || !result.assistant_message.trim() ||
            (result.plan != null && (typeof result.plan !== "object" || Array.isArray(result.plan)))) {
          throw new Error("The server returned an incomplete assistant response.");
        }
        const questions = Array.isArray(result.questions) ? result.questions.filter(q => typeof q === "string") : [];
        const planContext = result.plan ? [
          `Previous unverified plan: ${result.plan.summary || ""}`,
          ...(Array.isArray(result.plan.steps) ? result.plan.steps.slice(0, 2) : []),
          ...(Array.isArray(result.plan.citations) ? result.plan.citations.slice(0, 2).map(c => `Source: ${c.title || ""}`) : [])
        ] : [];
        // Keep follow-ups grounded in the previous displayed answer while
        // respecting the backend's per-message UTF-8 byte limit.
        const assistantContent = Array.from([result.assistant_message, ...questions, ...planContext].join("\n")).slice(0, 450).join("");
        messages = nextMessages.concat([{role: "assistant", content: assistantContent}]);
        addMessage("assistant", result.assistant_message);
        list("Questions", questions, conversation);
        question.value = "";
        if (result.plan) showPlan(result.plan, result, branch);
        status.textContent = result.plan
          ? `Plan received for branch ${branch}. Review all details and evidence before deciding whether to commit.`
          : "Response received. Continue the conversation if you would like to clarify or refine the goal.";
      } catch (error) {
        if (!destroyed && active === operation && generation === operation.generation) {
          operation.pendingNode.remove();
          question.value = text;
          status.textContent = operation.timedOut
            ? "The assistant took too long. Your message is still here; try again."
            : `${error.message} Your message is still here; try again.`;
        }
      } finally {
        clearTimeout(timer);
        if (!destroyed && active === operation) { active = null; controls(); }
      }
    });
    approve.addEventListener("click", async () => {
      if (active || destroyed || !token) return;
      if (currentBranch() !== proposalBranch) {
        invalidate();
        status.textContent = "The selected branch changed. Request and review a new plan.";
        return;
      }
      if (!message.value.trim()) {
        status.textContent = "Enter a commit message before approving the plan.";
        return;
      }
      const approvedToken = token, committedBranch = proposalBranch;
      const operation = {kind: "commit", generation, branch: committedBranch};
      token = null;
      active = operation;
      controls();
      status.textContent = `Commit sent for branch ${committedBranch}; waiting for the server…`;
      try {
        const state = await post("/api/agent/commit", {token: approvedToken, approved: true, message: message.value.trim()});
        if (destroyed) return;
        if (operation.generation === generation) invalidate();
        status.textContent = `Committed ${state.head || "the proposal"} on branch ${committedBranch}. This is not biological validation.`;
        if (typeof callbacks.onCommitted === "function") {
          try { callbacks.onCommitted(state, committedBranch); } catch (error) { console.error("Agent workspace onCommitted callback failed", error); }
        }
      } catch (error) {
        if (!destroyed) {
          if (operation.generation === generation) invalidate();
          status.textContent = `${error.message} The commit outcome on branch ${committedBranch} may be uncertain; refresh its history before requesting and reviewing a new plan.`;
        }
      } finally { if (!destroyed && active === operation) { active = null; controls(); } }
    });
    return {
      branchChanged() {
        if (conversationBranch) branchDrafts.set(conversationBranch, {
          messages: messages.map(item => ({...item})),
          draft: active && active.kind === "plan" && active.text ? active.text : question.value
        });
        clearPendingPlan();
        conversationBranch = currentBranch();
        const saved = branchDrafts.get(conversationBranch);
        messages = saved ? saved.messages.map(item => ({...item})) : [];
        conversation.replaceChildren();
        for (const item of messages) addMessage(item.role, item.content);
        question.value = saved ? saved.draft : "";
        invalidate();
        status.textContent = saved ? "Restored this branch's conversation draft." :
          "The selected branch changed. Start a new conversation for that branch.";
      },
      destroy() {
        destroyed = true;
        generation++;
        token = null;
        if (active && active.kind === "plan" && active.controller) active.controller.abort();
        root.remove();
      }
    };
  }
  window.AgentWorkspace = {mount};
})();
