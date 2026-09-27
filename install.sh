#!/usr/bin/env bash
set -euo pipefail

UUID='chatgpt-usage@samasama99'
REPO_SLUG='samasama99/chatgpt-usage-gnome'
BRANCH='main'
SUPPORTED_MIN=46
SUPPORTED_MAX=50
DEST="${XDG_DATA_HOME:-$HOME/.local/share}/gnome-shell/extensions/$UUID"

say() { printf '%s\n' "$*"; }
die() { printf 'error: %s\n' "$*" >&2; exit 1; }

command -v gnome-shell >/dev/null 2>&1 || die 'gnome-shell was not found.'
command -v gnome-extensions >/dev/null 2>&1 || die 'gnome-extensions was not found.'

shell_version="$(gnome-shell --version 2>/dev/null || true)"
major="$(printf '%s' "$shell_version" | sed -nE 's/.* ([0-9]+)(\.[0-9]+)*/\1/p')"
[[ "$major" =~ ^[0-9]+$ ]] || die "could not detect GNOME Shell version from: $shell_version"

if (( major < SUPPORTED_MIN || major > SUPPORTED_MAX )); then
    die "GNOME Shell $major is unsupported; this extension supports $SUPPORTED_MIN-$SUPPORTED_MAX."
fi

SCRIPT_DIR=''
if [[ -n "${BASH_SOURCE[0]:-}" && -f "${BASH_SOURCE[0]}" ]]; then
    SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
fi

TMP=''
cleanup() {
    if [[ -n "$TMP" && -d "$TMP" ]]; then
        rm -rf -- "$TMP"
    fi
}
trap cleanup EXIT

if [[ -n "$SCRIPT_DIR" && -f "$SCRIPT_DIR/extension/metadata.json" ]]; then
    SOURCE="$SCRIPT_DIR/extension"
else
    command -v curl >/dev/null 2>&1 || die 'curl is required for remote installation.'
    command -v tar >/dev/null 2>&1 || die 'tar is required for remote installation.'

    TMP="$(mktemp -d)"
    archive="$TMP/source.tar.gz"
    url="https://github.com/$REPO_SLUG/archive/refs/heads/$BRANCH.tar.gz"
    say "Downloading $REPO_SLUG..."
    curl -fsSL "$url" -o "$archive"
    tar -xzf "$archive" -C "$TMP"
    SOURCE="$TMP/chatgpt-usage-gnome-$BRANCH/extension"
    [[ -f "$SOURCE/metadata.json" ]] || die 'downloaded repository does not contain a prebuilt extension.'
fi

rm -rf -- "$DEST"
mkdir -p -- "$DEST"
cp -a -- "$SOURCE/." "$DEST/"

# Auth is intentionally not installed or modified by this script.
codex_home="${CODEX_HOME:-$HOME/.codex}"
if [[ ! -f "$codex_home/auth.json" && ! -f "$HOME/.config/codex/auth.json" ]]; then
    say 'warning: Codex login was not found. Run `codex login` before using the extension.'
fi

if gnome-extensions enable "$UUID" >/dev/null 2>&1; then
    say "Installed and enabled ChatGPT Usage for GNOME Shell $major."
else
    say "Installed ChatGPT Usage for GNOME Shell $major."
    say "GNOME has not loaded this new extension yet. Log out and back in once, then run:"
    say "  gnome-extensions enable $UUID"
fi
