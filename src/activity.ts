// SPDX-License-Identifier: GPL-2.0-or-later

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import {
    parseCodexRollout,
    summarizeModelActivity,
    type ModelActivitySnapshot,
    type TokenRecord,
} from './activity-model.js';

Gio._promisify(Gio.File.prototype, 'load_contents_async', 'load_contents_finish');

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
                    this.cache.set(file.path, {
                        size: file.size,
                        modifiedSeconds: file.modifiedSeconds,
                        records: parseCodexRollout(new TextDecoder().decode(contents)),
                    });
                } catch {
                    // Ignore a rollout that is replaced/moved while scanning; retry next open.
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
