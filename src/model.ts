export interface UsageWindow {
    readonly usedPercent: number;
    readonly remainingPercent: number;
    readonly resetAtMs: number | null;
    readonly windowSeconds: number | null;
}

export interface UsageSnapshot {
    readonly fiveHour: UsageWindow | null;
    readonly weekly: UsageWindow | null;
    readonly plan: string | null;
    readonly fetchedAtMs: number;
}

interface ParsedWindow extends UsageWindow {
    readonly sourceKey: string;
}

const WEEKLY_THRESHOLD_SECONDS = 2 * 24 * 60 * 60;

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function finiteNumber(value: unknown): number | null {
    if (typeof value !== 'number' || !Number.isFinite(value))
        return null;
    return value;
}

function clampPercent(value: number): number {
    return Math.max(0, Math.min(100, value));
}

function firstFiniteNumber(record: Record<string, unknown>, keys: readonly string[]): number | null {
    for (const key of keys) {
        const value = finiteNumber(record[key]);
        if (value !== null)
            return value;
    }
    return null;
}

function parseResetAtMs(record: Record<string, unknown>): number | null {
    const resetMs = firstFiniteNumber(record, ['reset_time_ms', 'resetAtMs']);
    if (resetMs !== null && resetMs > 0)
        return Math.trunc(resetMs);

    const resetAt = record.reset_at ?? record.resetAt;
    if (typeof resetAt === 'number' && Number.isFinite(resetAt) && resetAt > 0)
        return resetAt > 10_000_000_000 ? Math.trunc(resetAt) : Math.trunc(resetAt * 1000);

    if (typeof resetAt === 'string') {
        const parsed = Date.parse(resetAt);
        if (Number.isFinite(parsed))
            return parsed;
    }

    return null;
}

function parseWindow(sourceKey: string, value: unknown): ParsedWindow | null {
    if (!isRecord(value))
        return null;

    const used = firstFiniteNumber(value, ['used_percent', 'usedPercent']);
    const left = firstFiniteNumber(value, ['percent_left', 'remaining_percent', 'remainingPercent']);

    if (used === null && left === null)
        return null;

    const usedPercent = clampPercent(used ?? (100 - (left ?? 0)));
    const remainingPercent = clampPercent(left ?? (100 - usedPercent));
    const windowSeconds = firstFiniteNumber(value, ['limit_window_seconds', 'window_seconds', 'windowSeconds']);

    return {
        sourceKey,
        usedPercent,
        remainingPercent,
        resetAtMs: parseResetAtMs(value),
        windowSeconds: windowSeconds === null ? null : Math.max(0, Math.trunc(windowSeconds)),
    };
}

function classifyWindow(window: ParsedWindow): 'fiveHour' | 'weekly' | null {
    const key = window.sourceKey.toLowerCase();

    if (key.includes('weekly') || key.includes('week'))
        return 'weekly';
    if (key.includes('five') || key.includes('5h') || key.includes('primary_window') && window.windowSeconds !== null && window.windowSeconds < WEEKLY_THRESHOLD_SECONDS)
        return 'fiveHour';

    if (window.windowSeconds !== null)
        return window.windowSeconds >= WEEKLY_THRESHOLD_SECONDS ? 'weekly' : 'fiveHour';

    if (key.includes('primary'))
        return 'fiveHour';
    if (key.includes('secondary'))
        return 'weekly';

    return null;
}

function collectWindows(rateLimit: Record<string, unknown>): readonly ParsedWindow[] {
    const windows: ParsedWindow[] = [];

    for (const [key, value] of Object.entries(rateLimit)) {
        const parsed = parseWindow(key, value);
        if (parsed)
            windows.push(parsed);
    }

    return windows;
}

export function parseUsageResponse(value: unknown, fetchedAtMs = Date.now()): UsageSnapshot {
    if (!isRecord(value))
        throw new Error('Usage response is not a JSON object.');

    const rateLimitValue = value.rate_limit ?? value.rate_limits;
    if (!isRecord(rateLimitValue))
        throw new Error('Usage response has no rate-limit object.');

    let fiveHour: UsageWindow | null = null;
    let weekly: UsageWindow | null = null;

    for (const window of collectWindows(rateLimitValue)) {
        const kind = classifyWindow(window);
        if (kind === 'fiveHour' && fiveHour === null)
            fiveHour = window;
        else if (kind === 'weekly' && weekly === null)
            weekly = window;
    }

    if (fiveHour === null && weekly === null)
        throw new Error('Usage response contains no usable rate-limit window.');

    const planValue = value.plan_type ?? value.plan;
    const plan = typeof planValue === 'string' && planValue.trim() ? planValue.trim() : null;

    return {fiveHour, weekly, plan, fetchedAtMs};
}

function equalWindow(a: UsageWindow | null, b: UsageWindow | null): boolean {
    if (a === b)
        return true;
    if (a === null || b === null)
        return false;

    return a.usedPercent === b.usedPercent &&
        a.remainingPercent === b.remainingPercent &&
        a.resetAtMs === b.resetAtMs &&
        a.windowSeconds === b.windowSeconds;
}

export function fiveHourChanged(previous: UsageSnapshot | null, next: UsageSnapshot): boolean {
    if (previous === null)
        return false;
    return !equalWindow(previous.fiveHour, next.fiveHour);
}

export function formatPanel(snapshot: UsageSnapshot | null): string {
    if (snapshot === null)
        return '5h -- · W --';

    const five = snapshot.fiveHour === null ? '--' : `${Math.round(snapshot.fiveHour.remainingPercent)}%`;
    const weekly = snapshot.weekly === null ? '--' : `${Math.round(snapshot.weekly.remainingPercent)}%`;

    if (snapshot.fiveHour === null && snapshot.weekly !== null)
        return `W ${weekly}`;
    if (snapshot.weekly === null && snapshot.fiveHour !== null)
        return `5h ${five}`;

    return `5h ${five} · W ${weekly}`;
}

export function formatReset(resetAtMs: number | null, nowMs = Date.now()): string {
    if (resetAtMs === null)
        return 'reset time unavailable';

    const deltaMs = resetAtMs - nowMs;
    if (deltaMs <= 0)
        return 'resetting now';

    const totalMinutes = Math.ceil(deltaMs / 60_000);
    const days = Math.floor(totalMinutes / (24 * 60));
    const hours = Math.floor((totalMinutes % (24 * 60)) / 60);
    const minutes = totalMinutes % 60;

    if (days > 0)
        return `resets in ${days}d ${hours}h`;
    if (hours > 0)
        return `resets in ${hours}h ${minutes}m`;
    return `resets in ${minutes}m`;
}

export function formatAge(timestampMs: number | null, nowMs = Date.now()): string {
    if (timestampMs === null)
        return 'not updated yet';

    const seconds = Math.max(0, Math.floor((nowMs - timestampMs) / 1000));
    if (seconds < 10)
        return 'updated just now';
    if (seconds < 60)
        return `updated ${seconds}s ago`;

    const minutes = Math.floor(seconds / 60);
    if (minutes < 60)
        return `updated ${minutes}m ago`;

    const hours = Math.floor(minutes / 60);
    return `updated ${hours}h ago`;
}
