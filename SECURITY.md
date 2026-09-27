# Security

This extension handles a ChatGPT/Codex OAuth access token, so its security model is intentionally small and explicit.

## Runtime behavior

The extension:

- reads the existing Codex authentication file from `$CODEX_HOME/auth.json`, `~/.codex/auth.json`, or `~/.config/codex/auth.json`;
- extracts only the access token and optional ChatGPT account ID required for the usage request;
- sends authenticated requests only to `https://chatgpt.com/backend-api/wham/usage`;
- refuses HTTP redirects for authenticated requests;
- does not write, refresh, copy, persist, or log OAuth credentials;
- does not run a daemon, helper server, Node.js runtime, Python process, or Rust process at runtime;
- does not intentionally contact analytics, telemetry, advertising, or other third-party services.

## Trust boundary

The extension trusts:

- the local GNOME Shell user session;
- the local Codex credential file;
- the operating system TLS trust store and networking stack;
- `chatgpt.com` for the usage endpoint.

A process that can already read files or memory as the same desktop user can usually access the same Codex credentials independently of this extension. The extension is not intended to defend against a compromised user session.

The usage endpoint is an internal ChatGPT/Codex endpoint rather than a documented public API. Response data is treated as untrusted JSON and validated before it reaches the UI.

## Credential hygiene

Do not commit:

- `auth.json`;
- `.env` files;
- private keys or certificates containing private keys;
- exported cookies or browser session data;
- copied OAuth or API tokens.

The repository includes ignore rules to reduce the chance of accidentally committing these files.

Users should keep the Codex auth file private to their local account. A typical Linux permission is:

```bash
chmod 600 ~/.codex/auth.json
```

## Supply-chain notes

End users install the prebuilt JavaScript stored under `extension/`; they do not need npm at runtime.

For the most conservative workflow, inspect a reviewed commit or release before installing it rather than piping a mutable branch directly into a shell.

## Reporting a vulnerability

Do not put active credentials, tokens, exploit payloads, or other sensitive data in a public issue.

If private vulnerability reporting is enabled for this repository, use the repository Security tab. Otherwise contact the maintainer privately through their GitHub profile.
