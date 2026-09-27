// SPDX-License-Identifier: GPL-2.0-or-later

import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import St from 'gi://St';

import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

import type {FetchFailure} from './api.js';
import {formatAge, formatPanel, formatReset, type UsageSnapshot, type UsageWindow} from './model.js';
import type {PollerState} from './poller.js';

const SERVICE_ICON_NAME = 'utilities-system-monitor-symbolic';
const PROGRESS_WIDTH = 236;

const VERTICAL_PROPS = 'orientation' in St.BoxLayout.prototype
    ? {orientation: Clutter.Orientation.VERTICAL}
    : {vertical: true};

const HORIZONTAL_PROPS = 'orientation' in St.BoxLayout.prototype
    ? {orientation: Clutter.Orientation.HORIZONTAL}
    : {vertical: false};

type OpenListener = () => void;
type RefreshListener = () => void;

class ProgressBar {
    readonly actor: St.BoxLayout;
    private readonly fill: St.Widget;

    constructor() {
        this.actor = new St.BoxLayout({
            ...HORIZONTAL_PROPS,
            style_class: 'quota-progress-track',
            width: PROGRESS_WIDTH,
            height: 6,
        } as never);
        this.fill = new St.Widget({
            style_class: 'quota-progress-fill',
            height: 6,
        });
        this.actor.add_child(this.fill);
        this.update(0);
    }

    update(remainingPercent: number): void {
        const percent = Math.max(0, Math.min(100, remainingPercent));
        this.fill.width = Math.round(PROGRESS_WIDTH * percent / 100);

        if (percent <= 10)
            this.fill.set_style_class_name('quota-progress-fill quota-progress-critical');
        else if (percent <= 25)
            this.fill.set_style_class_name('quota-progress-fill quota-progress-warning');
        else
            this.fill.set_style_class_name('quota-progress-fill');
    }
}

class UsageRow {
    readonly actor: St.BoxLayout;
    private readonly value: St.Label;
    private readonly reset: St.Label;
    private readonly progress: ProgressBar;

    constructor(name: string) {
        this.actor = new St.BoxLayout({
            ...VERTICAL_PROPS,
            style_class: 'quota-usage-row',
            x_expand: true,
        } as never);

        const header = new St.BoxLayout({
            ...HORIZONTAL_PROPS,
            style_class: 'quota-usage-row-header',
            x_expand: true,
        } as never);
        const title = new St.Label({
            text: name,
            style_class: 'quota-usage-row-title',
            x_expand: true,
            x_align: Clutter.ActorAlign.START,
        });
        this.value = new St.Label({
            text: '--',
            style_class: 'quota-usage-row-value',
            x_align: Clutter.ActorAlign.END,
        });
        header.add_child(title);
        header.add_child(this.value);

        this.progress = new ProgressBar();
        this.reset = new St.Label({text: '', style_class: 'quota-usage-row-reset'});

        this.actor.add_child(header);
        this.actor.add_child(this.progress.actor);
        this.actor.add_child(this.reset);
    }

    update(window: UsageWindow | null, nowMs: number): void {
        if (window === null) {
            this.value.text = '--';
            this.progress.update(0);
            this.reset.text = 'Not available for this account';
            return;
        }

        this.value.text = `${Math.round(window.remainingPercent)}%`;
        this.progress.update(window.remainingPercent);
        this.reset.text = formatReset(window.resetAtMs, nowMs);
    }
}

function errorText(error: FetchFailure | null): string {
    if (error === null)
        return '';

    switch (error.kind) {
    case 'auth':
        return error.message;
    case 'rate-limit':
        return 'Rate limited; showing the last known values.';
    case 'network':
        return 'Offline; showing the last known values.';
    case 'server':
        return 'Usage service unavailable; showing the last known values.';
    case 'invalid-response':
        return 'Usage response format changed; showing the last known values.';
    }
}

function displayPlan(plan: string | null): string {
    if (plan === null || plan.length === 0)
        return '';
    return plan.charAt(0).toUpperCase() + plan.slice(1);
}

export class UsageIndicator {
    readonly button: PanelMenu.Button;

    private readonly panelLabel: St.Label;
    private readonly fiveHourRow: UsageRow;
    private readonly weeklyRow: UsageRow;
    private readonly planLabel: St.Label;
    private readonly errorLabel: St.Label;
    private readonly footerLabel: St.Label;
    private readonly onOpen: OpenListener;
    private readonly onRefresh: RefreshListener;

    private state: PollerState | null = null;
    private popupTickId = 0;
    private openStateSignalId = 0;

