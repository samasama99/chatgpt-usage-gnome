import test from 'node:test';
import assert from 'node:assert/strict';

import {compactModelActivity, displayModelName, formatTokenCount, mergeModelActivity, parseCodexRollout, parseOpenCodeStats, summarizeModelActivity} from '../extension/activity-model.js';

const line = (timestamp, type, payload) => JSON.stringify({timestamp, type, payload});

test('maps token usage records to the model for their turn', () => {
    const text = [
        line('2026-09-28T10:00:00Z', 'turn_context', {turn_id: 'turn-a', model: 'gpt-5.6-sol'}),
        line('2026-09-28T10:00:02Z', 'token_usage_record', {
            turn_id: 'turn-a',
            usage: {total_tokens: 120},
        }),
        line('2026-09-28T10:01:00Z', 'turn_context', {turn_id: 'turn-b', model: 'gpt-5.6-codex'}),
        line('2026-09-28T10:01:02Z', 'token_usage_record', {
            turn_id: 'turn-b',
            usage: {total_tokens: 80},
        }),
    ].join('\n');

    assert.deepEqual(parseCodexRollout(text), [
        {timestampMs: Date.parse('2026-09-28T10:00:02Z'), model: 'gpt-5.6-sol', tokens: 120},
        {timestampMs: Date.parse('2026-09-28T10:01:02Z'), model: 'gpt-5.6-codex', tokens: 80},
    ]);
});

test('supports rollout lines with a nested item object', () => {
    const text = [
        JSON.stringify({
            timestamp: '2026-09-28T10:00:00Z',
            item: {type: 'turn_context', payload: {turn_id: 'turn-a', model: 'gpt-5.6-sol'}},
        }),
        JSON.stringify({
            timestamp: '2026-09-28T10:00:01Z',
            item: {type: 'token_usage_record', payload: {turn_id: 'turn-a', usage: {total_tokens: 20}}},
        }),
    ].join('\n');

    assert.equal(parseCodexRollout(text)[0]?.tokens, 20);
});

test('summarizes models by recent token usage and sorts descending', () => {
    const now = Date.parse('2026-09-28T12:00:00Z');
    const records = [
        {timestampMs: now - 1_000, model: 'gpt-5.6-sol', tokens: 700},
        {timestampMs: now - 2_000, model: 'gpt-5.6-codex', tokens: 300},
        {timestampMs: now - 8 * 24 * 60 * 60 * 1000, model: 'old-model', tokens: 9999},
    ];

    const snapshot = summarizeModelActivity(records, now, 7);

    assert.equal(snapshot.totalTokens, 1000);
    assert.deepEqual(snapshot.models.map(model => model.model), ['gpt-5.6-sol', 'gpt-5.6-codex']);
    assert.equal(snapshot.models[0]?.sharePercent, 70);
    assert.equal(snapshot.models[1]?.sharePercent, 30);
});


test('compacts long model lists into Other', () => {
    const snapshot = {
        totalTokens: 1000,
        scannedAtMs: 0,
        windowDays: 7,
        models: [
            {model: 'a', tokens: 400, sharePercent: 40},
            {model: 'b', tokens: 250, sharePercent: 25},
            {model: 'c', tokens: 150, sharePercent: 15},
            {model: 'd', tokens: 120, sharePercent: 12},
            {model: 'e', tokens: 80, sharePercent: 8},
        ],
    };

    assert.deepEqual(compactModelActivity(snapshot, 4), [
        {model: 'a', tokens: 400, sharePercent: 40},
        {model: 'b', tokens: 250, sharePercent: 25},
        {model: 'c', tokens: 150, sharePercent: 15},
        {model: 'Other', tokens: 200, sharePercent: 20},
    ]);
});

test('formats compact token counts and model names', () => {
    assert.equal(formatTokenCount(999), '999');
    assert.equal(formatTokenCount(1_250), '1.3K');
    assert.equal(formatTokenCount(1_250_000), '1.3M');
    assert.equal(displayModelName('gpt-5.6-sol'), 'GPT-5.6 Sol');
    assert.equal(displayModelName('gpt-5.6-codex'), 'GPT-5.6 Codex');
});


test('parses OpenCode model statistics and token totals', () => {
    const text = [
        '┌────────────────────────────────────────────────────────┐',
        '│                      MODEL USAGE                       │',
        '├────────────────────────────────────────────────────────┤',
        '│ openai/gpt-5.6-codex                                  │',
        '│  Messages                                          120 │',
        '│  Input Tokens                                     1.2M │',
        '│  Output Tokens                                    320K │',
        '│  Cache Read                                       800K │',
        '│  Cache Write                                       20K │',
        '│  Cost                                            $0.00 │',
        '├────────────────────────────────────────────────────────┤',
        '│ anthropic/claude-sonnet-4                           │',
        '│  Input Tokens                                     500K │',
        '│  Output Tokens                                    100K │',
        '└────────────────────────────────────────────────────────┘',
    ].join('\n');

    const totals = parseOpenCodeStats(text);
    assert.equal(totals.get('openai/gpt-5.6-codex'), 2_340_000);
    assert.equal(totals.get('anthropic/claude-sonnet-4'), 600_000);
});

test('merges OpenCode OpenAI usage with Codex and ignores unrelated providers', () => {
    const now = Date.parse('2026-09-29T12:00:00Z');
    const codex = summarizeModelActivity([
        {timestampMs: now - 1_000, model: 'gpt-5.6-codex', tokens: 600},
        {timestampMs: now - 2_000, model: 'gpt-5.6-sol', tokens: 400},
    ], now, 7);

    const merged = mergeModelActivity(codex, new Map([
        ['openai/gpt-5.6-codex', 400],
        ['openai/gpt-5.5', 500],
        ['anthropic/claude-sonnet-4', 5_000],
    ]));

    assert.equal(merged.totalTokens, 1_900);
    assert.deepEqual(merged.sources, ['Codex', 'OpenCode']);
    assert.deepEqual(merged.models.map(row => [row.model, row.tokens]), [
        ['gpt-5.6-codex', 1_000],
        ['gpt-5.5', 500],
        ['gpt-5.6-sol', 400],
    ]);
});
