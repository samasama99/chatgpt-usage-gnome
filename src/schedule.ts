import type {UsageSnapshot} from './model.js';

export const IDLE_INTERVAL_SECONDS = 60;
export const FAST_INTERVAL_SECONDS = 15;
export const FAST_MODE_DURATION_SECONDS = 90;
export const POPUP_STALE_AFTER_SECONDS = 15;
export const MAX_BACKOFF_SECONDS = 300;

export function enterFastMode(nowMs: number): number {
    return nowMs + FAST_MODE_DURATION_SECONDS * 1000;
}

function secondsUntilNextReset(snapshot: UsageSnapshot, nowMs: number): number | null {
    const resets = [snapshot.fiveHour?.resetAtMs, snapshot.weekly?.resetAtMs]
        .filter((value): value is number => typeof value === 'number' && value > nowMs)
        .map(value => Math.max(1, Math.ceil((value - nowMs) / 1000)));

    if (resets.length === 0)
        return null;

    return Math.min(...resets);
}

export function nextSuccessDelaySeconds(
    nowMs: number,
    fastUntilMs: number,
    snapshot: UsageSnapshot,
): number {
    const base = nowMs < fastUntilMs ? FAST_INTERVAL_SECONDS : IDLE_INTERVAL_SECONDS;
    const untilReset = secondsUntilNextReset(snapshot, nowMs);
    return untilReset === null ? base : Math.min(base, untilReset);
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
