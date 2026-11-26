// SPDX-License-Identifier: GPL-2.0-or-later
const DAY_MS = 24 * 60 * 60 * 1000;
// Standard API prices in USD per 1M text tokens, reviewed 2026-10-14.
// Long-context, Fast/Ultrafast, regional, Batch/Flex and tool-call premiums
// are intentionally not included in this local estimate.
const API_PRICES = new Map([
    ['gpt-6-astra', { input: 10, cachedInput: 1, cacheWrite: 12.5, output: 50 }],
    ['gpt-6.1-sol', { input: 2, cachedInput: 0.1, cacheWrite: 2.5, output: 10 }],
    ['gpt-6-sol', { input: 2, cachedInput: 0.2, cacheWrite: 2.5, output: 10 }],
    ['gpt-6-luna', { input: 0.1, cachedInput: 0.01, cacheWrite: 0.125, output: 0.5 }],
    ['gpt-5.6-sol', { input: 4, cachedInput: 0.4, cacheWrite: 5, output: 20 }],
    ['gpt-5.6-terra', { input: 2, cachedInput: 0.2, cacheWrite: 2.5, output: 12 }],
    ['gpt-5.6-luna', { input: 0.2, cachedInput: 0.02, cacheWrite: 0.25, output: 1.2 }],
    ['gpt-5.5', { input: 5, cachedInput: 0.5, cacheWrite: 6.25, output: 30 }],
    // Claude standard API prices, reviewed 2026-11-26. Cache writes use the
    // 5-minute rate (1.25x input); the 1-hour cache-write premium is excluded.
    ['claude-fable-5-2', { input: 8, cachedInput: 0.2, cacheWrite: 10, output: 40 }],
    ['claude-opus-5-5', { input: 4, cachedInput: 0.2, cacheWrite: 5, output: 20 }],
    ['claude-opus-5', { input: 5, cachedInput: 0.5, cacheWrite: 6.25, output: 25 }],
    ['claude-opus-4-8', { input: 5, cachedInput: 0.5, cacheWrite: 6.25, output: 25 }],
    ['claude-opus-4-7', { input: 5, cachedInput: 0.5, cacheWrite: 6.25, output: 25 }],
    ['claude-opus-4-6', { input: 5, cachedInput: 0.5, cacheWrite: 6.25, output: 25 }],
    ['claude-sonnet-5-5', { input: 2, cachedInput: 0.1, cacheWrite: 2.5, output: 10 }],
    ['claude-sonnet-5', { input: 2, cachedInput: 0.2, cacheWrite: 2.5, output: 10 }],
    ['claude-sonnet-4-6', { input: 3, cachedInput: 0.3, cacheWrite: 3.75, output: 15 }],
    ['claude-haiku-5-5', { input: 0.1, cachedInput: 0.01, cacheWrite: 0.125, output: 0.5 }],
    ['claude-haiku-4-5', { input: 1, cachedInput: 0.1, cacheWrite: 1.25, output: 5 }],
]);
/** Lowercase a model ID and drop date snapshots / context-size suffixes. */
export function normalizeModelId(model) {
    return model
        .trim()
        .toLowerCase()
        .replace(/\[[^\]]*\]$/, '')
        .replace(/-\d{8}$/, '');
}
function isRecord(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function finiteNumber(value) {
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
}
function nonNegativeInt(value) {
    const parsed = finiteNumber(value);
    return parsed === null ? 0 : Math.max(0, Math.trunc(parsed));
}
function emptyBreakdown() {
    return {
        uncachedInputTokens: 0,
        cachedInputTokens: 0,
        cacheWriteInputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
    };
}
function addBreakdown(a, b) {
    return {
        uncachedInputTokens: a.uncachedInputTokens + b.uncachedInputTokens,
        cachedInputTokens: a.cachedInputTokens + b.cachedInputTokens,
        cacheWriteInputTokens: a.cacheWriteInputTokens + b.cacheWriteInputTokens,
        outputTokens: a.outputTokens + b.outputTokens,
        totalTokens: a.totalTokens + b.totalTokens,
    };
}
function normalizeBreakdown(value) {
    const totalTokens = Math.max(0, Math.trunc(value.totalTokens ?? value.tokens ?? 0));
    const cachedInputTokens = Math.max(0, Math.trunc(value.cachedInputTokens ?? 0));
    const cacheWriteInputTokens = Math.max(0, Math.trunc(value.cacheWriteInputTokens ?? 0));
    const outputTokens = Math.max(0, Math.trunc(value.outputTokens ?? 0));
    const uncachedInputTokens = Math.max(0, Math.trunc(value.uncachedInputTokens ??
        (totalTokens - cachedInputTokens - cacheWriteInputTokens - outputTokens)));
    return {
        uncachedInputTokens,
        cachedInputTokens,
        cacheWriteInputTokens,
        outputTokens,
        totalTokens,
    };
}
function lineItem(value) {
    if (!isRecord(value))
        return null;
    if (typeof value.type === 'string')
        return value;
    return isRecord(value.item) ? value.item : null;
}
function lineTimestampMs(value) {
    if (!isRecord(value) || typeof value.timestamp !== 'string')
        return null;
    const parsed = Date.parse(value.timestamp);
    return Number.isFinite(parsed) ? parsed : null;
}
function codexBreakdown(usage) {
    const input = nonNegativeInt(usage.input_tokens);
    const cached = nonNegativeInt(usage.cached_input_tokens);
    const cacheWrite = nonNegativeInt(usage.cache_write_input_tokens);
    const output = nonNegativeInt(usage.output_tokens);
    const total = nonNegativeInt(usage.total_tokens);
    return {
        uncachedInputTokens: Math.max(0, input - cached - cacheWrite),
        cachedInputTokens: cached,
        cacheWriteInputTokens: cacheWrite,
        outputTokens: output,
        totalTokens: total > 0 ? total : input + output,
    };
}
export function estimateApiEquivalentCost(model, usage) {
    const price = API_PRICES.get(normalizeModelId(model));
    if (!price)
        return null;
    return (usage.uncachedInputTokens * price.input +
        usage.cachedInputTokens * price.cachedInput +
        usage.cacheWriteInputTokens * price.cacheWrite +
        usage.outputTokens * price.output) / 1_000_000;
}
export function parseCodexRollout(text) {
    const turnModels = new Map();
    const pending = [];
    for (const rawLine of text.split('\n')) {
        if (!rawLine.trim())
            continue;
        let value;
        try {
            value = JSON.parse(rawLine);
        }
        catch {
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
        const breakdown = codexBreakdown(usage);
        if (breakdown.totalTokens <= 0)
            continue;
        pending.push({ timestampMs, turnId, usage: breakdown });
    }
    return pending.flatMap(record => {
        const model = turnModels.get(record.turnId);
        if (!model)
            return [];
        return [{
                timestampMs: record.timestampMs,
                model,
                tokens: record.usage.totalTokens,
                ...record.usage,
            }];
    });
}
function claudeBreakdown(usage) {
    const input = nonNegativeInt(usage.input_tokens);
    const cached = nonNegativeInt(usage.cache_read_input_tokens);
    const cacheWrite = nonNegativeInt(usage.cache_creation_input_tokens);
    const output = nonNegativeInt(usage.output_tokens);
    return {
        uncachedInputTokens: input,
        cachedInputTokens: cached,
        cacheWriteInputTokens: cacheWrite,
        outputTokens: output,
        totalTokens: input + cached + cacheWrite + output,
    };
}
/**
 * Extract per-message token usage from a Claude Code session JSONL file.
 * Claude Code writes one line per content block, repeating the message's
 * usage, so records are de-duplicated by message ID (last line wins).
 */
export function parseClaudeCodeSession(text) {
    const byId = new Map();
    const anonymous = [];
    for (const rawLine of text.split('\n')) {
        if (!rawLine.trim())
            continue;
        let value;
        try {
            value = JSON.parse(rawLine);
        }
        catch {
            continue;
        }
        if (!isRecord(value) || value.type !== 'assistant' || !isRecord(value.message))
            continue;
        const message = value.message;
        const model = message.model;
        const usage = message.usage;
        const timestampMs = lineTimestampMs(value);
        if (typeof model !== 'string' || !model || model.startsWith('<') ||
            !isRecord(usage) || timestampMs === null)
            continue;
        const breakdown = claudeBreakdown(usage);
        if (breakdown.totalTokens <= 0)
            continue;
        const id = typeof message.id === 'string' && message.id ? message.id : null;
        const record = {
            ...(id === null ? {} : { id }),
            timestampMs,
            model: normalizeModelId(model),
            tokens: breakdown.totalTokens,
            ...breakdown,
        };
        if (id === null)
            anonymous.push(record);
        else
            byId.set(id, record);
    }
    return [...byId.values(), ...anonymous];
}
function activitiesFromTotals(totals, totalTokens) {
    return [...totals.entries()]
        .map(([model, usage]) => ({
        model,
        tokens: usage.totalTokens,
        ...usage,
        sharePercent: totalTokens > 0 ? usage.totalTokens / totalTokens * 100 : 0,
        apiEquivalentUsd: estimateApiEquivalentCost(model, usage),
    }))
        .sort((a, b) => b.tokens - a.tokens || a.model.localeCompare(b.model));
}
function pricingSummary(models) {
    return {
        apiEquivalentUsd: models.reduce((sum, row) => sum + (row.apiEquivalentUsd ?? 0), 0),
        pricedTokens: models.reduce((sum, row) => sum + (row.apiEquivalentUsd === null ? 0 : row.tokens), 0),
    };
}
export function summarizeModelActivity(records, nowMs = Date.now(), windowDays = 7, source = 'Codex') {
    const cutoffMs = nowMs - windowDays * DAY_MS;
    const totals = new Map();
    for (const record of records) {
        if (record.timestampMs < cutoffMs || record.timestampMs > nowMs + 60_000)
            continue;
        totals.set(record.model, addBreakdown(totals.get(record.model) ?? emptyBreakdown(), normalizeBreakdown(record)));
    }
    const totalTokens = [...totals.values()]
        .reduce((sum, usage) => sum + usage.totalTokens, 0);
    const models = activitiesFromTotals(totals, totalTokens);
    return {
        models,
        totalTokens,
        scannedAtMs: nowMs,
        windowDays,
        sources: totalTokens > 0 ? [source] : [],
        ...pricingSummary(models),
    };
}
function parseCompactNumber(value) {
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
export function parseOpenCodeStatsDetailed(text) {
    const totals = new Map();
    let currentModel = null;
    let current = emptyBreakdown();
    const flush = () => {
        if (currentModel !== null && current.totalTokens > 0) {
            totals.set(currentModel, addBreakdown(totals.get(currentModel) ?? emptyBreakdown(), current));
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
        const metric = content.match(/^(Input Tokens|Output Tokens|Cache Read|Cache Write)\s+([0-9.]+[KMB]?)$/i);
        if (!metric)
            continue;
        const value = parseCompactNumber(metric[2] ?? '');
        if (value === null)
            continue;
        const name = (metric[1] ?? '').toLowerCase();
        if (name === 'input tokens') {
            current = {
                ...current,
                uncachedInputTokens: current.uncachedInputTokens + value,
                totalTokens: current.totalTokens + value,
            };
        }
        else if (name === 'output tokens') {
            current = {
                ...current,
                outputTokens: current.outputTokens + value,
                totalTokens: current.totalTokens + value,
            };
        }
        else if (name === 'cache read') {
            current = {
                ...current,
                cachedInputTokens: current.cachedInputTokens + value,
                totalTokens: current.totalTokens + value,
            };
        }
        else if (name === 'cache write') {
            current = {
                ...current,
                cacheWriteInputTokens: current.cacheWriteInputTokens + value,
                totalTokens: current.totalTokens + value,
            };
        }
    }
    flush();
    return totals;
}
export function parseOpenCodeStats(text) {
    return new Map([...parseOpenCodeStatsDetailed(text)]
        .map(([model, usage]) => [model, usage.totalTokens]));
}
function snapshotFromTotals(totals, scannedAtMs, windowDays, sources) {
    const totalTokens = [...totals.values()]
        .reduce((sum, usage) => sum + usage.totalTokens, 0);
    const models = activitiesFromTotals(totals, totalTokens);
    return {
        models,
        totalTokens,
        scannedAtMs,
        windowDays,
        sources,
        ...pricingSummary(models),
    };
}
function totalsOf(snapshot) {
    const totals = new Map();
    for (const row of snapshot.models) {
        totals.set(row.model, addBreakdown(totals.get(row.model) ?? emptyBreakdown(), normalizeBreakdown(row)));
    }
    return totals;
}
/** Combine several local activity snapshots that cover the same window. */
export function combineModelActivity(snapshots, nowMs = Date.now(), windowDays = 7) {
    const totals = new Map();
    const sources = [];
    for (const snapshot of snapshots) {
        for (const [model, usage] of totalsOf(snapshot))
            totals.set(model, addBreakdown(totals.get(model) ?? emptyBreakdown(), usage));
        for (const source of snapshot.sources) {
            if (!sources.includes(source))
                sources.push(source);
        }
    }
    return snapshotFromTotals(totals, nowMs, windowDays, sources);
}
export const OPENCODE_CHATGPT_PROVIDERS = ['openai', 'chatgpt'];
export const OPENCODE_CLAUDE_PROVIDERS = ['anthropic', 'claude'];
/**
 * Merge OpenCode model totals into a local snapshot, keeping only models from
 * the given OpenCode provider prefixes (e.g. `openai/…`, `anthropic/…`).
 */
export function mergeModelActivity(codex, openCodeTotals, allowedProviders = OPENCODE_CHATGPT_PROVIDERS) {
    const totals = totalsOf(codex);
    let openCodeTokens = 0;
    for (const [qualifiedModel, rawUsage] of openCodeTotals) {
        const slash = qualifiedModel.indexOf('/');
        const provider = slash >= 0 ? qualifiedModel.slice(0, slash).toLowerCase() : '';
        const model = slash >= 0 ? qualifiedModel.slice(slash + 1) : qualifiedModel;
        if (provider && !allowedProviders.includes(provider))
            continue;
        const usage = typeof rawUsage === 'number'
            ? normalizeBreakdown({ tokens: rawUsage })
            : normalizeBreakdown(rawUsage);
        if (usage.totalTokens <= 0)
            continue;
        const key = normalizeModelId(model);
        totals.set(key, addBreakdown(totals.get(key) ?? emptyBreakdown(), usage));
        openCodeTokens += usage.totalTokens;
    }
    return snapshotFromTotals(totals, codex.scannedAtMs, codex.windowDays, openCodeTokens > 0 ? [...codex.sources, 'OpenCode'] : codex.sources);
}
export function compactModelActivity(snapshot, maxRows = 4) {
    if (maxRows < 2 || snapshot.models.length <= maxRows)
        return snapshot.models.slice(0, Math.max(0, maxRows));
    const visible = snapshot.models.slice(0, maxRows - 1);
    const rest = snapshot.models.slice(maxRows - 1);
    const aggregate = rest.reduce((sum, row) => addBreakdown(sum, normalizeBreakdown(row)), emptyBreakdown());
    const costKnown = rest.every(row => row.apiEquivalentUsd !== null);
    return [
        ...visible,
        {
            model: 'Other',
            tokens: aggregate.totalTokens,
            ...aggregate,
            sharePercent: snapshot.totalTokens > 0
                ? aggregate.totalTokens / snapshot.totalTokens * 100
                : 0,
            apiEquivalentUsd: costKnown
                ? rest.reduce((sum, row) => sum + (row.apiEquivalentUsd ?? 0), 0)
                : null,
        },
    ];
}
export function formatTokenCount(tokens) {
    const value = Math.max(0, Math.round(tokens));
    if (value >= 1_000_000_000)
        return `${(value / 1_000_000_000).toFixed(value >= 10_000_000_000 ? 0 : 1)}B`;
    if (value >= 1_000_000)
        return `${(value / 1_000_000).toFixed(value >= 10_000_000 ? 0 : 1)}M`;
    if (value >= 1_000)
        return `${(value / 1_000).toFixed(value >= 10_000 ? 0 : 1)}K`;
    return String(value);
}
export function formatUsd(value) {
    if (!Number.isFinite(value) || value <= 0)
        return '$0.00';
    if (value < 0.01)
        return '<$0.01';
    return `$${value.toFixed(2)}`;
}
export function displayModelName(model) {
    if (model === 'Other')
        return model;
    const claude = normalizeModelId(model).match(/^claude-([a-z]+)-(\d+)(?:-(\d+))?$/);
    if (claude) {
        const family = claude[1] ?? '';
        const version = claude[3] === undefined ? claude[2] : `${claude[2]}.${claude[3]}`;
        return `Claude ${family.charAt(0).toUpperCase()}${family.slice(1)} ${version}`;
    }
    return model
        .replace(/^gpt-/i, 'GPT-')
        .replace(/-codex$/i, ' Codex')
        .replace(/-sol$/i, ' Sol')
        .replace(/-luna$/i, ' Luna');
}
