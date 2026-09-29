// SPDX-License-Identifier: GPL-2.0-or-later
import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import St from 'gi://St';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import {compactModelActivity, displayModelName, formatTokenCount} from './activity-model.js';
import {formatAge, formatPanel, formatReset, progressScale} from './model.js';

const VERTICAL_PROPS = 'orientation' in St.BoxLayout.prototype
    ? {orientation: Clutter.Orientation.VERTICAL}
    : {vertical: true};
const HORIZONTAL_PROPS = 'orientation' in St.BoxLayout.prototype
    ? {orientation: Clutter.Orientation.HORIZONTAL}
    : {vertical: false};

class ProgressBar {
    actor;
    fill;

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

    update(remainingPercent) {
        const percent = Math.max(0, Math.min(100, remainingPercent));
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
    actor;
    value;
    reset;
    progress;

    constructor(name) {
        this.actor = new St.BoxLayout({
            ...VERTICAL_PROPS,
            style_class: 'chatgpt-usage-card',
            x_expand: true,
        });

        const header = new St.BoxLayout({
            ...HORIZONTAL_PROPS,
            style_class: 'chatgpt-usage-header',
            x_expand: true,
        });

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

    update(window, nowMs) {
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
    actor;
    rows;
    subtitle;

    constructor() {
        this.actor = new St.BoxLayout({
            ...VERTICAL_PROPS,
            style_class: 'chatgpt-activity',
            x_expand: true,
        });

        const heading = new St.BoxLayout({
            ...HORIZONTAL_PROPS,
            style_class: 'chatgpt-activity-heading',
            x_expand: true,
        });
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
        });

        this.actor.add_child(heading);
        this.actor.add_child(this.rows);
        this.showLoading();
    }

    showLoading() {
        this.clearRows();
        this.rows.add_child(new St.Label({
            text: 'Reading local model activity…',
            style_class: 'chatgpt-activity-empty',
        }));
    }

    showError() {
        this.clearRows();
        this.rows.add_child(new St.Label({
            text: 'Local model activity unavailable',
            style_class: 'chatgpt-activity-empty',
        }));
    }

    update(snapshot) {
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
            });

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

    clearRows() {
        for (const child of this.rows.get_children())
            child.destroy();
    }
}

function errorText(error) {
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

function displayPlan(plan) {
    if (plan === null || plan.length === 0)
        return '';
    return `${plan.charAt(0).toUpperCase() + plan.slice(1)} plan`;
}

export class UsageIndicator {
    button;
    serviceIcon;
    panelLabel;
    fiveHourRow;
    weeklyRow;
    planLabel;
    errorLabel;
    footerLabel;
    onOpen;
    onRefresh;
    onLoadActivity;
    activitySection;
    state = null;
    popupTickId = 0;
    openStateSignalId = 0;
    activityRequestId = 0;
    destroyed = false;

    constructor(iconPath, onOpen, onRefresh, onLoadActivity) {
        this.onOpen = onOpen;
        this.onRefresh = onRefresh;
        this.onLoadActivity = onLoadActivity;
        this.serviceIcon = new Gio.FileIcon({
            file: Gio.File.new_for_path(iconPath),
        });

        this.button = new PanelMenu.Button(0.0, 'ChatGPT Usage');

        const panelBox = new St.BoxLayout({
            ...HORIZONTAL_PROPS,
            style_class: 'chatgpt-panel',
            y_align: Clutter.ActorAlign.CENTER,
        });
        panelBox.add_child(new St.Icon({
            gicon: this.serviceIcon,
            style_class: 'system-status-icon chatgpt-panel-icon',
            icon_size: 16,
        }));
        this.panelLabel = new St.Label({
            text: '5h -- · W --',
            style_class: 'chatgpt-panel-label',
            y_align: Clutter.ActorAlign.CENTER,
        });
        panelBox.add_child(this.panelLabel);
        this.button.add_child(panelBox);

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
        });

        const header = new St.BoxLayout({
            ...HORIZONTAL_PROPS,
            style_class: 'chatgpt-header',
            x_expand: true,
        });

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
        });
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
        });
        footer.add_child(this.footerLabel);

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
            this.refreshActivity();
        });
        footer.add_child(refreshButton);

        content.add_child(header);
        content.add_child(this.fiveHourRow.actor);
        content.add_child(this.weeklyRow.actor);
        content.add_child(new St.Widget({
            style_class: 'chatgpt-section-divider',
            height: 1,
            x_expand: true,
        }));
        content.add_child(this.activitySection.actor);
        content.add_child(this.errorLabel);
        content.add_child(footer);
        contentItem.add_child(content);

        this.button.menu.addMenuItem(contentItem);

        this.openStateSignalId = this.button.menu.connect(
            'open-state-changed',
            (_menu, open) => {
                if (open) {
                    this.onOpen();
                    this.refreshActivity();
                    this.startPopupTick();
                    this.render();
                } else {
                    this.stopPopupTick();
                }
            },
        );
    }

    update(state) {
        this.state = state;
        this.render();
    }

    render() {
        if (this.state === null)
            return;

        const nowMs = Date.now();
        const snapshot = this.state.usage;

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

    refreshActivity() {
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

    startPopupTick() {
        this.stopPopupTick();
        this.popupTickId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 60, () => {
            this.render();
            return GLib.SOURCE_CONTINUE;
        });
    }

    stopPopupTick() {
        if (this.popupTickId === 0)
            return;
        GLib.source_remove(this.popupTickId);
        this.popupTickId = 0;
    }

    destroy() {
        this.destroyed = true;
        this.activityRequestId += 1;
        this.stopPopupTick();
        if (this.openStateSignalId !== 0) {
            this.button.menu.disconnect(this.openStateSignalId);
            this.openStateSignalId = 0;
        }
        this.button.destroy();
    }
}
