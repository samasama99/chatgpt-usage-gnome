// SPDX-License-Identifier: GPL-2.0-or-later

import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import St from 'gi://St';

import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

import {
    compactModelActivity,
    displayModelName,
    formatTokenCount,
    type ModelActivitySnapshot,
} from './activity-model.js';
import type {FetchFailure} from './api.js';
import {formatAge, formatPanel, formatReset, progressScale, type UsageSnapshot, type UsageWindow} from './model.js';
import type {PollerState} from './poller.js';
import type {IndicatorPreferences} from './settings-model.js';

const VERTICAL_PROPS = 'orientation' in St.BoxLayout.prototype
    ? {orientation: Clutter.Orientation.VERTICAL}
    : {vertical: true};

const HORIZONTAL_PROPS = 'orientation' in St.BoxLayout.prototype
    ? {orientation: Clutter.Orientation.HORIZONTAL}
    : {vertical: false};

type OpenListener = () => void;
type RefreshListener = () => void;
type ActivityLoader = () => Promise<ModelActivitySnapshot>;
type PreferencesListener = () => void;

class ProgressBar {
    readonly actor: St.Bin;
    private readonly fill: St.Widget;

    constructor() {
        this.fill = new St.Widget({
            style_class: 'chatgpt-progress-fill',
            x_expand: true,
            x_align: Clutter.ActorAlign.FILL,
            height: 5,
        });
        this.fill.set_pivot_point(0, 0.5);

        this.actor = new St.Bin({
            style_class: 'chatgpt-progress-track',
            x_expand: true,
            x_align: Clutter.ActorAlign.FILL,
            height: 5,
        });
        this.actor.set_child(this.fill);
        this.update(0);
    }

    update(remainingPercent: number): void {
        const percent = Math.max(0, Math.min(100, remainingPercent));

        // Keep the child allocated at the full track width and only transform the
        // painted width. This avoids a preferred-size feedback loop in St.BoxLayout
        // that made the bar change size each time the popup was reopened.
        this.fill.scale_x = progressScale(percent);

        if (percent <= 10)
            this.fill.set_style_class_name('chatgpt-progress-fill chatgpt-progress-critical');
        else if (percent <= 25)
            this.fill.set_style_class_name('chatgpt-progress-fill chatgpt-progress-warning');
        else
            this.fill.set_style_class_name('chatgpt-progress-fill');
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
            style_class: 'chatgpt-usage-card',
            x_expand: true,
        } as never);

        const header = new St.BoxLayout({
            ...HORIZONTAL_PROPS,
            style_class: 'chatgpt-usage-header',
            x_expand: true,
        } as never);

        const title = new St.Label({
            text: name,
            style_class: 'chatgpt-usage-title',
            x_expand: true,
            x_align: Clutter.ActorAlign.START,
            y_align: Clutter.ActorAlign.CENTER,
        });
        this.value = new St.Label({
            text: '--',
            style_class: 'chatgpt-usage-value',
            x_align: Clutter.ActorAlign.END,
            y_align: Clutter.ActorAlign.CENTER,
        });

        header.add_child(title);
        header.add_child(this.value);

        this.progress = new ProgressBar();
        this.reset = new St.Label({
            text: '',
            style_class: 'chatgpt-reset',
        });

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

class ModelActivitySection {
    readonly actor: St.BoxLayout;
    private readonly rows: St.BoxLayout;
    private readonly subtitle: St.Label;

    constructor() {
        this.actor = new St.BoxLayout({
            ...VERTICAL_PROPS,
            style_class: 'chatgpt-activity',
            x_expand: true,
        } as never);

        const heading = new St.BoxLayout({
            ...HORIZONTAL_PROPS,
            style_class: 'chatgpt-activity-heading',
            x_expand: true,
        } as never);
        heading.add_child(new St.Label({
            text: 'Local model activity',
            style_class: 'chatgpt-activity-title',
            x_expand: true,
        }));
        this.subtitle = new St.Label({
            text: 'Local · last 7 days',
            style_class: 'chatgpt-activity-subtitle',
            x_align: Clutter.ActorAlign.END,
        });
        heading.add_child(this.subtitle);

        this.rows = new St.BoxLayout({
            ...VERTICAL_PROPS,
            style_class: 'chatgpt-activity-rows',
            x_expand: true,
        } as never);

        this.actor.add_child(heading);
        this.actor.add_child(this.rows);
        this.showLoading();
    }

    showLoading(): void {
        this.clearRows();
        this.rows.add_child(new St.Label({
            text: 'Reading local model activity…',
            style_class: 'chatgpt-activity-empty',
        }));
    }

    showError(): void {
        this.clearRows();
        this.rows.add_child(new St.Label({
            text: 'Local model activity unavailable',
            style_class: 'chatgpt-activity-empty',
        }));
    }

