import test from 'node:test';
import assert from 'node:assert/strict';

import {detectedConsumption, formatPanel, parseUsageResponse, progressScale} from '../extension/model.js';

test('parses primary and secondary windows', () => {
    const snapshot = parseUsageResponse({
        plan_type: 'plus',
        rate_limit: {
            primary_window: {used_percent: 18, reset_at: 1_800_000_000, limit_window_seconds: 18_000},
            secondary_window: {used_percent: 3, reset_at: 1_800_500_000, limit_window_seconds: 604_800},
        },
    }, 1234);

    assert.equal(snapshot.fiveHour?.remainingPercent, 82);
    assert.equal(snapshot.weekly?.remainingPercent, 97);
    assert.equal(snapshot.plan, 'plus');
    assert.equal(formatPanel(snapshot), '5h 82% · W 97%');
});

test('classifies a weekly primary window by duration', () => {
    const snapshot = parseUsageResponse({
        rate_limit: {
            primary_window: {used_percent: 12, reset_at: 1_800_500_000, limit_window_seconds: 604_800},
            secondary_window: null,
        },
    });

    assert.equal(snapshot.fiveHour, null);
    assert.equal(snapshot.weekly?.remainingPercent, 88);
    assert.equal(formatPanel(snapshot), 'W 88%');
});

test('consumption in either window is an activity signal', () => {
    const previous = parseUsageResponse({
        rate_limit: {
            primary_window: {used_percent: 10, limit_window_seconds: 18_000},
            secondary_window: {used_percent: 10, limit_window_seconds: 604_800},
        },
    });
    const weeklyOnly = parseUsageResponse({
        rate_limit: {
            primary_window: {used_percent: 10, limit_window_seconds: 18_000},
            secondary_window: {used_percent: 10.25, limit_window_seconds: 604_800},
        },
    });
    const fiveHourOnly = parseUsageResponse({
        rate_limit: {
            primary_window: {used_percent: 10.25, limit_window_seconds: 18_000},
            secondary_window: {used_percent: 10, limit_window_seconds: 604_800},
        },
    });

    assert.equal(detectedConsumption(previous, weeklyOnly), true);
    assert.equal(detectedConsumption(previous, fiveHourOnly), true);
});

test('resets and rollbacks do not count as activity', () => {
    const previous = parseUsageResponse({
        rate_limit: {
            primary_window: {used_percent: 98, limit_window_seconds: 18_000},
            secondary_window: {used_percent: 30, limit_window_seconds: 604_800},
        },
    });
    const reset = parseUsageResponse({
        rate_limit: {
            primary_window: {used_percent: 0, limit_window_seconds: 18_000},
            secondary_window: {used_percent: 29.8, limit_window_seconds: 604_800},
        },
    });

    assert.equal(detectedConsumption(previous, reset), false);
});

test('progress scale clamps cleanly at percentage boundaries', () => {
    assert.equal(progressScale(-10), 0);
    assert.equal(progressScale(0), 0);
    assert.equal(progressScale(1), 0.01);
    assert.equal(progressScale(50), 0.5);
    assert.equal(progressScale(71), 0.71);
    assert.equal(progressScale(99), 0.99);
    assert.equal(progressScale(100), 1);
    assert.equal(progressScale(120), 1);
    assert.equal(progressScale(Number.NaN), 0);
});
