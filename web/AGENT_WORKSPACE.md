# Agent workspace integration

Load `agent_workspace.css` and then `agent_workspace.js` on the hosting page.
Call `window.AgentWorkspace.mount(container, callbacks)` with an empty DOM
container. Each mount owns its DOM and state and returns
`{branchChanged(), destroy()}`. Call `branchChanged()` immediately on every
branch switch, including while a plan request is pending; it invalidates the
proposal and ignores a pending plan response. It does not cancel requests or
undo a commit already sent. Call `destroy()` before replacing the host. Destroy
removes the UI and suppresses late response callbacks, but does not cancel a
request already sent.

Callbacks:

- `getBranch()` is required and returns the currently selected branch name.
  The branch is captured with the request and checked again before approval.
- `fetch(path, options)` replaces `window.fetch` and must return a Fetch-like
  response with `ok` and `json()`. Optional; the default uses same-origin fetch.
- `onCommitted(state, branch)` runs once after a successful commit response, with
  the server's sequence state and the branch captured at approval. The selected
  branch may have changed while the commit was pending; refresh the appropriate
  history and do not display that state as belonging to another branch.
  Callback errors are logged and do not turn a successful commit into a failure.
- `onPreview(changes)` receives an explicitly prepared sequence proposal, or an
  empty array when it is cleared. The host may annotate reference coordinates;
  it must not present them as a predicted structure.

The component posts `{messages, branch, consent: true}` to `/api/agent/plan`.
Sending is the user's action to initiate external processing; the interface
shows a disclosure rather than a separate checkbox. The response may contain a
conversational answer, clarification, research plan, or sequence proposal.
It displays the complete returned `proposal`, including the captured base head
and complete substitutions, and holds the returned token privately until
explicit approval. Approval posts `{token, approved: true, message}` to
`/api/agent/commit`. A message change discards the displayed proposal.
Branch changes are checked at approval.
Proposal/commit errors require a new proposal; a failed commit response may
have followed a successful server commit, so the user is told to refresh
history before retrying. Tokens expire or are consumed server-side.

The progress messages report only request and response states; there is no
streaming endpoint. No structure is changed by this component. Hosts displaying
a structure must keep it identified as reference-only and any proposed
substitutions as annotations, not a predicted or edited structure. Do not pass
patient-derived or sensitive information in questions. The backend controls
which sequence context is sent externally; verify its privacy contract before
deploying this component.

Run `node tests/test_agent_workspace.js` for the standalone component tests.
