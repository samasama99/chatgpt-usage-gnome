// SPDX-License-Identifier: GPL-2.0-or-later

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import {
    combineModelActivity,
    mergeModelActivity,
    OPENCODE_CHATGPT_PROVIDERS,
    OPENCODE_CLAUDE_PROVIDERS,
    parseClaudeCodeSession,
    parseCodexRollout,
    parseOpenCodeStatsDetailed,
    summarizeModelActivity,
    type ModelActivitySnapshot,
    type TokenBreakdown,
    type TokenRecord,
} from './activity-model.js';
import type {ProviderId} from './settings-model.js';

Gio._promisify(Gio.File.prototype, 'load_contents_async', 'load_contents_finish');
Gio._promisify(Gio.Subprocess.prototype, 'communicate_utf8_async', 'communicate_utf8_finish');

const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_WINDOW_DAYS = 7;

interface CachedFile {
    readonly size: number;
    readonly modifiedSeconds: number;
    readonly records: readonly TokenRecord[];
}

function codexHome(): string {
    const configured = (GLib.getenv('CODEX_HOME') ?? '').trim();
    return configured || GLib.build_filenamev([GLib.get_home_dir(), '.codex']);
}

function claudeProjectsRoot(): string {
    const configured = (GLib.getenv('CLAUDE_CONFIG_DIR') ?? '').trim();
    const base = configured || GLib.build_filenamev([GLib.get_home_dir(), '.claude']);
    return GLib.build_filenamev([base, 'projects']);
}

function childDirectories(path: string): string[] {
    const directory = Gio.File.new_for_path(path);
    if (!directory.query_exists(null))
        return [];

    let enumerator: Gio.FileEnumerator | null = null;
    const children: string[] = [];
    try {
        enumerator = directory.enumerate_children(
            'standard::name,standard::type',
            Gio.FileQueryInfoFlags.NOFOLLOW_SYMLINKS,
            null,
        );
        let info: Gio.FileInfo | null;
        while ((info = enumerator.next_file(null)) !== null) {
            if (info.get_file_type() === Gio.FileType.DIRECTORY)
                children.push(GLib.build_filenamev([path, info.get_name()]));
        }
    } catch {
        return [];
    } finally {
        try {
            enumerator?.close(null);
        } catch {
            // The directory may disappear while being scanned.
        }
    }
    return children;
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
            // A live session directory may disappear while being scanned.
        }
    }

    return files;
}

type RecordParser = (text: string) => readonly TokenRecord[];

export class ModelActivityScanner {
    private readonly cache = new Map<string, CachedFile>();
    private readonly openCodePath = GLib.find_program_in_path('opencode');
    private inFlight: Promise<ModelActivitySnapshot> | null = null;
    private openCodeCache: {atMs: number; totals: ReadonlyMap<string, TokenBreakdown>} | null = null;
    private openCodeProcess: Gio.Subprocess | null = null;

    scan(
        providers: readonly ProviderId[],
        windowDays = DEFAULT_WINDOW_DAYS,
    ): Promise<ModelActivitySnapshot> {
        if (this.inFlight !== null)
            return this.inFlight;

        this.inFlight = this.scanInternal(providers, windowDays).finally(() => {
            this.inFlight = null;
        });
        return this.inFlight;
    }

    private async loadFile(
        file: {path: string; size: number; modifiedSeconds: number},
        parse: RecordParser,
        seen: Set<string>,
    ): Promise<void> {
        seen.add(file.path);

        const cached = this.cache.get(file.path);
        if (cached?.size === file.size && cached.modifiedSeconds === file.modifiedSeconds)
            return;

        try {
            const [contents] = await Gio.File.new_for_path(file.path).load_contents_async(null);
            this.cache.set(file.path, {
                size: file.size,
                modifiedSeconds: file.modifiedSeconds,
                records: parse(new TextDecoder().decode(contents)),
            });
        } catch {
            // Ignore a log that is replaced/moved while scanning; retry next open.
        }
    }

