// SPDX-License-Identifier: GPL-2.0-or-later

import type {UsageSnapshot} from './model.js';

export const IDLE_INTERVAL_SECONDS = 60;
export const ACTIVITY_INTERVALS_SECONDS = [8, 13, 21, 34, 55] as const;
export const POPUP_STALE_AFTER_SECONDS = 15;
export const MAX_BACKOFF_SECONDS = 300;

export interface SuccessSchedule {
    readonly delaySeconds: number;
    readonly nextActivityIndex: number | null;
}

function secondsUntilNextReset(snapshot: UsageSnapshot, nowMs: number): number | null {
    const resets = [snapshot.fiveHour?.resetAtMs, snapshot.weekly?.resetAtMs]
        .filter((value): value is number => typeof value === 'number' && value > nowMs)
        .map(value => Math.max(1, Math.ceil((value - nowMs) / 1000)));

    return resets.length === 0 ? null : Math.min(...resets);
}

export function nextSuccessSchedule(
    nowMs: number,
    activityIndex: number | null,
    snapshot: UsageSnapshot,
): SuccessSchedule {
    let baseDelay = IDLE_INTERVAL_SECONDS;
    let nextActivityIndex: number | null = null;

    if (activityIndex !== null) {
        const safeIndex = Math.max(0, Math.min(activityIndex, ACTIVITY_INTERVALS_SECONDS.length - 1));
        baseDelay = ACTIVITY_INTERVALS_SECONDS[safeIndex] ?? IDLE_INTERVAL_SECONDS;
        nextActivityIndex = safeIndex + 1 < ACTIVITY_INTERVALS_SECONDS.length ? safeIndex + 1 : null;
    }

    const untilReset = secondsUntilNextReset(snapshot, nowMs);
    return {
        delaySeconds: untilReset === null ? baseDelay : Math.min(baseDelay, untilReset),
        nextActivityIndex,
    };
}

export function failureBackoffSeconds(consecutiveFailures: number): number {
    const failures = Math.max(1, consecutiveFailures);
    return Math.min(MAX_BACKOFF_SECONDS, IDLE_INTERVAL_SECONDS * 2 ** (failures - 1));
}

export function isStale(lastSuccessMs: number | null, maxAgeSeconds: number, nowMs = Date.now()): boolean {
    if (lastSuccessMs === null)
        return true;
    return nowMs - lastSuccessMs >= maxAgeSeconds * 1000;
}
