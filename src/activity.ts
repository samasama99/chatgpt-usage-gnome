// SPDX-License-Identifier: GPL-2.0-or-later

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

Gio._promisify(Gio.File.prototype, 'load_contents_async', 'load_contents_finish');

const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_WINDOW_DAYS = 7;

export interface ModelActivity {
    readonly model: string;
    readonly tokens: number;
    readonly sharePercent: number;
}

export interface ModelActivitySnapshot {
    readonly models: readonly ModelActivity[];
    readonly totalTokens: number;
    readonly scannedAtMs: number;
    readonly windowDays: number;
}

interface TokenRecord {
    readonly timestampMs: number;
    readonly model: string;
    readonly tokens: number;
}

interface CachedFile {
    readonly size: number;
    readonly modifiedSeconds: number;
    readonly records: readonly TokenRecord[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function finiteNumber(value: unknown): number | null {
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function lineItem(value: unknown): Record<string, unknown> | null {
    if (!isRecord(value))
        return null;

    if (typeof value.type === 'string')
        return value;

    return isRecord(value.item) ? value.item : null;
}

function lineTimestampMs(value: unknown): number | null {
    if (!isRecord(value))
        return null;

    const timestamp = value.timestamp;
    if (typeof timestamp !== 'string')
        return null;

    const parsed = Date.parse(timestamp);
    return Number.isFinite(parsed) ? parsed : null;
}

function parseJsonLine(line: string): unknown | null {
    if (!line.trim())
        return null;

    try {
        return JSON.parse(line) as unknown;
    } catch {
        return null;
    }
}

export function parseCodexRollout(text: string): readonly TokenRecord[] {
    const turnModels = new Map<string, string>();
    const pending: Array<{timestampMs: number; turnId: string; tokens: number}> = [];

    for (const rawLine of text.split('\n')) {
        const value = parseJsonLine(rawLine);
        if (value === null)
            continue;

        const item = lineItem(value);
        if (item === null)
            continue;

        const type = item.type;
        const payload = item.payload;
        if (typeof type !== 'string' || !isRecord(payload))
            continue;

        if (type === 'turn_context') {
            const turnId = payload.turn_id;
            const model = payload.model;
            if (typeof turnId === 'string' && turnId && typeof model === 'string' && model)
                turnModels.set(turnId, model);
            continue;
        }

        if (type !== 'token_usage_record')
            continue;

        const turnId = payload.turn_id;
        const usage = payload.usage;
        const timestampMs = lineTimestampMs(value);

        if (typeof turnId !== 'string' || !turnId || !isRecord(usage) || timestampMs === null)
            continue;

        const totalTokens = finiteNumber(usage.total_tokens);
        if (totalTokens === null || totalTokens <= 0)
            continue;

        pending.push({
            timestampMs,
            turnId,
            tokens: Math.trunc(totalTokens),
        });
    }

    const records: TokenRecord[] = [];
    for (const record of pending) {
        const model = turnModels.get(record.turnId);
        if (!model)
            continue;

        records.push({
            timestampMs: record.timestampMs,
            model,
            tokens: record.tokens,
        });
    }

    return records;
}

export function summarizeModelActivity(
    records: readonly TokenRecord[],
    nowMs = Date.now(),
    windowDays = DEFAULT_WINDOW_DAYS,
): ModelActivitySnapshot {
    const cutoffMs = nowMs - windowDays * DAY_MS;
    const totals = new Map<string, number>();

    for (const record of records) {
        if (record.timestampMs < cutoffMs || record.timestampMs > nowMs + 60_000)
            continue;
        totals.set(record.model, (totals.get(record.model) ?? 0) + record.tokens);
    }

    const totalTokens = [...totals.values()].reduce((sum, value) => sum + value, 0);
    const models = [...totals.entries()]
        .map(([model, tokens]) => ({
            model,
            tokens,
            sharePercent: totalTokens > 0 ? tokens / totalTokens * 100 : 0,
        }))
        .sort((a, b) => b.tokens - a.tokens || a.model.localeCompare(b.model));

    return {
        models,
        totalTokens,
        scannedAtMs: nowMs,
        windowDays,
    };
}

function codexHome(): string {
    const configured = (GLib.getenv('CODEX_HOME') ?? '').trim();
    return configured || GLib.build_filenamev([GLib.get_home_dir(), '.codex']);
}

function dateDirectoryParts(date: Date, utc: boolean): readonly [string, string, string] {
    const year = utc ? date.getUTCFullYear() : date.getFullYear();
    const month = (utc ? date.getUTCMonth() : date.getMonth()) + 1;
    const day = utc ? date.getUTCDate() : date.getDate();

    return [
        String(year),
        String(month).padStart(2, '0'),
        String(day).padStart(2, '0'),
    ];
}

function candidateSessionDirectories(nowMs: number, windowDays: number): readonly string[] {
    const root = GLib.build_filenamev([codexHome(), 'sessions']);
    const directories = new Set<string>();

    // Include one extra day because timezone boundaries can put a recent rollout
    // in the neighboring UTC/local calendar directory.
    for (let offset = 0; offset <= windowDays; offset++) {
        const date = new Date(nowMs - offset * DAY_MS);
        for (const utc of [false, true]) {
            const [year, month, day] = dateDirectoryParts(date, utc);
            directories.add(GLib.build_filenamev([root, year, month, day]));
        }
    }

    return [...directories];
}

function rolloutFilesInDirectory(path: string): Array<{path: string; size: number; modifiedSeconds: number}> {
    const directory = Gio.File.new_for_path(path);
    if (!directory.query_exists(null))
        return [];

    let enumerator: Gio.FileEnumerator | null = null;
    const files: Array<{path: string; size: number; modifiedSeconds: number}> = [];

    try {
        enumerator = directory.enumerate_children(
            'standard::name,standard::type,standard::size,time::modified',
            Gio.FileQueryInfoFlags.NONE,
            null,
        );

        let info: Gio.FileInfo | null;
        while ((info = enumerator.next_file(null)) !== null) {
            if (info.get_file_type() !== Gio.FileType.REGULAR)
                continue;

            const name = info.get_name();
            if (!name.endsWith('.jsonl'))
                continue;

            files.push({
                path: GLib.build_filenamev([path, name]),
                size: info.get_size(),
                modifiedSeconds: info.get_attribute_uint64('time::modified'),
            });
        }
    } catch {
        return [];
    } finally {
        try {
            enumerator?.close(null);
        } catch {
            // Directory may have disappeared while scanning.
        }
    }

    return files;
}

export class ModelActivityScanner {
    private readonly cache = new Map<string, CachedFile>();
    private inFlight: Promise<ModelActivitySnapshot> | null = null;

    scan(windowDays = DEFAULT_WINDOW_DAYS): Promise<ModelActivitySnapshot> {
        if (this.inFlight !== null)
            return this.inFlight;

        this.inFlight = this.scanInternal(windowDays).finally(() => {
            this.inFlight = null;
        });
        return this.inFlight;
    }

    private async scanInternal(windowDays: number): Promise<ModelActivitySnapshot> {
        const nowMs = Date.now();
        const seen = new Set<string>();

        for (const directory of candidateSessionDirectories(nowMs, windowDays)) {
            for (const file of rolloutFilesInDirectory(directory)) {
                seen.add(file.path);

                const cached = this.cache.get(file.path);
                if (cached?.size === file.size && cached.modifiedSeconds === file.modifiedSeconds)
                    continue;

                try {
                    const [contents] = await Gio.File.new_for_path(file.path).load_contents_async(null);
                    const text = new TextDecoder().decode(contents);
                    this.cache.set(file.path, {
                        size: file.size,
                        modifiedSeconds: file.modifiedSeconds,
                        records: parseCodexRollout(text),
                    });
                } catch {
                    // A live rollout may be replaced/moved while scanning. Ignore it until next open.
                }
            }
        }

        for (const path of this.cache.keys()) {
            if (!seen.has(path))
                this.cache.delete(path);
        }

        const records: TokenRecord[] = [];
        for (const cached of this.cache.values())
            records.push(...cached.records);

        return summarizeModelActivity(records, nowMs, windowDays);
    }

    clear(): void {
        this.cache.clear();
    }
}
