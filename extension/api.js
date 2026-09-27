import { AuthError, loadCodexCredentials } from './auth.js';
import { HttpClient } from './http.js';
import { parseUsageResponse } from './model.js';
const USAGE_URL = 'https://chatgpt.com/backend-api/wham/usage';
const USER_AGENT = 'chatgpt-usage-gnome/0.1';
function parseRetryAfter(value) {
    if (value === null)
        return null;
    const numeric = Number(value);
    if (Number.isFinite(numeric) && numeric >= 0)
        return Math.ceil(numeric);
    const dateMs = Date.parse(value);
    if (Number.isFinite(dateMs))
        return Math.max(0, Math.ceil((dateMs - Date.now()) / 1000));
    return null;
}
function failure(kind, message, retryAfterSeconds = null) {
    return { ok: false, error: { kind, message, retryAfterSeconds } };
}
export class UsageApi {
    http = new HttpClient();
    async fetch() {
        let credentials;
        try {
            credentials = await loadCodexCredentials();
        }
        catch (error) {
            if (error instanceof AuthError)
                return failure('auth', error.message);
            return failure('auth', 'Unable to load Codex authentication.');
        }
        const headers = {
            Authorization: `Bearer ${credentials.accessToken}`,
            Accept: 'application/json',
            'User-Agent': USER_AGENT,
            Origin: 'https://chatgpt.com',
            Referer: 'https://chatgpt.com/',
        };
        if (credentials.accountId !== null)
            headers['ChatGPT-Account-Id'] = credentials.accountId;
        let response;
        try {
            response = await this.http.request('GET', USAGE_URL, headers);
        }
        catch {
            return failure('network', 'Network error while updating usage.');
        }
        if (response.status === 401 || response.status === 403)
            return failure('auth', 'Codex authentication was rejected. Run `codex login`.');
        if (response.status === 429)
            return failure('rate-limit', 'Usage endpoint is rate limited.', parseRetryAfter(response.retryAfter));
        if (response.status >= 500)
            return failure('server', `Usage service returned HTTP ${response.status}.`);
        if (response.status < 200 || response.status >= 300)
            return failure('server', `Usage request failed with HTTP ${response.status}.`);
        let json;
        try {
            json = JSON.parse(response.text);
        }
        catch {
            return failure('invalid-response', 'Usage service returned invalid JSON.');
        }
        try {
            return { ok: true, usage: parseUsageResponse(json) };
        }
        catch {
            return failure('invalid-response', 'Usage response format is not recognized.');
        }
    }
    dispose() {
        this.http.dispose();
    }
}
