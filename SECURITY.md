# Security

AI Usage handles ChatGPT/Codex and Claude Code OAuth access tokens, so its security model is intentionally small.

## Runtime behavior

The extension:

- reads the existing Codex auth file and/or Claude Code credential file (`~/.claude/.credentials.json`);
- extracts only the access token (plus the optional ChatGPT account ID and Claude plan name) needed for the usage request;
- sends authenticated read-only requests only to fixed `chatgpt.com` usage/reset/subscription endpoints and the fixed `api.anthropic.com/api/oauth/usage` endpoint. Each token goes only to its own service;
- uses the primary usage payload for reset counts when possible and only falls back to the reset-credit endpoint when the count is absent;
- caches subscription metadata for six hours to avoid attaching sensitive credentials to unnecessary repeated requests;
- refuses HTTP redirects for authenticated requests;
- disables libsoup's authentication cache;
- never writes, refreshes, copies, persists, or logs OAuth credentials;
- runs no daemon or helper server; when OpenCode is installed, it may start `opencode stats` with a fixed argument vector while the popup is open;
- sends no intentional analytics or telemetry.

## Local session metadata

The optional model-activity section reads recent Codex rollout JSONL files under `$CODEX_HOME/sessions` or `~/.codex/sessions`, and recent Claude Code session JSONL files under `~/.claude/projects`, only when the popup is opened.

The Claude Code parser extracts only timestamps, message IDs, model names, and token counts from assistant messages.

The Codex parser extracts only:

- rollout timestamps;
- turn IDs and model names from `turn_context` records;
- response token totals from `token_usage_record` records.

If `opencode` is available on the desktop session's PATH, the extension may also execute `opencode stats --days 7 --models` directly through `Gio.Subprocess`. It does not invoke a shell, pass user-controlled arguments, or expose credentials to that process. Only model names and aggregate token totals for the shown subscriptions (OpenAI and/or Anthropic) are merged into the local view.

Prompt text, assistant responses, tool arguments/results, shell output, and workspace contents are not displayed or transmitted by the extension. Derived local totals remain in memory and are never sent anywhere.

## Trust boundary

The extension trusts the local GNOME user session, the local Codex and Claude Code credential files, the operating-system TLS stack, `chatgpt.com`, and `api.anthropic.com`.

A malicious process already running as the same desktop user can generally read the same credential file, so this extension is not intended to defend against a compromised user session.

The ChatGPT usage/reset/subscription endpoints and the Claude OAuth usage endpoint are internal rather than documented public APIs. Response data is validated before reaching the UI; optional metadata failures are treated as unavailable and do not break the main usage display.

## Credential hygiene

Do not commit `auth.json`, `.env` files, private keys, exported cookies, or copied OAuth/API tokens.

Typical local permission:

```bash
chmod 600 ~/.codex/auth.json ~/.claude/.credentials.json
```

## Supply chain

End users install the prebuilt JavaScript under `extension/`; npm is not required at runtime. Development dependencies are pinned to exact top-level versions. CI runs with read-only repository permissions and installs development dependencies with lifecycle scripts disabled.

For the most conservative workflow, inspect a reviewed commit or release before installing instead of piping a mutable branch into a shell.

## Reporting

Do not post active credentials or exploit details in a public issue. Contact the maintainer privately for sensitive reports.
