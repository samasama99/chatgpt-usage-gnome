import GLib from 'gi://GLib';
import { UsageApi } from './api.js';
import { fiveHourChanged } from './model.js';
import { enterFastMode, failureBackoffSeconds, isStale, nextSuccessDelaySeconds, POPUP_STALE_AFTER_SECONDS, } from './schedule.js';
export class UsagePoller {
    api = new UsageApi();
    onState;
    timerId = 0;
    stopped = true;
    inFlight = false;
    fastUntilMs = 0;
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
        if (this.stopped || this.inFlight)
            return;
        if (isStale(this.state.lastSuccessMs, maxAgeSeconds))
            void this.refreshNow();
    }
    refreshAfterResume() {
        if (this.stopped)
            return;
        void this.refreshNow();
    }
    forceRefresh() {
        if (this.stopped)
            return;
        void this.refreshNow();
    }
    emit(patch) {
        this.state = { ...this.state, ...patch };
        this.onState(this.state);
    }
    schedule(seconds) {
        if (this.stopped)
            return;
        if (this.timerId !== 0) {
            GLib.source_remove(this.timerId);
            this.timerId = 0;
        }
        const delay = Math.max(1, Math.ceil(seconds));
        this.timerId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, delay, () => {
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
        this.emit({ updating: true });
        const previous = this.state.usage;
        const result = await this.api.fetch();
        if (this.stopped)
            return;
        this.inFlight = false;
        const nowMs = Date.now();
        if (result.ok) {
            if (fiveHourChanged(previous, result.usage))
                this.fastUntilMs = enterFastMode(nowMs);
            this.consecutiveFailures = 0;
            this.emit({usage: result.usage, lastSuccessMs: nowMs, error: null, updating: false});
            this.schedule(nextSuccessDelaySeconds(nowMs, this.fastUntilMs, result.usage));
            return;
        }
        this.consecutiveFailures += 1;
        this.emit({ error: result.error, updating: false });
        const retryAfter = result.error.retryAfterSeconds;
        const delay = retryAfter !== null ? Math.max(1, retryAfter) : failureBackoffSeconds(this.consecutiveFailures);
        this.schedule(delay);
    }
}
