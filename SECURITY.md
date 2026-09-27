# Security

Quota Monitor handles a ChatGPT/Codex OAuth access token, so its security model is intentionally small.

## Runtime behavior

The extension:

- reads the existing Codex auth file;
- extracts only the access token and optional account ID needed for usage;
- sends authenticated requests only to `https://chatgpt.com/backend-api/wham/usage`;
- refuses HTTP redirects for authenticated requests;
- disables libsoup's authentication cache;
- never writes, refreshes, copies, persists, or logs OAuth credentials;
- runs no daemon, helper server, Node.js runtime, Python process, or Rust process;
- sends no intentional analytics or telemetry.

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

Do not post active credentials or exploit details in a public issue. Use GitHub private vulnerability reporting when enabled, or contact the maintainer privately.
