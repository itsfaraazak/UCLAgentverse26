# Local operation and security boundaries

This is a prototype, not a production security design. Run it only on a trusted
machine and account. The server binds to `127.0.0.1` only; do not publish it
through a tunnel, proxy, container port mapping, or shared machine. There is no
authentication, authorization, TLS, rate limiting, or protection against other
local users and malicious local processes. Any local client can read and change
the workspace, including without an Origin header.

Start with `python backend/server.py` and open `http://127.0.0.1:8000`.
Configuration is via environment variables:

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `8000` | Loopback listening port (use `0` for an OS-assigned port, printed at startup). |
| `STORE_DB_PATH` | `store.sqlite3` in the project root | SQLite workspace path; its parent directory must exist. |
| `GIT_HISTORY_PATH` | `research-notes.git` in the project root | Dedicated app-owned Git note repository; its parent must exist. |
| `NCBI_EMAIL` | unset | Optional contact identifying NCBI E-utilities requests; not included in displayed provenance URLs. |
| `GEMINI_API_KEY` | unset | Enables opt-in HBB proposal/explanation calls and legacy synthetic model calls. Keep it server-side. |

Use a private directory with restrictive filesystem permissions for the database
and any backups; SQLite files are not encrypted. The path may contain free-text
comments and exported records; never enter sensitive information. Protect or
remove copies and exports according to local policy. Back up with SQLite's backup
API or with the server stopped, rather than copying a live database. Do not
commit databases, Git notes, exports, or credentials. Git notes are unencrypted.
The default Git notes directory is ignored, but a custom location may not be.
Sending an AI research message sends the conversation and current sequence
to Google Gemini; model-generated search terms are sent to
Europe PMC. Selecting the published HbS example retrieves a public NCBI
record. The separate legacy APIs can also contact NCBI or Gemini.
Requesting a structure prediction sends the selected full protein sequence
to the configured provider (ESM Metagenomic Atlas by default, or Modal when
configured); comparison sends both sequences. If Modal automatic prediction is
explicitly enabled, saved sequences and selected comparisons are sent without
another click, including on page load. Modal GPU use may incur charges.
Review the provider's retention policy. Leaving the page or changing a selection
does not cancel a prediction already sent to the provider.
Notes are not sent; free-text questions can contain sensitive information,
which the application cannot reliably detect. Do not enter patient or other
sensitive information.
If a model key is configured, protect the environment and account.

The HTTP handler rejects non-loopback Host names (including DNS rebinding), rejects
cross-origin browser mutations, limits JSON request bodies, disables directory
listings, and sets browser security headers. Host and Origin checks are not
authentication: non-browser local clients can forge them. Browser and platform
behavior, resource exhaustion, third-party content and deployment environments
have not been comprehensively assessed. Review and redesign these controls before
any network deployment.
