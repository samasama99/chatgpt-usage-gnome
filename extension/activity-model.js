// SPDX-License-Identifier: GPL-2.0-or-later
const DAY_MS = 24 * 60 * 60 * 1000;

function isRecord(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function finiteNumber(value) {
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
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

export function parseCodexRollout(text) {
    const turnModels = new Map();
    const pending = [];

    for (const rawLine of text.split('\n')) {
        if (!rawLine.trim())
            continue;

        let value;
        try {
            value = JSON.parse(rawLine);
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

export function summarizeModelActivity(records, nowMs = Date.now(), windowDays = 7) {
    const cutoffMs = nowMs - windowDays * DAY_MS;
    const totals = new Map();

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

    return {models, totalTokens, scannedAtMs: nowMs, windowDays};
}

export function compactModelActivity(snapshot, maxRows = 4) {
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

export function displayModelName(model) {
    if (model === 'Other')
        return model;

    return model
        .replace(/^gpt-/i, 'GPT-')
        .replace(/-codex$/i, ' Codex')
        .replace(/-sol$/i, ' Sol')
        .replace(/-luna$/i, ' Luna');
}
