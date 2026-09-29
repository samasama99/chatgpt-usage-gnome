# Security

ChatGPT Usage handles a ChatGPT/Codex OAuth access token, so its security model is intentionally small.

## Runtime behavior

The extension:

- reads the existing Codex auth file;
- extracts only the access token and optional account ID needed for the usage request;
- sends authenticated requests only to `https://chatgpt.com/backend-api/wham/usage`;
- refuses HTTP redirects for authenticated requests;
- disables libsoup's authentication cache;
- never writes, refreshes, copies, persists, or logs OAuth credentials;
- runs no daemon or helper server; when OpenCode is installed, it may start `opencode stats` with a fixed argument vector while the popup is open;
- sends no intentional analytics or telemetry.

## Local session metadata

The optional model-activity section reads recent Codex rollout JSONL files under `$CODEX_HOME/sessions` or `~/.codex/sessions` only when the popup is opened.

The Codex parser extracts only:

- rollout timestamps;
- turn IDs and model names from `turn_context` records;
- response token totals from `token_usage_record` records.

If `opencode` is available on the desktop session's PATH, the extension may also execute `opencode stats --days 7 --models` directly through `Gio.Subprocess`. It does not invoke a shell, pass user-controlled arguments, or expose ChatGPT credentials to that process. Only OpenAI/ChatGPT model names and aggregate token totals from stdout are merged into the local view.

Prompt text, assistant responses, tool arguments/results, shell output, and workspace contents are not displayed or transmitted by the extension. Derived local totals remain in memory and are never sent to ChatGPT.

## Trust boundary

The extension trusts the local GNOME user session, the local Codex credential file, the operating-system TLS stack, and `chatgpt.com`.

A malicious process already running as the same desktop user can generally read the same credential file, so this extension is not intended to defend against a compromised user session.

The usage endpoint is internal rather than a documented public API. Response data is validated before reaching the UI.

## Credential hygiene

Do not commit `auth.json`, `.env` files, private keys, exported cookies, or copied OAuth/API tokens.

Typical local permission:

```bash
chmod 600 ~/.codex/auth.json
```

## Supply chain

End users install the prebuilt JavaScript under `extension/`; npm is not required at runtime. Development dependencies are pinned to exact top-level versions. CI runs with read-only repository permissions and installs development dependencies with lifecycle scripts disabled.

For the most conservative workflow, inspect a reviewed commit or release before installing instead of piping a mutable branch into a shell.

## Reporting

Do not post active credentials or exploit details in a public issue. Contact the maintainer privately for sensitive reports.
