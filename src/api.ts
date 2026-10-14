// SPDX-License-Identifier: GPL-2.0-or-later

import {AuthError, loadCodexCredentials} from './auth.js';
import {HttpClient} from './http.js';
import {
    parseResetCreditsResponse,
    parseSubscriptionResponse,
    parseUsageResponse,
    type UsageSnapshot,
} from './model.js';

const USAGE_URL = 'https://chatgpt.com/backend-api/wham/usage';
const RESET_CREDITS_URL = 'https://chatgpt.com/backend-api/wham/rate-limit-reset-credits';
const SUBSCRIPTION_URL = 'https://chatgpt.com/backend-api/subscriptions';
const SUBSCRIPTION_CACHE_MS = 6 * 60 * 60 * 1000;
const USER_AGENT = 'chatgpt-usage-gnome/0.6.1';

export type FetchErrorKind = 'auth' | 'rate-limit' | 'network' | 'server' | 'invalid-response';

export interface FetchFailure {
    readonly kind: FetchErrorKind;
    readonly message: string;
    readonly retryAfterSeconds: number | null;
}

export type FetchResult =
    | {readonly ok: true; readonly usage: UsageSnapshot}
    | {readonly ok: false; readonly error: FetchFailure};

function parseRetryAfter(value: string | null): number | null {
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

function failure(kind: FetchErrorKind, message: string, retryAfterSeconds: number | null = null): FetchResult {
    return {ok: false, error: {kind, message, retryAfterSeconds}};
}

export class UsageApi {
    private readonly http = new HttpClient();
    private subscriptionCache: {
        readonly accountId: string;
        readonly fetchedAtMs: number;
        readonly info: {readonly activeUntilMs: number; readonly willRenew: boolean | null};
    } | null = null;

    async fetch(): Promise<FetchResult> {
        let credentials;
        try {
            credentials = await loadCodexCredentials();
        } catch (error: unknown) {
            if (error instanceof AuthError)
                return failure('auth', error.message);
            return failure('auth', 'Unable to load Codex authentication.');
        }

        const headers: Record<string, string> = {
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
        } catch {
            return failure('network', 'Network error while updating usage.');
        }

        if (response.status === 401 || response.status === 403)
            return failure('auth', 'Codex authentication was rejected. Run `codex login`.');

        if (response.status === 429) {
            return failure(
                'rate-limit',
                'Usage endpoint is rate limited.',
                parseRetryAfter(response.retryAfter),
            );
        }

        if (response.status >= 500)
            return failure('server', `Usage service returned HTTP ${response.status}.`);

        if (response.status < 200 || response.status >= 300)
            return failure('server', `Usage request failed with HTTP ${response.status}.`);

        let json: unknown;
        try {
            json = JSON.parse(response.text) as unknown;
        } catch {
            return failure('invalid-response', 'Usage service returned invalid JSON.');
        }

        let usage: UsageSnapshot;
        try {
            usage = parseUsageResponse(json);
        } catch {
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

    private async fetchResetCredits(
        headers: Readonly<Record<string, string>>,
    ): Promise<number | null> {
        try {
            const response = await this.http.request('GET', RESET_CREDITS_URL, headers);
            if (response.status < 200 || response.status >= 300)
                return null;
            return parseResetCreditsResponse(JSON.parse(response.text) as unknown);
        } catch {
            return null;
        }
    }

    private async fetchSubscription(
        accessToken: string,
        accountId: string | null,
    ): Promise<{readonly activeUntilMs: number; readonly willRenew: boolean | null} | null> {
        if (accountId === null)
            return null;

        const nowMs = Date.now();
        if (this.subscriptionCache?.accountId === accountId &&
            nowMs - this.subscriptionCache.fetchedAtMs < SUBSCRIPTION_CACHE_MS) {
            return this.subscriptionCache.info;
        }

        const headers: Record<string, string> = {
            Authorization: `Bearer ${accessToken}`,
            Accept: 'application/json',
            'ChatGPT-Account-Id': accountId,
            'OpenAI-Beta': 'codex-1',
            Originator: 'Codex Desktop',
            'User-Agent': USER_AGENT,
        };

        try {
            const url = `${SUBSCRIPTION_URL}?account_id=${encodeURIComponent(accountId)}`;
            const response = await this.http.request('GET', url, headers, true);
            if (response.status < 200 || response.status >= 300)
                return null;
            const info = parseSubscriptionResponse(JSON.parse(response.text) as unknown);
            if (info !== null)
                this.subscriptionCache = {accountId, fetchedAtMs: nowMs, info};
            return info;
        } catch {
            return null;
        }
    }

    dispose(): void {
        this.http.dispose();
    }
}
