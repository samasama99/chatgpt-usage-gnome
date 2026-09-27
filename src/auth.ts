// SPDX-License-Identifier: GPL-2.0-or-later

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

Gio._promisify(Gio.File.prototype, 'load_contents_async', 'load_contents_finish');

export interface CodexCredentials {
    readonly accessToken: string;
    readonly accountId: string | null;
}

export class AuthError extends Error {
    override readonly name = 'AuthError';
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function candidateAuthPaths(): readonly string[] {
    const home = GLib.get_home_dir();
    const codexHome = (GLib.getenv('CODEX_HOME') ?? '').trim();

    const candidates = [
        codexHome ? GLib.build_filenamev([codexHome, 'auth.json']) : '',
        GLib.build_filenamev([home, '.codex', 'auth.json']),
        GLib.build_filenamev([home, '.config', 'codex', 'auth.json']),
    ].filter(path => path.length > 0);

    return [...new Set(candidates)];
}

function firstExistingAuthPath(): string {
    for (const path of candidateAuthPaths()) {
        if (GLib.file_test(path, GLib.FileTest.IS_REGULAR))
            return path;
    }

    throw new AuthError('Codex login not found. Run `codex login`.');
}

async function readJson(path: string): Promise<unknown> {
    let contents: Uint8Array;
    try {
        const [bytes] = await Gio.File.new_for_path(path).load_contents_async(null);
        contents = bytes;
    } catch {
        throw new AuthError(`Cannot read Codex authentication file: ${path}`);
    }

    try {
        return JSON.parse(new TextDecoder().decode(contents)) as unknown;
    } catch {
        throw new AuthError('Codex authentication file is not valid JSON.');
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
    const path = firstExistingAuthPath();
    const json = await readJson(path);
    return parseCodexCredentials(json);
}
