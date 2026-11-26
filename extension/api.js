// SPDX-License-Identifier: GPL-2.0-or-later
import { AuthError, loadClaudeCredentials, loadCodexCredentials } from './auth.js';
import { HttpClient } from './http.js';
import { parseClaudeUsageResponse, parseResetCreditsResponse, parseSubscriptionResponse, parseUsageResponse, } from './model.js';
const CHATGPT_USAGE_URL = 'https://chatgpt.com/backend-api/wham/usage';
const CHATGPT_RESET_CREDITS_URL = 'https://chatgpt.com/backend-api/wham/rate-limit-reset-credits';
const CHATGPT_SUBSCRIPTION_URL = 'https://chatgpt.com/backend-api/subscriptions';
const CLAUDE_USAGE_URL = 'https://api.anthropic.com/api/oauth/usage';
const SUBSCRIPTION_CACHE_MS = 6 * 60 * 60 * 1000;
const USER_AGENT = 'chatgpt-usage-gnome/0.8.0';
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
/**
 * Shared status/JSON handling for a usage response. Returns the parsed JSON on
 * success, or a failure result.
 */
function checkResponse(response, authRejectedMessage) {
    if (response.status === 401 || response.status === 403)
        return { ok: false, result: failure('auth', authRejectedMessage) };
    if (response.status === 429) {
        return {
            ok: false,
            result: failure('rate-limit', 'Usage endpoint is rate limited.', parseRetryAfter(response.retryAfter)),
        };
    }
    if (response.status >= 500)
        return { ok: false, result: failure('server', `Usage service returned HTTP ${response.status}.`) };
    if (response.status < 200 || response.status >= 300)
        return { ok: false, result: failure('server', `Usage request failed with HTTP ${response.status}.`) };
    try {
        return { ok: true, json: JSON.parse(response.text) };
    }
    catch {
        return { ok: false, result: failure('invalid-response', 'Usage service returned invalid JSON.') };
    }
}
export class ChatGPTUsageApi {
    provider = 'chatgpt';
    http = new HttpClient();
    subscriptionCache = null;
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
            response = await this.http.request('GET', CHATGPT_USAGE_URL, headers);
        }
        catch {
            return failure('network', 'Network error while updating usage.');
        }
        const checked = checkResponse(response, 'Codex authentication was rejected. Run `codex login`.');
        if (!checked.ok)
            return checked.result;
        let usage;
        try {
            usage = parseUsageResponse(checked.json);
        }
        catch {
            return failure('invalid-response', 'Usage response format is not recognized.');
        }
        const [resetCreditsAvailable, subscription] = await Promise.all([
            usage.resetCreditsAvailable === null
                ? this.fetchResetCredits(headers)
                : Promise.resolve(usage.resetCreditsAvailable),
            this.fetchSubscription(credentials.accessToken, credentials.accountId),
        ]);
        return {
            ok: true,
            usage: {
                ...usage,
                resetCreditsAvailable: resetCreditsAvailable ?? usage.resetCreditsAvailable,
                planActiveUntilMs: subscription?.activeUntilMs ?? null,
                willRenew: subscription?.willRenew ?? null,
            },
        };
    }
    async fetchResetCredits(headers) {
        try {
            const response = await this.http.request('GET', CHATGPT_RESET_CREDITS_URL, headers);
            if (response.status < 200 || response.status >= 300)
                return null;
            return parseResetCreditsResponse(JSON.parse(response.text));
        }
        catch {
            return null;
        }
    }
    async fetchSubscription(accessToken, accountId) {
        if (accountId === null)
            return null;
        const nowMs = Date.now();
        if (this.subscriptionCache?.accountId === accountId &&
            nowMs - this.subscriptionCache.fetchedAtMs < SUBSCRIPTION_CACHE_MS) {
            return this.subscriptionCache.info;
        }
        const headers = {
            Authorization: `Bearer ${accessToken}`,
            Accept: 'application/json',
            'ChatGPT-Account-Id': accountId,
            'OpenAI-Beta': 'codex-1',
            Originator: 'Codex Desktop',
            'User-Agent': USER_AGENT,
        };
        try {
            const url = `${CHATGPT_SUBSCRIPTION_URL}?account_id=${encodeURIComponent(accountId)}`;
            const response = await this.http.request('GET', url, headers, true);
            if (response.status < 200 || response.status >= 300)
                return null;
            const info = parseSubscriptionResponse(JSON.parse(response.text));
            if (info !== null)
                this.subscriptionCache = { accountId, fetchedAtMs: nowMs, info };
            return info;
        }
        catch {
            return null;
        }
    }
    dispose() {
        this.http.dispose();
    }
}
export class ClaudeUsageApi {
    provider = 'claude';
    http = new HttpClient();
    async fetch() {
        let credentials;
        try {
            credentials = await loadClaudeCredentials();
        }
        catch (error) {
            if (error instanceof AuthError)
                return failure('auth', error.message);
            return failure('auth', 'Unable to load Claude authentication.');
        }
        const headers = {
            Authorization: `Bearer ${credentials.accessToken}`,
            Accept: 'application/json',
            'anthropic-beta': 'oauth-2025-04-20',
            'User-Agent': USER_AGENT,
        };
        let response;
        try {
            response = await this.http.request('GET', CLAUDE_USAGE_URL, headers);
        }
        catch {
            return failure('network', 'Network error while updating usage.');
        }
        const checked = checkResponse(response, 'Claude authentication was rejected. Open Claude Code to sign in again.');
        if (!checked.ok)
            return checked.result;
        try {
            return {
                ok: true,
                usage: parseClaudeUsageResponse(checked.json, credentials.subscriptionType),
            };
        }
        catch {
            return failure('invalid-response', 'Usage response format is not recognized.');
        }
    }
    dispose() {
        this.http.dispose();
    }
}
export function createUsageSource(provider) {
    return provider === 'claude' ? new ClaudeUsageApi() : new ChatGPTUsageApi();
}
