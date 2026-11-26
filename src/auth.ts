// SPDX-License-Identifier: GPL-2.0-or-later

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

Gio._promisify(Gio.File.prototype, 'load_contents_async', 'load_contents_finish');

export interface CodexCredentials {
    readonly accessToken: string;
    readonly accountId: string | null;
}

export interface ClaudeCredentials {
    readonly accessToken: string;
    readonly expiresAtMs: number | null;
    readonly subscriptionType: string | null;
}

export class AuthError extends Error {
    override readonly name = 'AuthError';
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function unique(paths: readonly string[]): readonly string[] {
    return [...new Set(paths.filter(path => path.length > 0))];
}

function codexAuthPaths(): readonly string[] {
    const home = GLib.get_home_dir();
    const codexHome = (GLib.getenv('CODEX_HOME') ?? '').trim();

    return unique([
        codexHome ? GLib.build_filenamev([codexHome, 'auth.json']) : '',
        GLib.build_filenamev([home, '.codex', 'auth.json']),
        GLib.build_filenamev([home, '.config', 'codex', 'auth.json']),
    ]);
}

function claudeCredentialPaths(): readonly string[] {
    const configDir = (GLib.getenv('CLAUDE_CONFIG_DIR') ?? '').trim();

    return unique([
        configDir ? GLib.build_filenamev([configDir, '.credentials.json']) : '',
        GLib.build_filenamev([GLib.get_home_dir(), '.claude', '.credentials.json']),
    ]);
}

function firstExisting(paths: readonly string[]): string | null {
    for (const path of paths) {
        if (GLib.file_test(path, GLib.FileTest.IS_REGULAR))
            return path;
    }
    return null;
}

export function hasCodexLogin(): boolean {
    return firstExisting(codexAuthPaths()) !== null;
}

export function hasClaudeLogin(): boolean {
    return firstExisting(claudeCredentialPaths()) !== null;
}

async function readJson(path: string, label: string): Promise<unknown> {
    let contents: Uint8Array;
    try {
        const [bytes] = await Gio.File.new_for_path(path).load_contents_async(null);
        contents = bytes;
    } catch {
        throw new AuthError(`Cannot read ${label} credential file: ${path}`);
    }

    try {
        return JSON.parse(new TextDecoder().decode(contents)) as unknown;
    } catch {
        throw new AuthError(`${label} credential file is not valid JSON.`);
    }
}

function stringValue(record: Record<string, unknown>, keys: readonly string[]): string | null {
    for (const key of keys) {
        const value = record[key];
        if (typeof value === 'string' && value.trim())
            return value.trim();
    }
    return null;
}

export function parseCodexCredentials(value: unknown): CodexCredentials {
    if (!isRecord(value))
        throw new AuthError('Codex authentication file has an unexpected format.');

    const tokensValue = value.tokens;
    if (!isRecord(tokensValue))
        throw new AuthError('Codex OAuth tokens are missing. Run `codex login`.');

    const accessToken = stringValue(tokensValue, ['access_token', 'accessToken']);
    if (accessToken === null)
        throw new AuthError('Codex access token is missing. Run `codex login`.');

    const accountId = stringValue(tokensValue, ['account_id', 'accountId']);
    return {accessToken, accountId};
}

export async function loadCodexCredentials(): Promise<CodexCredentials> {
    const path = firstExisting(codexAuthPaths());
    if (path === null)
        throw new AuthError('Codex login not found. Run `codex login`.');
    return parseCodexCredentials(await readJson(path, 'Codex'));
}

/**
 * Parse Claude Code's OAuth credential file. The extension only reads the
 * access token: it never refreshes it, because rotating the refresh token
 * would sign Claude Code out.
 */
export function parseClaudeCredentials(value: unknown, nowMs = Date.now()): ClaudeCredentials {
    if (!isRecord(value) || !isRecord(value.claudeAiOauth))
        throw new AuthError('Claude subscription login not found. Run `claude` and sign in.');

    const oauth = value.claudeAiOauth;
    const accessToken = stringValue(oauth, ['accessToken', 'access_token']);
    if (accessToken === null)
        throw new AuthError('Claude access token is missing. Run `claude` and sign in.');

    const expiresAt = oauth.expiresAt;
    const expiresAtMs = typeof expiresAt === 'number' && Number.isFinite(expiresAt) && expiresAt > 0
        ? Math.trunc(expiresAt)
        : null;
    if (expiresAtMs !== null && expiresAtMs <= nowMs)
        throw new AuthError('Claude login expired. Open Claude Code once to refresh it.');

    return {
        accessToken,
        expiresAtMs,
        subscriptionType: stringValue(oauth, ['subscriptionType']),
    };
}

export async function loadClaudeCredentials(): Promise<ClaudeCredentials> {
    const path = firstExisting(claudeCredentialPaths());
    if (path === null)
        throw new AuthError('Claude login not found. Run `claude` and sign in.');
    return parseClaudeCredentials(await readJson(path, 'Claude'));
}
