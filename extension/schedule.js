export const IDLE_INTERVAL_SECONDS = 60;
export const FAST_INTERVAL_SECONDS = 15;
export const FAST_MODE_DURATION_SECONDS = 90;
export const POPUP_STALE_AFTER_SECONDS = 15;
export const MAX_BACKOFF_SECONDS = 300;
export function enterFastMode(nowMs) {
    return nowMs + FAST_MODE_DURATION_SECONDS * 1000;
}
function secondsUntilNextReset(snapshot, nowMs) {
    const resets = [snapshot.fiveHour?.resetAtMs, snapshot.weekly?.resetAtMs]
        .filter((value) => typeof value === 'number' && value > nowMs)
        .map(value => Math.max(1, Math.ceil((value - nowMs) / 1000)));
    if (resets.length === 0)
        return null;
    return Math.min(...resets);
}
export function nextSuccessDelaySeconds(nowMs, fastUntilMs, snapshot) {
    const base = nowMs < fastUntilMs ? FAST_INTERVAL_SECONDS : IDLE_INTERVAL_SECONDS;
    const untilReset = secondsUntilNextReset(snapshot, nowMs);
    return untilReset === null ? base : Math.min(base, untilReset);
}
export function failureBackoffSeconds(consecutiveFailures) {
    const failures = Math.max(1, consecutiveFailures);
    return Math.min(MAX_BACKOFF_SECONDS, IDLE_INTERVAL_SECONDS * 2 ** (failures - 1));
}
export function isStale(lastSuccessMs, maxAgeSeconds, nowMs = Date.now()) {
    if (lastSuccessMs === null)
        return true;
    return nowMs - lastSuccessMs >= maxAgeSeconds * 1000;
}
