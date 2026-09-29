// SPDX-License-Identifier: GPL-2.0-or-later

export interface ModelActivity {
    readonly model: string;
    readonly tokens: number;
    readonly sharePercent: number;
}

export interface ModelActivitySnapshot {
    readonly models: readonly ModelActivity[];
    readonly totalTokens: number;
    readonly scannedAtMs: number;
    readonly windowDays: number;
    readonly sources: readonly string[];
}

export interface TokenRecord {
    readonly timestampMs: number;
    readonly model: string;
    readonly tokens: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function finiteNumber(value: unknown): number | null {
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
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

export function parseCodexRollout(text: string): readonly TokenRecord[] {
    const turnModels = new Map<string, string>();
    const pending: Array<{timestampMs: number; turnId: string; tokens: number}> = [];

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

        const totalTokens = finiteNumber(usage.total_tokens);
        if (totalTokens === null || totalTokens <= 0)
            continue;

        pending.push({timestampMs, turnId, tokens: Math.trunc(totalTokens)});
    }

    return pending.flatMap(record => {
        const model = turnModels.get(record.turnId);
        return model ? [{timestampMs: record.timestampMs, model, tokens: record.tokens}] : [];
    });
}

export function summarizeModelActivity(
    records: readonly TokenRecord[],
    nowMs = Date.now(),
    windowDays = 7,
): ModelActivitySnapshot {
    const cutoffMs = nowMs - windowDays * DAY_MS;
    const totals = new Map<string, number>();

    for (const record of records) {
        if (record.timestampMs < cutoffMs || record.timestampMs > nowMs + 60_000)
            continue;
        totals.set(record.model, (totals.get(record.model) ?? 0) + record.tokens);
    }

    const totalTokens = [...totals.values()].reduce((sum, value) => sum + value, 0);
    const models = [...totals.entries()]
        .map(([model, tokens]) => ({
            model,
            tokens,
            sharePercent: totalTokens > 0 ? tokens / totalTokens * 100 : 0,
        }))
        .sort((a, b) => b.tokens - a.tokens || a.model.localeCompare(b.model));

    return {models, totalTokens, scannedAtMs: nowMs, windowDays, sources: totalTokens > 0 ? ['Codex'] : []};
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

export function parseOpenCodeStats(text: string): ReadonlyMap<string, number> {
    const totals = new Map<string, number>();
    let currentModel: string | null = null;
    let currentTokens = 0;

    const flush = (): void => {
        if (currentModel !== null && currentTokens > 0)
            totals.set(currentModel, (totals.get(currentModel) ?? 0) + currentTokens);
        currentModel = null;
        currentTokens = 0;
    };

    for (const rawLine of text.split('\n')) {
        const match = rawLine.match(/^│\s*(.*?)\s*│$/u);
        if (!match)
            continue;

        const content = match[1].trim();
        if (!content || /^[-─┼┬┴]+$/u.test(content))
            continue;

        if (/^[A-Za-z0-9._-]+\/[A-Za-z0-9._:-]+$/.test(content)) {
            flush();
            currentModel = content;
            continue;
        }

        if (currentModel === null)
            continue;

        const metric = content.match(/^(Input Tokens|Output Tokens|Cache Read|Cache Write)\s+([0-9.]+[KMB]?)$/i);
        if (!metric)
            continue;

        const value = parseCompactNumber(metric[2]);
        if (value !== null)
            currentTokens += value;
    }

    flush();
    return totals;
}

export function mergeModelActivity(
    codex: ModelActivitySnapshot,
    openCodeTotals: ReadonlyMap<string, number>,
): ModelActivitySnapshot {
    const totals = new Map<string, number>();

    for (const row of codex.models)
        totals.set(row.model, (totals.get(row.model) ?? 0) + row.tokens);

    let openCodeTokens = 0;
    for (const [qualifiedModel, tokens] of openCodeTotals) {
        const slash = qualifiedModel.indexOf('/');
        const provider = slash >= 0 ? qualifiedModel.slice(0, slash).toLowerCase() : '';
        const model = slash >= 0 ? qualifiedModel.slice(slash + 1) : qualifiedModel;

        // The extension is about ChatGPT/OpenAI usage. Ignore unrelated OpenCode providers.
        if (provider && provider !== 'openai' && provider !== 'chatgpt')
            continue;

        if (tokens <= 0)
            continue;

        totals.set(model, (totals.get(model) ?? 0) + tokens);
        openCodeTokens += tokens;
    }

    const totalTokens = [...totals.values()].reduce((sum, tokens) => sum + tokens, 0);
    const models = [...totals.entries()]
        .map(([model, tokens]) => ({
            model,
            tokens,
            sharePercent: totalTokens > 0 ? tokens / totalTokens * 100 : 0,
        }))
        .sort((a, b) => b.tokens - a.tokens || a.model.localeCompare(b.model));

    return {
        models,
        totalTokens,
        scannedAtMs: codex.scannedAtMs,
        windowDays: codex.windowDays,
        sources: openCodeTokens > 0 ? [...codex.sources, 'OpenCode'] : codex.sources,
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
    const otherTokens = rest.reduce((sum, row) => sum + row.tokens, 0);

    return [
        ...visible,
        {
            model: 'Other',
            tokens: otherTokens,
            sharePercent: snapshot.totalTokens > 0 ? otherTokens / snapshot.totalTokens * 100 : 0,
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

export function displayModelName(model: string): string {
    if (model === 'Other')
        return model;

    return model
        .replace(/^gpt-/i, 'GPT-')
        .replace(/-codex$/i, ' Codex')
        .replace(/-sol$/i, ' Sol')
        .replace(/-luna$/i, ' Luna');
}
