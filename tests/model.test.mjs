import test from 'node:test';
import assert from 'node:assert/strict';

import {fiveHourChanged, formatPanel, parseUsageResponse} from '../extension/model.js';

test('parses current primary/secondary window response', () => {
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

test('classifies a single weekly primary window by duration', () => {
    const snapshot = parseUsageResponse({
        rate_limit: {primary_window: {used_percent: 12, reset_at: 1_800_500_000, limit_window_seconds: 604_800}, secondary_window: null},
    });
    assert.equal(snapshot.fiveHour, null);
    assert.equal(snapshot.weekly?.remainingPercent, 88);
    assert.equal(formatPanel(snapshot), 'W 88%');
});

test('parses legacy percent_left fields', () => {
    const snapshot = parseUsageResponse({
        rate_limits: {
            five_hour: {percent_left: 73.4, reset_time_ms: 1_800_000_000_000, limit_window_seconds: 18_000},
            weekly: {percent_left: 87.1, reset_time_ms: 1_800_500_000_000, limit_window_seconds: 604_800},
        },
    });
    assert.equal(snapshot.fiveHour?.remainingPercent, 73.4);
    assert.equal(snapshot.weekly?.remainingPercent, 87.1);
});

test('only 5-hour changes drive fast mode', () => {
    const previous = parseUsageResponse({rate_limit:{primary_window:{used_percent:10,limit_window_seconds:18_000},secondary_window:{used_percent:10,limit_window_seconds:604_800}}});
    const weeklyOnly = parseUsageResponse({rate_limit:{primary_window:{used_percent:10,limit_window_seconds:18_000},secondary_window:{used_percent:11,limit_window_seconds:604_800}}});
    const fiveHour = parseUsageResponse({rate_limit:{primary_window:{used_percent:11,limit_window_seconds:18_000},secondary_window:{used_percent:11,limit_window_seconds:604_800}}});
    assert.equal(fiveHourChanged(previous, weeklyOnly), false);
    assert.equal(fiveHourChanged(previous, fiveHour), true);
});
