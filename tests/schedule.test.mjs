import test from 'node:test';
import assert from 'node:assert/strict';

import {ACTIVITY_INTERVALS_SECONDS, failureBackoffSeconds, nextSuccessSchedule} from '../extension/schedule.js';

const snapshot = {
    fiveHour: {usedPercent: 10, remainingPercent: 90, resetAtMs: null, windowSeconds: 18_000},
    weekly: {usedPercent: 10, remainingPercent: 90, resetAtMs: null, windowSeconds: 604_800},
    plan: 'plus',
    fetchedAtMs: 0,
};

test('uses 60 seconds while idle', () => {
    assert.deepEqual(nextSuccessSchedule(1_000, null, snapshot), {
        delaySeconds: 60,
        nextActivityIndex: null,
    });
});

test('progressively backs off after activity', () => {
    let index = 0;
    const delays = [];

    while (index !== null) {
        const result = nextSuccessSchedule(1_000, index, snapshot);
        delays.push(result.delaySeconds);
        index = result.nextActivityIndex;
    }

    assert.deepEqual(delays, [...ACTIVITY_INTERVALS_SECONDS]);
    assert.equal(nextSuccessSchedule(1_000, index, snapshot).delaySeconds, 60);
});

test('activity can restart the sequence at eight seconds', () => {
    assert.equal(nextSuccessSchedule(1_000, 3, snapshot).delaySeconds, 34);
    assert.equal(nextSuccessSchedule(1_000, 0, snapshot).delaySeconds, 8);
});

test('wakes at a known reset before normal polling', () => {
    const resetSoon = {...snapshot, fiveHour: {...snapshot.fiveHour, resetAtMs: 11_000}};
    assert.equal(nextSuccessSchedule(1_000, null, resetSoon).delaySeconds, 10);
});

test('failure backoff is capped at five minutes', () => {
    assert.equal(failureBackoffSeconds(1), 60);
    assert.equal(failureBackoffSeconds(2), 120);
    assert.equal(failureBackoffSeconds(3), 240);
    assert.equal(failureBackoffSeconds(4), 300);
});