    constructor(onOpen: OpenListener, onRefresh: RefreshListener) {
        this.onOpen = onOpen;
        this.onRefresh = onRefresh;

        this.button = new PanelMenu.Button(0.0, 'Quota Monitor');

        const panelBox = new St.BoxLayout({
            ...HORIZONTAL_PROPS,
            style_class: 'quota-panel',
            y_align: Clutter.ActorAlign.CENTER,
        } as never);
        panelBox.add_child(new St.Icon({
            icon_name: SERVICE_ICON_NAME,
            style_class: 'system-status-icon quota-panel-icon',
            icon_size: 16,
        }));
        this.panelLabel = new St.Label({
            text: '5h -- · W --',
            y_align: Clutter.ActorAlign.CENTER,
        });
        panelBox.add_child(this.panelLabel);
        this.button.add_child(panelBox);

        const contentItem = new PopupMenu.PopupBaseMenuItem({
            reactive: true,
            activate: false,
            hover: false,
            can_focus: false,
        });
        contentItem.remove_style_class_name('popup-inactive-menu-item');

        const content = new St.BoxLayout({
            ...VERTICAL_PROPS,
            style_class: 'quota-popup',
            x_expand: true,
        } as never);

        const header = new St.BoxLayout({
            ...HORIZONTAL_PROPS,
            style_class: 'quota-header',
            x_expand: true,
        } as never);
        header.add_child(new St.Icon({
            icon_name: SERVICE_ICON_NAME,
            style_class: 'quota-header-icon',
            icon_size: 20,
            y_align: Clutter.ActorAlign.CENTER,
        }));

        const heading = new St.BoxLayout({
            ...VERTICAL_PROPS,
            x_expand: true,
        } as never);
        heading.add_child(new St.Label({text: 'Quota Monitor', style_class: 'quota-title'}));
        this.planLabel = new St.Label({text: '', style_class: 'quota-plan'});
        heading.add_child(this.planLabel);
        header.add_child(heading);

        this.fiveHourRow = new UsageRow('5-hour');
        this.weeklyRow = new UsageRow('Weekly');
        this.errorLabel = new St.Label({text: '', style_class: 'quota-error'});
        this.errorLabel.clutter_text.line_wrap = true;
        this.footerLabel = new St.Label({text: 'Not updated yet', style_class: 'quota-footer'});

        content.add_child(header);
        content.add_child(this.fiveHourRow.actor);
        content.add_child(this.weeklyRow.actor);
        content.add_child(this.errorLabel);
        content.add_child(this.footerLabel);
        contentItem.add_child(content);

        (this.button.menu as any).addMenuItem(contentItem);
        (this.button.menu as any).addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        const refreshItem = new PopupMenu.PopupMenuItem('Refresh now');
        refreshItem.connect('activate', () => this.onRefresh());
        (this.button.menu as any).addMenuItem(refreshItem);

        this.openStateSignalId = (this.button.menu as any).connect('open-state-changed', (_menu: unknown, open: boolean) => {
            if (open) {
                this.onOpen();
                this.startPopupTick();
                this.render();
            } else {
                this.stopPopupTick();
            }
        });
    }

    update(state: PollerState): void {
        this.state = state;
        this.render();
    }

    private render(): void {
        if (this.state === null)
            return;

        const nowMs = Date.now();
        const snapshot: UsageSnapshot | null = this.state.usage;

        this.panelLabel.text = formatPanel(snapshot);
        this.planLabel.text = displayPlan(snapshot?.plan ?? null);
        this.planLabel.visible = this.planLabel.text.length > 0;
        this.fiveHourRow.update(snapshot?.fiveHour ?? null, nowMs);
        this.weeklyRow.update(snapshot?.weekly ?? null, nowMs);

        const message = errorText(this.state.error);
        this.errorLabel.text = message;
        this.errorLabel.visible = message.length > 0;

        const age = formatAge(this.state.lastSuccessMs, nowMs);
        this.footerLabel.text = this.state.updating ? `Updating… · ${age}` : age;
    }

    private startPopupTick(): void {
        this.stopPopupTick();
        this.popupTickId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 60, () => {
            this.render();
            return GLib.SOURCE_CONTINUE;
        });
    }

    private stopPopupTick(): void {
        if (this.popupTickId === 0)
            return;
        GLib.source_remove(this.popupTickId);
        this.popupTickId = 0;
    }

    destroy(): void {
        this.stopPopupTick();
        if (this.openStateSignalId !== 0) {
            (this.button.menu as any).disconnect(this.openStateSignalId);
            this.openStateSignalId = 0;
        }
        this.button.destroy();
    }
}