    update(snapshot: ModelActivitySnapshot): void {
        this.clearRows();
        const sources = snapshot.sources.length > 0 ? snapshot.sources.join(' + ') : 'Local';
        this.subtitle.text = `${sources} · ${snapshot.windowDays} days · ${formatTokenCount(snapshot.totalTokens)} tokens`;

        const rows = compactModelActivity(snapshot, 4);
        if (rows.length === 0) {
            this.rows.add_child(new St.Label({
                text: 'No recent local model activity found',
                style_class: 'chatgpt-activity-empty',
            }));
            return;
        }

        for (const row of rows) {
            const actor = new St.BoxLayout({
                ...HORIZONTAL_PROPS,
                style_class: 'chatgpt-activity-row',
                x_expand: true,
            } as never);

            actor.add_child(new St.Label({
                text: displayModelName(row.model),
                style_class: 'chatgpt-activity-model',
                x_expand: true,
                x_align: Clutter.ActorAlign.START,
            }));

            actor.add_child(new St.Label({
                text: `${Math.round(row.sharePercent)}% · ${formatTokenCount(row.tokens)}`,
                style_class: 'chatgpt-activity-value',
                x_align: Clutter.ActorAlign.END,
            }));

            this.rows.add_child(actor);
        }
    }

    private clearRows(): void {
        for (const child of this.rows.get_children())
            child.destroy();
    }
}

function errorText(error: FetchFailure | null): string {
    if (error === null)
        return '';

    switch (error.kind) {
    case 'auth':
        return error.message;
    case 'rate-limit':
        return 'Rate limited · showing the last known values';
    case 'network':
        return 'Offline · showing the last known values';
    case 'server':
        return 'Usage service unavailable · showing the last known values';
    case 'invalid-response':
        return 'Usage response changed · showing the last known values';
    }
}

function displayPlan(plan: string | null): string {
    if (plan === null || plan.length === 0)
        return '';
    return `${plan.charAt(0).toUpperCase() + plan.slice(1)} plan`;
}

export class UsageIndicator {
    readonly button: PanelMenu.Button;

    private readonly serviceIcon: Gio.Icon;
    private readonly panelBox: St.BoxLayout;
    private readonly panelIcon: St.Icon;
    private readonly panelLabel: St.Label;
    private readonly fiveHourRow: UsageRow;
    private readonly weeklyRow: UsageRow;
    private readonly planLabel: St.Label;
    private readonly errorLabel: St.Label;
    private readonly footerLabel: St.Label;
    private readonly onOpen: OpenListener;
    private readonly onRefresh: RefreshListener;
    private readonly onLoadActivity: ActivityLoader;
    private readonly onOpenPreferences: PreferencesListener;
    private readonly activitySection: ModelActivitySection;
    private readonly activityDivider: St.Widget;

    private state: PollerState | null = null;
    private popupTickId = 0;
    private openStateSignalId = 0;
    private activityRequestId = 0;
    private destroyed = false;
    private preferences: IndicatorPreferences;

