// SPDX-License-Identifier: GPL-2.0-or-later

export interface TokenBreakdown {
    readonly inputTokens: number;
    readonly cachedInputTokens: number;
    readonly cacheWriteInputTokens: number;
    readonly outputTokens: number;
    readonly totalTokens: number;
}

export interface ModelActivity extends TokenBreakdown {
    readonly model: string;
    readonly tokens: number;
    readonly sharePercent: number;
    readonly estimatedApiCostUsd: number | null;
}

export interface ModelActivitySnapshot {
    readonly models: readonly ModelActivity[];
    readonly totalTokens: number;
    readonly scannedAtMs: number;
    readonly windowDays: number;
    readonly sources: readonly string[];
    readonly estimatedApiCostUsd: number;
    readonly pricedTokens: number;
    readonly pricingCoveragePercent: number;
}

export interface TokenRecord extends TokenBreakdown {
    readonly timestampMs: number;
    readonly model: string;
    readonly tokens: number;
}

interface ApiPrice {
    readonly input: number;
    readonly cachedInput: number;
    readonly cacheWrite: number;
    readonly output: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;

// Standard, short-context API prices in USD per 1M text tokens.
// Last reviewed against OpenAI's public pricing on 2026-10-14.
const API_PRICES = new Map<string, ApiPrice>([
    ['gpt-6-astra', {input: 10, cachedInput: 1, cacheWrite: 12.5, output: 50}],
    ['gpt-6.1-sol', {input: 2, cachedInput: 0.1, cacheWrite: 2.5, output: 10}],
    ['gpt-6-sol', {input: 2, cachedInput: 0.2, cacheWrite: 2.5, output: 10}],
    ['gpt-6-luna', {input: 0.1, cachedInput: 0.01, cacheWrite: 0.125, output: 0.5}],
    ['gpt-5.6-sol', {input: 4, cachedInput: 0.4, cacheWrite: 5, output: 20}],
    ['gpt-5.6-terra', {input: 2, cachedInput: 0.2, cacheWrite: 2.5, output: 12}],
    ['gpt-5.6-luna', {input: 0.2, cachedInput: 0.02, cacheWrite: 0.25, output: 1.2}],
    ['gpt-5.3-codex', {input: 1.75, cachedInput: 0.175, cacheWrite: 1.75, output: 14}],
]);

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function finiteNumber(value: unknown): number | null {
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function nonNegativeInt(value: unknown): number {
    const parsed = finiteNumber(value);
    return parsed === null ? 0 : Math.max(0, Math.trunc(parsed));
}

function emptyBreakdown(): TokenBreakdown {
    return {
        inputTokens: 0,
        cachedInputTokens: 0,
        cacheWriteInputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
    };
}

function addBreakdown(target: TokenBreakdown, value: TokenBreakdown): TokenBreakdown {
    return {
        inputTokens: target.inputTokens + value.inputTokens,
        cachedInputTokens: target.cachedInputTokens + value.cachedInputTokens,
        cacheWriteInputTokens: target.cacheWriteInputTokens + value.cacheWriteInputTokens,
        outputTokens: target.outputTokens + value.outputTokens,
        totalTokens: target.totalTokens + value.totalTokens,
    };
}

function normalizedBreakdown(value: Partial<TokenBreakdown> & {tokens?: number}): TokenBreakdown {
    const totalTokens = Math.max(0, Math.trunc(value.totalTokens ?? value.tokens ?? 0));
    const inputTokens = Math.max(0, Math.trunc(value.inputTokens ?? totalTokens));
    return {
        inputTokens,
        cachedInputTokens: Math.max(0, Math.trunc(value.cachedInputTokens ?? 0)),
        cacheWriteInputTokens: Math.max(0, Math.trunc(value.cacheWriteInputTokens ?? 0)),
        outputTokens: Math.max(0, Math.trunc(value.outputTokens ?? 0)),
        totalTokens,
    };
}

function lineItem(value: unknown): Record<string, unknown> | null {
    if (!isRecord(value))
        return null;
    if (typeof value.type === 'string')
        return value;
    return isRecord(value.item) ? value.item : null;
}

function lineTimestampMs(value: unknown): number | null {
    if (!isRecord(value) || typeof value.timestamp !== 'string')
        return null;
    const parsed = Date.parse(value.timestamp);
    return Number.isFinite(parsed) ? parsed : null;
}

function usageBreakdown(value: Record<string, unknown>): TokenBreakdown {
    const total = nonNegativeInt(value.total_tokens);
    return {
        inputTokens: nonNegativeInt(value.input_tokens),
        cachedInputTokens: nonNegativeInt(value.cached_input_tokens),
        cacheWriteInputTokens: nonNegativeInt(value.cache_write_input_tokens),
        outputTokens: nonNegativeInt(value.output_tokens),
        totalTokens: total,
    };
}

export function estimateApiEquivalentCost(model: string, usage: TokenBreakdown): number | null {
    const price = API_PRICES.get(model.toLowerCase());
    if (!price)
        return null;

    const uncachedInput = Math.max(0, usage.inputTokens - usage.cachedInputTokens);
    return (
        uncachedInput * price.input +
        usage.cachedInputTokens * price.cachedInput +
        usage.cacheWriteInputTokens * price.cacheWrite +
        usage.outputTokens * price.output
    ) / 1_000_000;
}

export function parseCodexRollout(text: string): readonly TokenRecord[] {
    const turnModels = new Map<string, string>();
    const pending: Array<{timestampMs: number; turnId: string; usage: TokenBreakdown}> = [];

    for (const rawLine of text.split('\n')) {
        if (!rawLine.trim())
            continue;

        let value: unknown;
        try {
            value = JSON.parse(rawLine) as unknown;
        } catch {
            continue;
        }

        const item = lineItem(value);
        if (item === null || typeof item.type !== 'string' || !isRecord(item.payload))
            continue;

        const payload = item.payload;

        if (item.type === 'turn_context') {
            const turnId = payload.turn_id;
            const model = payload.model;
            if (typeof turnId === 'string' && turnId && typeof model === 'string' && model)
                turnModels.set(turnId, model);
            continue;
        }

        if (item.type !== 'token_usage_record')
            continue;

        const turnId = payload.turn_id;
        const usage = payload.usage;
        const timestampMs = lineTimestampMs(value);
        if (typeof turnId !== 'string' || !turnId || !isRecord(usage) || timestampMs === null)
            continue;

        const breakdown = usageBreakdown(usage);
        if (breakdown.totalTokens <= 0)
            continue;

        pending.push({timestampMs, turnId, usage: breakdown});
    }

    return pending.flatMap(record => {
        const model = turnModels.get(record.turnId);
        return model ? [{
            timestampMs: record.timestampMs,
            model,
            tokens: record.usage.totalTokens,
            ...record.usage,
        }] : [];
    });
}

function modelsFromTotals(
    totals: ReadonlyMap<string, TokenBreakdown>,
    totalTokens: number,
): readonly ModelActivity[] {
    return [...totals.entries()]
        .map(([model, usage]) => ({
            model,
            tokens: usage.totalTokens,
            ...usage,
            sharePercent: totalTokens > 0 ? usage.totalTokens / totalTokens * 100 : 0,
            estimatedApiCostUsd: estimateApiEquivalentCost(model, usage),
        }))
        .sort((a, b) => b.tokens - a.tokens || a.model.localeCompare(b.model));
}

function pricingSummary(models: readonly ModelActivity[]): {
    estimatedApiCostUsd: number;
    pricedTokens: number;
    pricingCoveragePercent: number;
} {
    const estimatedApiCostUsd = models.reduce(
        (sum, row) => sum + (row.estimatedApiCostUsd ?? 0),
        0,
    );
    const pricedTokens = models.reduce(
        (sum, row) => sum + (row.estimatedApiCostUsd === null ? 0 : row.tokens),
        0,
    );
    const totalTokens = models.reduce((sum, row) => sum + row.tokens, 0);
    return {
        estimatedApiCostUsd,
        pricedTokens,
        pricingCoveragePercent: totalTokens > 0 ? pricedTokens / totalTokens * 100 : 0,
    };
}

export function summarizeModelActivity(
    records: readonly TokenRecord[],
    nowMs = Date.now(),
    windowDays = 7,
): ModelActivitySnapshot {
    const cutoffMs = nowMs - windowDays * DAY_MS;
    const totals = new Map<string, TokenBreakdown>();

    for (const record of records) {
        if (record.timestampMs < cutoffMs || record.timestampMs > nowMs + 60_000)
            continue;

        const usage = normalizedBreakdown(record);
        totals.set(
            record.model,
            addBreakdown(totals.get(record.model) ?? emptyBreakdown(), usage),
        );
    }

    const totalTokens = [...totals.values()].reduce((sum, value) => sum + value.totalTokens, 0);
    const models = modelsFromTotals(totals, totalTokens);
    const pricing = pricingSummary(models);

    return {
        models,
        totalTokens,
        scannedAtMs: nowMs,
        windowDays,
        sources: totalTokens > 0 ? ['Codex'] : [],
        ...pricing,
    };
}

function parseCompactNumber(value: string): number | null {
    const match = value.trim().match(/^([0-9]+(?:\.[0-9]+)?)([KMB])?$/i);
    if (!match)
        return null;

    const base = Number(match[1]);
    if (!Number.isFinite(base))
        return null;

    const suffix = (match[2] ?? '').toUpperCase();
    const multiplier = suffix === 'K' ? 1_000 :
        suffix === 'M' ? 1_000_000 :
        suffix === 'B' ? 1_000_000_000 : 1;

    return Math.round(base * multiplier);
}

export function parseOpenCodeUsageStats(text: string): ReadonlyMap<string, TokenBreakdown> {
    const totals = new Map<string, TokenBreakdown>();
    let currentModel: string | null = null;
    let current = emptyBreakdown();

    const flush = (): void => {
        if (currentModel !== null && current.totalTokens > 0) {
            totals.set(
                currentModel,
                addBreakdown(totals.get(currentModel) ?? emptyBreakdown(), current),
            );
        }
        currentModel = null;
        current = emptyBreakdown();
    };

    for (const rawLine of text.split('\n')) {
        const match = rawLine.match(/^│\s*(.*?)\s*│$/u);
        if (!match)
            continue;

        const content = (match[1] ?? '').trim();
        if (!content || /^[-─┼┬┴]+$/u.test(content))
            continue;

        if (/^[A-Za-z0-9._-]+\/[A-Za-z0-9._:-]+$/.test(content)) {
            flush();
            currentModel = content;
            continue;
        }

        if (currentModel === null)
            continue;

        const metric = content.match(
            /^(Input Tokens|Output Tokens|Cache Read|Cache Write)\s+([0-9.]+[KMB]?)$/i,
        );
        if (!metric)
            continue;

        const value = parseCompactNumber(metric[2] ?? '');
        if (value === null)
            continue;

        const name = (metric[1] ?? '').toLowerCase();
        if (name === 'input tokens')
            current = {...current, inputTokens: value, totalTokens: current.totalTokens + value};
        else if (name === 'output tokens')
            current = {...current, outputTokens: value, totalTokens: current.totalTokens + value};
        else if (name === 'cache read')
            current = {...current, cachedInputTokens: value, totalTokens: current.totalTokens + value};
        else if (name === 'cache write')
            current = {...current, cacheWriteInputTokens: value, totalTokens: current.totalTokens + value};
    }

    flush();
    return totals;
}

export function parseOpenCodeStats(text: string): ReadonlyMap<string, number> {
    return new Map(
        [...parseOpenCodeUsageStats(text)].map(([model, usage]) => [model, usage.totalTokens]),
    );
}

export function mergeModelActivity(
    codex: ModelActivitySnapshot,
    openCodeTotals: ReadonlyMap<string, number | TokenBreakdown>,
): ModelActivitySnapshot {
    const totals = new Map<string, TokenBreakdown>();

    for (const row of codex.models)
        totals.set(row.model, normalizedBreakdown(row));

    let openCodeTokens = 0;
    for (const [qualifiedModel, rawUsage] of openCodeTotals) {
        const slash = qualifiedModel.indexOf('/');
        const provider = slash >= 0 ? qualifiedModel.slice(0, slash).toLowerCase() : '';
        const model = slash >= 0 ? qualifiedModel.slice(slash + 1) : qualifiedModel;

        if (provider && provider !== 'openai' && provider !== 'chatgpt')
            continue;

        const usage = typeof rawUsage === 'number'
            ? normalizedBreakdown({tokens: rawUsage})
            : normalizedBreakdown(rawUsage);

        if (usage.totalTokens <= 0)
            continue;

        totals.set(model, addBreakdown(totals.get(model) ?? emptyBreakdown(), usage));
        openCodeTokens += usage.totalTokens;
    }

    const totalTokens = [...totals.values()].reduce((sum, value) => sum + value.totalTokens, 0);
    const models = modelsFromTotals(totals, totalTokens);
    const pricing = pricingSummary(models);

    return {
        models,
        totalTokens,
        scannedAtMs: codex.scannedAtMs,
        windowDays: codex.windowDays,
        sources: openCodeTokens > 0 ? [...codex.sources, 'OpenCode'] : codex.sources,
        ...pricing,
    };
}

export function compactModelActivity(
    snapshot: ModelActivitySnapshot,
    maxRows = 4,
): readonly ModelActivity[] {
    if (maxRows < 2 || snapshot.models.length <= maxRows)
        return snapshot.models.slice(0, Math.max(0, maxRows));

    const visible = snapshot.models.slice(0, maxRows - 1);
    const rest = snapshot.models.slice(maxRows - 1);
    const aggregate = rest.reduce(
        (sum, row) => addBreakdown(sum, normalizedBreakdown(row)),
        emptyBreakdown(),
    );
    const otherCost = rest.every(row => row.estimatedApiCostUsd !== null)
        ? rest.reduce((sum, row) => sum + (row.estimatedApiCostUsd ?? 0), 0)
        : null;

    return [
        ...visible,
        {
            model: 'Other',
            tokens: aggregate.totalTokens,
            ...aggregate,
            sharePercent: snapshot.totalTokens > 0
                ? aggregate.totalTokens / snapshot.totalTokens * 100
                : 0,
            estimatedApiCostUsd: otherCost,
        },
    ];
}

export function formatTokenCount(tokens: number): string {
    const value = Math.max(0, Math.round(tokens));
    if (value >= 1_000_000_000)
        return `${(value / 1_000_000_000).toFixed(value >= 10_000_000_000 ? 0 : 1)}B`;
    if (value >= 1_000_000)
        return `${(value / 1_000_000).toFixed(value >= 10_000_000 ? 0 : 1)}M`;
    if (value >= 1_000)
        return `${(value / 1_000).toFixed(value >= 10_000 ? 0 : 1)}K`;
    return String(value);
}

export function formatUsd(value: number): string {
    if (!Number.isFinite(value) || value < 0)
        return '$0.00';
    if (value < 0.01 && value > 0)
        return '<$0.01';
    return `$${value.toFixed(2)}`;
}

export function displayModelName(model: string): string {
    if (model === 'Other')
        return model;

    return model
        .replace(/^gpt-/i, 'GPT-')
        .replace(/-codex$/i, ' Codex')
        .replace(/-sol$/i, ' Sol')
        .replace(/-luna$/i, ' Luna');
}
