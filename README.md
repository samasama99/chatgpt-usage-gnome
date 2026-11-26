# AI Usage — GNOME Shell

An internal GNOME Shell extension that shows **ChatGPT/Codex** and **Claude** subscription usage in the top bar, with a neutral GNOME-style look.

> This is an internal team tool and is not an official OpenAI or Anthropic product.

```text
[gauge]  5h 82% · W 97%                              # one subscription
[gauge]  GPT 5h 82% · W 97%   Claude 5h 64% · W 91%  # both
```

Click the indicator to see the 5-hour and weekly windows for each subscription, progress bars, reset countdowns, available reset credits, subscription renewal metadata when available, local coding activity, API-equivalent cost estimates, update state, and manual refresh.

## What it does

- Uses your existing Codex and Claude Code logins; no second authentication flow.
- ChatGPT: reads `$CODEX_HOME/auth.json`, `~/.codex/auth.json`, or `~/.config/codex/auth.json` and talks to `chatgpt.com`.
- Claude: reads `$CLAUDE_CONFIG_DIR/.credentials.json` or `~/.claude/.credentials.json` and talks to `api.anthropic.com`. The token is only read and never refreshed. If it expires, open Claude Code once to refresh it.
- Stores no tokens, usage history, analytics, or telemetry.
- Runs no daemon or helper server. If OpenCode is installed, the popup may invoke `opencode stats` with fixed arguments to read its local 7-day model totals.
- Supports GNOME Shell 46–51.

## Preferences

Open **Settings** from the extension popup, or run:

```bash
gnome-extensions prefs chatgpt-usage@samasama99
```

Available options:

- **Show usage for** — `Automatic` (every service you are signed in to), `ChatGPT`, `Claude`, or both.
- **Show panel icon** — hide the panel icon and keep only the usage text.
- **Panel position** — `Left` places it before the workspace controls, `Right` places it after them, and `Center` moves it to the middle of the panel.
- **Panel background** — enable a rounded colored background behind the indicator and choose a `#RRGGBB` color.
- **Show local coding activity** — hide the local Codex/Claude Code/OpenCode section and completely skip local session scanning / OpenCode stats while disabled.

Settings apply live; the extension does not need to be restarted.

## Polling

Each subscription is polled independently. Idle polling is **60 seconds**. When fresh consumption is detected in either quota window, the extension temporarily becomes more responsive:

```text
8s → 13s → 21s → 34s → 55s → 60s idle
```

Any new consumption restarts the sequence at 8 seconds. A quota reset is not treated as activity.

The extension also refreshes immediately on startup, after resume, at a known reset boundary, and when the popup is opened with stale data. Failures back off to 60s → 120s → 240s → 300s, and HTTP 429 honors `Retry-After`.

## Local model activity

When the popup opens, the extension shows a 7-day **Local model activity** breakdown. It combines:

- Codex rollout metadata from `$CODEX_HOME/sessions` or `~/.codex/sessions` (when ChatGPT is shown);
- Claude Code session metadata from `~/.claude/projects` (when Claude is shown);
- OpenAI and/or Anthropic model totals from OpenCode when an `opencode` executable is available.

OpenCode support uses the public `opencode stats --days 7 --models` command with a fixed argument vector (no shell). OpenCode providers for subscriptions that are not shown are ignored. The result is cached in memory for 60 seconds so repeatedly opening the popup does not repeatedly start OpenCode.

This section is intentionally labeled local. It is not an attribution of your subscription quota and it does not include web/mobile activity or activity from other computers.

For Codex, only timestamps, turn IDs, model names, and token counts are extracted. For Claude Code, only timestamps, message IDs, model names, and token counts are extracted. Prompts, responses, tool contents, and file contents are not displayed or sent anywhere. No activity database or persistent cache is created.

The popup also estimates what the locally observed token activity would cost at current **standard API token prices**. The estimate uses input/cached-input/cache-write/output token categories when those are available. It deliberately excludes tool-call fees, Fast/Ultrafast/Batch/Flex multipliers, regional premiums, long-context premiums, and the 1-hour cache-write premium. Models without a matching public API price are left unpriced and the UI shows partial pricing coverage rather than inventing a rate.

## Reset credits and billing date (ChatGPT only)

The normal usage response is used for the available reset-credit count when it exposes one. If it does not, the extension makes a best-effort read of the same internal reset-credit endpoint used by Codex surfaces. This is read-only; the extension does not redeem or consume resets.

The extension also makes a best-effort read of ChatGPT subscription metadata to show **Next billing** when the backend provides an active-until date and explicitly says the subscription will renew. If renewal is disabled it shows **Plan active until** instead. If reliable subscription metadata is unavailable, no billing date is shown.

Subscription metadata is cached for six hours so the normal 8–60 second quota polling never turns into repeated billing requests.

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

Authenticated requests are restricted to fixed `chatgpt.com` endpoints (usage, reset-credit metadata, subscription metadata) and one fixed `api.anthropic.com` endpoint (Claude usage). They are read-only, and each token is sent only to its own service. Authenticated HTTP redirects are refused, and tokens are never logged or persisted by the extension.

See [SECURITY.md](SECURITY.md) for the threat model.

## License

GPL-2.0-or-later