    constructor(
        iconPath: string,
        preferences: IndicatorPreferences,
        onOpen: OpenListener,
        onRefresh: RefreshListener,
        onLoadActivity: ActivityLoader,
        onOpenPreferences: PreferencesListener,
    ) {
        this.onOpen = onOpen;
        this.onRefresh = onRefresh;
        this.onLoadActivity = onLoadActivity;
        this.onOpenPreferences = onOpenPreferences;
        this.preferences = preferences;
        this.serviceIcon = new Gio.FileIcon({
            file: Gio.File.new_for_path(iconPath),
        });

        this.button = new PanelMenu.Button(0.0, 'ChatGPT Usage');

        this.panelBox = new St.BoxLayout({
            ...HORIZONTAL_PROPS,
            style_class: 'chatgpt-panel',
            y_align: Clutter.ActorAlign.CENTER,
        } as never);
        this.panelIcon = new St.Icon({
            gicon: this.serviceIcon,
            style_class: 'system-status-icon chatgpt-panel-icon',
            icon_size: 16,
        });
        this.panelBox.add_child(this.panelIcon);
        this.panelLabel = new St.Label({
            text: '5h -- · W --',
            style_class: 'chatgpt-panel-label',
            y_align: Clutter.ActorAlign.CENTER,
        });
        this.panelBox.add_child(this.panelLabel);
        this.button.add_child(this.panelBox);

        const contentItem = new PopupMenu.PopupBaseMenuItem({
            reactive: false,
            activate: false,
            hover: false,
            can_focus: false,
        });

        const content = new St.BoxLayout({
            ...VERTICAL_PROPS,
            style_class: 'chatgpt-popup',
            x_expand: true,
        } as never);

        const header = new St.BoxLayout({
            ...HORIZONTAL_PROPS,
            style_class: 'chatgpt-header',
            x_expand: true,
        } as never);

        const iconShell = new St.Bin({
            style_class: 'chatgpt-header-icon-shell',
            y_align: Clutter.ActorAlign.CENTER,
        });
        iconShell.set_child(new St.Icon({
            gicon: this.serviceIcon,
            style_class: 'chatgpt-header-icon',
            icon_size: 22,
        }));
        header.add_child(iconShell);

        const heading = new St.BoxLayout({
            ...VERTICAL_PROPS,
            x_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
        } as never);
        heading.add_child(new St.Label({
            text: 'ChatGPT Usage',
            style_class: 'chatgpt-title',
        }));
        this.planLabel = new St.Label({
            text: '',
            style_class: 'chatgpt-plan',
        });
        heading.add_child(this.planLabel);
        header.add_child(heading);

        this.fiveHourRow = new UsageRow('5-hour');
        this.weeklyRow = new UsageRow('Weekly');

        this.activitySection = new ModelActivitySection();

        this.errorLabel = new St.Label({
            text: '',
            style_class: 'chatgpt-error',
        });
        this.errorLabel.clutter_text.line_wrap = true;

        this.footerLabel = new St.Label({
            text: 'Not updated yet',
            style_class: 'chatgpt-footer',
            x_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
        });

        const footer = new St.BoxLayout({
            ...HORIZONTAL_PROPS,
            style_class: 'chatgpt-footer-row',
            x_expand: true,
        } as never);
        footer.add_child(this.footerLabel);

        const settingsButton = new St.Button({
            label: 'Settings',
            style_class: 'chatgpt-refresh-button',
            can_focus: true,
            reactive: true,
            track_hover: true,
            y_align: Clutter.ActorAlign.CENTER,
        });
        settingsButton.connect('clicked', () => this.onOpenPreferences());
        footer.add_child(settingsButton);

        const refreshButton = new St.Button({
            label: 'Refresh',
            style_class: 'chatgpt-refresh-button',
            can_focus: true,
            reactive: true,
            track_hover: true,
            y_align: Clutter.ActorAlign.CENTER,
        });
        refreshButton.connect('clicked', () => {
            this.onRefresh();
            if (this.preferences.showLocalActivity)
                this.refreshActivity();
        });
        footer.add_child(refreshButton);

        content.add_child(header);
        content.add_child(this.fiveHourRow.actor);
        content.add_child(this.weeklyRow.actor);
        this.activityDivider = new St.Widget({
            style_class: 'chatgpt-section-divider',
            height: 1,
            x_expand: true,
        });
        content.add_child(this.activityDivider);
        content.add_child(this.activitySection.actor);
        content.add_child(this.errorLabel);
        content.add_child(footer);
        contentItem.add_child(content);

        (this.button.menu as any).addMenuItem(contentItem);

        this.openStateSignalId = (this.button.menu as any).connect(
            'open-state-changed',
            (_menu: unknown, open: boolean) => {
                if (open) {
                    this.onOpen();
                    if (this.preferences.showLocalActivity)
                        this.refreshActivity();
                    this.startPopupTick();
                    this.render();
                } else {
                    this.stopPopupTick();
                }
            },
        );

        this.applyPreferences(preferences);
    }

    applyPreferences(preferences: IndicatorPreferences): void {
        this.preferences = preferences;
        this.panelIcon.visible = preferences.showPanelIcon;
        this.activitySection.actor.visible = preferences.showLocalActivity;
        this.activityDivider.visible = preferences.showLocalActivity;

        if (!preferences.showLocalActivity)
            this.activityRequestId += 1;

        if (preferences.panelBackgroundEnabled) {
            this.panelBox.set_style(
                `background-color: ${preferences.panelBackgroundColor}; ` +
                'border-radius: 8px; padding: 2px 7px;',
            );
        } else {
            this.panelBox.set_style(null);
        }
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
        this.footerLabel.text = this.state.updating ? `Updating…  ·  ${age}` : age;
    }

    private refreshActivity(): void {
        const requestId = ++this.activityRequestId;
        this.activitySection.showLoading();

        void this.onLoadActivity()
            .then(snapshot => {
                if (!this.destroyed && requestId === this.activityRequestId)
                    this.activitySection.update(snapshot);
            })
            .catch(() => {
                if (!this.destroyed && requestId === this.activityRequestId)
                    this.activitySection.showError();
            });
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
        this.destroyed = true;
        this.activityRequestId += 1;
        this.stopPopupTick();
        if (this.openStateSignalId !== 0) {
            (this.button.menu as any).disconnect(this.openStateSignalId);
            this.openStateSignalId = 0;
        }
        this.button.destroy();
    }
}
