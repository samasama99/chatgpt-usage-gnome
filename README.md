# ChatGPT Usage — GNOME Shell

A small, auditable GNOME Shell extension that shows your ChatGPT/Codex usage limits in the top bar.

```text
5h 82% · W 97%
```

Click it to see the 5-hour and weekly windows, their reset countdowns, update age, errors, and a manual refresh action.

## Design goals

- **No extra login.** Reads the existing Codex CLI/Desktop OAuth file.
- **No server or daemon.** GNOME Shell talks directly to `chatgpt.com`.
- **No runtime dependencies.** No Node, npm, Python, Rust, curl, or helper process after installation.
- **No token storage.** Credentials are read for each request and never copied, written, logged, or persisted by the extension.
- **Small runtime state.** One panel button, one popup, one HTTP session, one one-shot poll timer, and one normalized usage snapshot.
- **TypeScript source.** Strict internal types plus runtime validation of untrusted JSON.
- **Modern GNOME only.** GNOME Shell 46–50. GNOME 42 is intentionally unsupported.

## Authentication

The extension looks for Codex auth in this order:

1. `$CODEX_HOME/auth.json` when `CODEX_HOME` is visible to the GNOME session
2. `~/.codex/auth.json`
3. `~/.config/codex/auth.json`

Run this once if needed:

```bash
codex login
```

The extension never refreshes or rewrites OAuth tokens. Codex owns the login lifecycle.

## Polling behavior

The short 5-hour window drives refresh frequency:

- startup: immediate request
- normal/idle: every **60 seconds**
- when 5-hour usage changes: every **15 seconds**
- fast mode lasts until **90 seconds after the most recent 5-hour change**
- weekly-only changes update the UI but do **not** trigger fast mode
- opening the popup refreshes if the last success is older than **15 seconds**
- resume from suspend: immediate refresh
- known reset time reached: refresh at the reset rather than waiting for the normal timer
- failures: 60s → 120s → 240s → 300s backoff
- HTTP 429 honors `Retry-After` when present

The 5-hour and weekly limits come from the same request, so there is no second weekly network timer. Weekly is updated whenever usage is fetched, at zero additional request cost.

The reset countdown is recomputed locally once per minute **only while the popup is open**.

## One-line install

```bash
curl -fsSL https://raw.githubusercontent.com/samasama99/chatgpt-usage-gnome/main/install.sh | bash
```

The installer:

- requires no root
- accepts GNOME Shell 46–50 only
- downloads the prebuilt runtime files
- installs to `~/.local/share/gnome-shell/extensions/chatgpt-usage@samasama99/`
- tries to enable the extension
- does not install or modify Codex

On a first install under a Wayland GNOME session, GNOME may not discover a brand-new extension until you log out and back in once. The installer prints the enable command if that is required.

### Install from a local clone

```bash
git clone https://github.com/samasama99/chatgpt-usage-gnome.git
cd chatgpt-usage-gnome
./install.sh
```

No build tools are needed because the repository contains the prebuilt `extension/` directory.

## Development

TypeScript and GNOME type packages are development-only dependencies:

```bash
npm install
npm run check
```

Build runtime files:

```bash
npm run build
```

Package an extension zip:

```bash
npm run pack:extension
```

The installed/runtime extension contains only JavaScript, metadata, and a tiny stylesheet.

## Source layout

```text
src/
  extension.ts   lifecycle + suspend/resume hook
  ui.ts          panel and popup
  poller.ts      one-shot adaptive scheduling
  api.ts         usage request and error classification
  http.ts        small libsoup 3 wrapper
  auth.ts        read-only Codex auth loading
  model.ts       runtime response validation + formatting
  schedule.ts    pure timing policy

extension/       prebuilt files installed on user machines
tests/           Node tests for pure parsing/scheduling logic
```

## Network and privacy

The extension makes only this usage request:

```text
GET https://chatgpt.com/backend-api/wham/usage
```

Authentication is inherited from Codex using the local OAuth access token and, when present, the ChatGPT account ID.

The endpoint is an internal ChatGPT/Codex endpoint rather than a documented public API. `model.ts` deliberately isolates and validates its response shape so an upstream format change becomes a clean UI error instead of a Shell crash.

Nothing is sent to third parties. Tokens are never logged.

## Panel position

The indicator is added at position `0` of GNOME's right panel box, placing it near the center side of the system-status area. Change this line in `src/extension.ts` if you prefer another position:

```ts
Main.panel.addToStatusArea(this.uuid, this.indicator.button, 0, 'right');
```

## GNOME compatibility

`metadata.json` declares GNOME Shell 46, 47, 48, 49, and 50. The UI includes the small `St.BoxLayout` compatibility difference between GNOME 46/47 and GNOME 48+.

Before publishing a release, manually smoke-test at least one GNOME 46 machine and one GNOME 50 machine because GNOME extensions execute inside Shell and cannot be fully runtime-tested in a generic build container.

## License

MIT
