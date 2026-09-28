import test from 'node:test';
import assert from 'node:assert/strict';

import {parseCodexRollout, summarizeModelActivity} from '../extension/activity.js';

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
