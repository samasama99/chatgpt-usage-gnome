# Quota Monitor — GNOME Shell

A small, auditable GNOME Shell extension that shows ChatGPT/Codex subscription usage in the top bar.

```text
[icon]  5h 82% · W 97%
```

Click it for the 5-hour and weekly windows, thin progress bars, reset countdowns, update age, errors, and manual refresh.

## Design goals

- No extra login: reads the existing Codex OAuth file.
- No server or daemon: GNOME Shell talks directly to `chatgpt.com`.
- No runtime dependencies: no Node, npm, Python, Rust, curl, or helper process after installation.
- No token storage: credentials are read per request and never copied, written, logged, or persisted by the extension.
- Modern GNOME only: Shell 46–50.
- Store-oriented package: `extension/` contains only runtime files.

## Authentication

The extension looks for Codex auth in this order:

1. `$CODEX_HOME/auth.json`
2. `~/.codex/auth.json`
3. `~/.config/codex/auth.json`

Run `codex login` if needed. The extension never refreshes or rewrites OAuth tokens. Authenticated requests refuse redirects.

## Polling

Idle polling is **60 seconds**. When new consumption is detected in either quota window, polling progressively backs off:

```text
8s → 13s → 21s → 34s → 55s → 60s idle
```

Any new consumption restarts the sequence at 8 seconds. Quota resets do not count as activity: the scheduler watches for an increase in raw `used_percent`, not just any value change.

Other behavior:

- startup: immediate refresh
- popup open: refresh if last success is older than 15s
- resume from suspend: immediate refresh
- known reset time: wake at the reset
- failures: 60s → 120s → 240s → 300s
- HTTP 429: honor `Retry-After`

Both quota windows come from the same request, so weekly usage does not need a separate timer.

## Visual design

The panel stays compact: a small GNOME symbolic monitor icon plus `5h 82% · W 97%`.

The popup uses stronger percentage hierarchy and thin progress bars. Normal quota is blue, low quota gets a restrained warning state, and critical quota gets a danger state.

A generic GNOME symbolic icon is used instead of bundling third-party branded artwork, which keeps a future extensions.gnome.org submission simple and trademark-safe.

## Install

```bash
curl --proto '=https' --tlsv1.2 -fsSL https://raw.githubusercontent.com/samasama99/chatgpt-usage-gnome/main/install.sh | bash
```

The extension installs to:

```text
~/.local/share/gnome-shell/extensions/quota-monitor@samasama99.github.io/
```

The installer also removes this project's old `chatgpt-usage@samasama99` UUID if present, preventing duplicate indicators.

## Development

```bash
npm install --ignore-scripts
npm run check
npm run pack:store
```

The store package is built only from `extension/`.

## Store readiness

The runtime metadata uses the generic name **Quota Monitor**, UUID `quota-monitor@samasama99.github.io`, no deprecated `version` field, and stable Shell versions 46–50.

The project uses `GPL-2.0-or-later`. `npm run store-check` validates the submission directory before packaging.

Before an actual submission, smoke-test the exact ZIP on at least one GNOME 46 machine and one GNOME 50 machine.

## Security

The only authenticated network request is:

```text
GET https://chatgpt.com/backend-api/wham/usage
```

Tokens are never logged. See [SECURITY.md](SECURITY.md) for the threat model.

## License

GPL-2.0-or-later
