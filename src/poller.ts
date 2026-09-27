// SPDX-License-Identifier: GPL-2.0-or-later

import GLib from 'gi://GLib';
import {UsageApi, type FetchFailure} from './api.js';
import {detectedConsumption, type UsageSnapshot} from './model.js';
import {failureBackoffSeconds, isStale, nextSuccessSchedule, POPUP_STALE_AFTER_SECONDS} from './schedule.js';

export interface PollerState {
    readonly usage: UsageSnapshot | null;
    readonly lastSuccessMs: number | null;
    readonly error: FetchFailure | null;
    readonly updating: boolean;
}

type StateListener = (state: PollerState) => void;

export class UsagePoller {
    private readonly api = new UsageApi();
    private readonly onState: StateListener;
    private timerId = 0;
    private stopped = true;
    private inFlight = false;
    private activityIndex: number | null = null;
    private consecutiveFailures = 0;
    private state: PollerState = {usage: null, lastSuccessMs: null, error: null, updating: false};

    constructor(onState: StateListener) {
        this.onState = onState;
    }

    start(): void {
        if (!this.stopped)
            return;
        this.stopped = false;
        void this.refreshNow();
    }

    stop(): void {
        if (this.stopped)
            return;
        this.stopped = true;
        if (this.timerId !== 0) {
            GLib.source_remove(this.timerId);
            this.timerId = 0;
        }
        this.api.dispose();
    }

    refreshIfStale(maxAgeSeconds = POPUP_STALE_AFTER_SECONDS): void {
        if (!this.stopped && !this.inFlight && isStale(this.state.lastSuccessMs, maxAgeSeconds))
            void this.refreshNow();
    }

    refreshAfterResume(): void {
        if (!this.stopped)
            void this.refreshNow();
    }

    forceRefresh(): void {
        if (!this.stopped)
            void this.refreshNow();
    }

    private emit(patch: Partial<PollerState>): void {
        this.state = {...this.state, ...patch};
        this.onState(this.state);
    }

    private schedule(seconds: number): void {
        if (this.stopped)
            return;

        if (this.timerId !== 0)
            GLib.source_remove(this.timerId);

        const delay = Math.max(1, Math.ceil(seconds));
        this.timerId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, delay, () => {
            this.timerId = 0;
            void this.refreshNow();
            return GLib.SOURCE_REMOVE;
        });
    }

    private async refreshNow(): Promise<void> {
        if (this.stopped || this.inFlight)
            return;

        if (this.timerId !== 0) {
            GLib.source_remove(this.timerId);
            this.timerId = 0;
        }

        this.inFlight = true;
        this.emit({updating: true});

        const previous = this.state.usage;
        const result = await this.api.fetch();

        if (this.stopped)
            return;

        this.inFlight = false;
        const nowMs = Date.now();

        if (result.ok) {
            if (detectedConsumption(previous, result.usage))
                this.activityIndex = 0;

            this.consecutiveFailures = 0;
            this.emit({usage: result.usage, lastSuccessMs: nowMs, error: null, updating: false});

            const schedule = nextSuccessSchedule(nowMs, this.activityIndex, result.usage);
            this.activityIndex = schedule.nextActivityIndex;
            this.schedule(schedule.delaySeconds);
            return;
        }

        this.consecutiveFailures += 1;
        this.emit({error: result.error, updating: false});
        this.schedule(result.error.retryAfterSeconds ??
            failureBackoffSeconds(this.consecutiveFailures));
    }
}
