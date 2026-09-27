# ChatGPT Usage — GNOME Shell

An internal GNOME Shell extension for showing ChatGPT/Codex subscription usage in the top bar with a polished, first-party-inspired presentation.

> This is an internal team tool and is not an official OpenAI product.

```text
[ChatGPT icon]  5h 82% · W 97%
```

Click the indicator to see the 5-hour and weekly windows, progress bars, reset countdowns, update state, and manual refresh.

## What it does

- Uses the existing Codex login; no second authentication flow.
- Reads `$CODEX_HOME/auth.json`, `~/.codex/auth.json`, or `~/.config/codex/auth.json`.
- Talks directly from GNOME Shell to `chatgpt.com`.
- Stores no tokens, usage history, analytics, or telemetry.
- Runs no daemon, helper server, Node.js runtime, Python process, or Rust process.
- Supports GNOME Shell 46–50.

## Polling

Idle polling is **60 seconds**. When fresh consumption is detected in either quota window, the extension temporarily becomes more responsive:

```text
8s → 13s → 21s → 34s → 55s → 60s idle
```

Any new consumption restarts the sequence at 8 seconds. A quota reset is not treated as activity.

The extension also refreshes immediately on startup, after resume, at a known reset boundary, and when the popup is opened with stale data. Failures back off to 60s → 120s → 240s → 300s, and HTTP 429 honors `Retry-After`.

## Install

```bash
curl --proto '=https' --tlsv1.2 -fsSL https://raw.githubusercontent.com/samasama99/chatgpt-usage-gnome/main/install.sh | bash
```

The installer replaces the temporary `Quota Monitor` build automatically and installs:

```text
~/.local/share/gnome-shell/extensions/chatgpt-usage@samasama99/
```

No root access is required.

## Development

```bash
npm install --ignore-scripts
npm run check
npm run pack:extension
```

TypeScript is development-only. The runtime is plain readable GJS JavaScript plus the stylesheet, metadata, license, and icon asset.

## Security

The authenticated request is fixed to:

```text
GET https://chatgpt.com/backend-api/wham/usage
```

Authenticated HTTP redirects are refused. Tokens are never logged or persisted by the extension.

See [SECURITY.md](SECURITY.md) for the threat model.

## License

GPL-2.0-or-later