    private cachedRecords(paths: Iterable<string>): TokenRecord[] {
        const records: TokenRecord[] = [];
        const ids = new Set<string>();
        for (const path of paths) {
            for (const record of this.cache.get(path)?.records ?? []) {
                if (record.id !== undefined) {
                    if (ids.has(record.id))
                        continue;
                    ids.add(record.id);
                }
                records.push(record);
            }
        }
        return records;
    }

    private async scanCodex(nowMs: number, windowDays: number, seen: Set<string>): Promise<ModelActivitySnapshot> {
        const paths: string[] = [];
        for (const directory of candidateSessionDirectories(nowMs, windowDays)) {
            for (const file of rolloutFilesInDirectory(directory)) {
                await this.loadFile(file, parseCodexRollout, seen);
                paths.push(file.path);
            }
        }
        return summarizeModelActivity(this.cachedRecords(paths), nowMs, windowDays, 'Codex');
    }

    private async scanClaudeCode(nowMs: number, windowDays: number, seen: Set<string>): Promise<ModelActivitySnapshot> {
        const cutoffSeconds = Math.floor((nowMs - windowDays * DAY_MS) / 1000);
        const paths: string[] = [];

        for (const project of childDirectories(claudeProjectsRoot())) {
            for (const file of rolloutFilesInDirectory(project)) {
                // Session logs untouched since before the window hold no recent usage.
                if (file.modifiedSeconds < cutoffSeconds)
                    continue;
                await this.loadFile(file, parseClaudeCodeSession, seen);
                paths.push(file.path);
            }
        }
        return summarizeModelActivity(this.cachedRecords(paths), nowMs, windowDays, 'Claude Code');
    }

    private async scanInternal(
        providers: readonly ProviderId[],
        windowDays: number,
    ): Promise<ModelActivitySnapshot> {
        const nowMs = Date.now();
        const seen = new Set<string>();
        const snapshots: ModelActivitySnapshot[] = [];

        if (providers.includes('chatgpt'))
            snapshots.push(await this.scanCodex(nowMs, windowDays, seen));
        if (providers.includes('claude'))
            snapshots.push(await this.scanClaudeCode(nowMs, windowDays, seen));

        for (const path of this.cache.keys()) {
            if (!seen.has(path))
                this.cache.delete(path);
        }

        const local = combineModelActivity(snapshots, nowMs, windowDays);
        const openCodeTotals = await this.readOpenCodeStats(windowDays, nowMs);
        const allowed = [
            ...(providers.includes('chatgpt') ? OPENCODE_CHATGPT_PROVIDERS : []),
            ...(providers.includes('claude') ? OPENCODE_CLAUDE_PROVIDERS : []),
        ];
        return mergeModelActivity(local, openCodeTotals, allowed);
    }

    private async readOpenCodeStats(windowDays: number, nowMs: number): Promise<ReadonlyMap<string, TokenBreakdown>> {
        const executable = this.openCodePath;
        if (!executable)
            return new Map();

        // Avoid repeatedly starting OpenCode if the popup is opened several times in
        // quick succession.
        if (this.openCodeCache !== null && nowMs - this.openCodeCache.atMs < 60_000)
            return this.openCodeCache.totals;

        try {
            const process = Gio.Subprocess.new(
                [executable, 'stats', '--days', String(windowDays), '--models'],
                Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_SILENCE,
            );
            this.openCodeProcess = process;

            const [, stdout] = await process.communicate_utf8_async(null, null);
            if (!process.get_successful() || typeof stdout !== 'string')
                return new Map();

            const totals = parseOpenCodeStatsDetailed(stdout);
            this.openCodeCache = {atMs: nowMs, totals};
            return totals;
        } catch {
            return new Map();
        } finally {
            this.openCodeProcess = null;
        }
    }

    clear(): void {
        this.openCodeProcess?.force_exit();
        this.openCodeProcess = null;
        this.cache.clear();
        this.openCodeCache = null;
    }
}
