// SPDX-License-Identifier: GPL-2.0-or-later
import GLib from 'gi://GLib';
import {UsageApi} from './api.js';
import {detectedConsumption} from './model.js';
import {failureBackoffSeconds, isStale, nextSuccessSchedule, POPUP_STALE_AFTER_SECONDS} from './schedule.js';

export class UsagePoller {
    api = new UsageApi();
    onState;
    timerId = 0;
    stopped = true;
    inFlight = false;
    activityIndex = null;
    consecutiveFailures = 0;
    state = {usage: null, lastSuccessMs: null, error: null, updating: false};

    constructor(onState) {
        this.onState = onState;
    }
    start() {
        if (!this.stopped)
            return;
        this.stopped = false;
        void this.refreshNow();
    }
    stop() {
        if (this.stopped)
            return;
        this.stopped = true;
        if (this.timerId !== 0) {
            GLib.source_remove(this.timerId);
            this.timerId = 0;
        }
        this.api.dispose();
    }
    refreshIfStale(maxAgeSeconds = POPUP_STALE_AFTER_SECONDS) {
        if (!this.stopped && !this.inFlight && isStale(this.state.lastSuccessMs, maxAgeSeconds))
            void this.refreshNow();
    }
    refreshAfterResume() {
        if (!this.stopped)
            void this.refreshNow();
    }
    forceRefresh() {
        if (!this.stopped)
            void this.refreshNow();
    }
    emit(patch) {
        this.state = {...this.state, ...patch};
        this.onState(this.state);
    }
    schedule(seconds) {
        if (this.stopped)
            return;
        if (this.timerId !== 0)
            GLib.source_remove(this.timerId);

        this.timerId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, Math.max(1, Math.ceil(seconds)), () => {
            this.timerId = 0;
            void this.refreshNow();
            return GLib.SOURCE_REMOVE;
        });
    }
    async refreshNow() {
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
