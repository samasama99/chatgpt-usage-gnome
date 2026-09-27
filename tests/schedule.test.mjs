import test from 'node:test';
import assert from 'node:assert/strict';

import {enterFastMode, failureBackoffSeconds, nextSuccessDelaySeconds} from '../extension/schedule.js';

const snapshot = {
    fiveHour: {usedPercent: 10, remainingPercent: 90, resetAtMs: null, windowSeconds: 18_000},
    weekly: {usedPercent: 10, remainingPercent: 90, resetAtMs: null, windowSeconds: 604_800},
    plan: 'plus',
    fetchedAtMs: 0,
};

test('uses 60 seconds while idle', () => assert.equal(nextSuccessDelaySeconds(1_000, 0, snapshot), 60));

test('uses 15 seconds while fast mode is active', () => {
    const fastUntil = enterFastMode(1_000);
    assert.equal(nextSuccessDelaySeconds(1_000, fastUntil, snapshot), 15);
});

test('wakes at a known reset before the normal poll', () => {
    const resetSoon = {...snapshot, fiveHour: {...snapshot.fiveHour, resetAtMs: 11_000}};
    assert.equal(nextSuccessDelaySeconds(1_000, 0, resetSoon), 10);
});

test('failure backoff is capped at five minutes', () => {
    assert.equal(failureBackoffSeconds(1), 60);
    assert.equal(failureBackoffSeconds(2), 120);
    assert.equal(failureBackoffSeconds(3), 240);
    assert.equal(failureBackoffSeconds(4), 300);
    assert.equal(failureBackoffSeconds(10), 300);
});
