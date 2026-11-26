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
    formatUsd,
    type ModelActivitySnapshot,
} from './activity-model.js';
import type {FetchFailure} from './api.js';
import {formatAge, formatPanel, formatReset, progressScale, type UsageSnapshot, type UsageWindow} from './model.js';
import type {PollerState} from './poller.js';
import {
    PROVIDER_NAMES,
    PROVIDER_SHORT_NAMES,
    type IndicatorPreferences,
    type ProviderId,
} from './settings-model.js';

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
            style_class: 'usage-progress-fill',
            x_expand: true,
            x_align: Clutter.ActorAlign.FILL,
            height: 5,
        });
        this.fill.set_pivot_point(0, 0.5);

        this.actor = new St.Bin({
            style_class: 'usage-progress-track',
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
            this.fill.set_style_class_name('usage-progress-fill usage-progress-critical');
        else if (percent <= 25)
            this.fill.set_style_class_name('usage-progress-fill usage-progress-warning');
        else
            this.fill.set_style_class_name('usage-progress-fill');
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
            style_class: 'usage-usage-card',
            x_expand: true,
        } as never);

        const header = new St.BoxLayout({
            ...HORIZONTAL_PROPS,
            style_class: 'usage-usage-header',
            x_expand: true,
        } as never);

        const title = new St.Label({
            text: name,
            style_class: 'usage-usage-title',
            x_expand: true,
            x_align: Clutter.ActorAlign.START,
            y_align: Clutter.ActorAlign.CENTER,
        });
        this.value = new St.Label({
            text: '--',
            style_class: 'usage-usage-value',
            x_align: Clutter.ActorAlign.END,
            y_align: Clutter.ActorAlign.CENTER,
        });

        header.add_child(title);
        header.add_child(this.value);

        this.progress = new ProgressBar();
        this.reset = new St.Label({
            text: '',
            style_class: 'usage-reset',
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
    private readonly costLabel: St.Label;

    constructor() {
        this.actor = new St.BoxLayout({
            ...VERTICAL_PROPS,
            style_class: 'usage-activity',
            x_expand: true,
        } as never);

        const heading = new St.BoxLayout({
            ...HORIZONTAL_PROPS,
            style_class: 'usage-activity-heading',
            x_expand: true,
        } as never);
        heading.add_child(new St.Label({
            text: 'Local model activity',
            style_class: 'usage-activity-title',
            x_expand: true,
        }));
        this.subtitle = new St.Label({
            text: 'Local · last 7 days',
            style_class: 'usage-activity-subtitle',
            x_align: Clutter.ActorAlign.END,
        });
        heading.add_child(this.subtitle);

        this.rows = new St.BoxLayout({
            ...VERTICAL_PROPS,
            style_class: 'usage-activity-rows',
            x_expand: true,
        } as never);

        this.costLabel = new St.Label({
            text: '',
            style_class: 'usage-activity-subtitle',
        });

        this.actor.add_child(heading);
        this.actor.add_child(this.costLabel);
        this.actor.add_child(this.rows);
        this.showLoading();
    }

    showLoading(): void {
        this.clearRows();
        this.costLabel.visible = false;
        this.rows.add_child(new St.Label({
            text: 'Reading local model activity…',
            style_class: 'usage-activity-empty',
        }));
    }

    showError(): void {
        this.clearRows();
        this.costLabel.visible = false;
        this.rows.add_child(new St.Label({
            text: 'Local model activity unavailable',
            style_class: 'usage-activity-empty',
        }));
    }

    update(snapshot: ModelActivitySnapshot): void {
        this.clearRows();
        const sources = snapshot.sources.length > 0 ? snapshot.sources.join(' + ') : 'Local';
        this.subtitle.text = `${sources} · ${snapshot.windowDays} days · ${formatTokenCount(snapshot.totalTokens)} tokens`;

        if (snapshot.pricedTokens > 0) {
            const coverage = snapshot.totalTokens > 0
                ? Math.round(snapshot.pricedTokens / snapshot.totalTokens * 100)
                : 0;
            this.costLabel.text = coverage >= 100
                ? `API equivalent · ${formatUsd(snapshot.apiEquivalentUsd)}`
                : `API equivalent · ${formatUsd(snapshot.apiEquivalentUsd)} · ${coverage}% priced`;
            this.costLabel.visible = true;
        } else {
            this.costLabel.text = '';
            this.costLabel.visible = false;
        }

        const rows = compactModelActivity(snapshot, 4);
        if (rows.length === 0) {
            this.rows.add_child(new St.Label({
                text: 'No recent local model activity found',
                style_class: 'usage-activity-empty',
            }));
            return;
        }

        for (const row of rows) {
            const actor = new St.BoxLayout({
                ...HORIZONTAL_PROPS,
                style_class: 'usage-activity-row',
                x_expand: true,
            } as never);

            actor.add_child(new St.Label({
                text: displayModelName(row.model),
                style_class: 'usage-activity-model',
                x_expand: true,
                x_align: Clutter.ActorAlign.START,
            }));

            actor.add_child(new St.Label({
                text: `${Math.round(row.sharePercent)}% · ${formatTokenCount(row.tokens)}`,
                style_class: 'usage-activity-value',
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

function billingText(snapshot: UsageSnapshot | null): string {
    const activeUntil = snapshot?.planActiveUntilMs ?? null;
    if (activeUntil === null)
        return '';

    const formatted = new Date(activeUntil).toLocaleDateString(undefined, {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
    });
    if (snapshot?.willRenew === true)
        return `Next billing · ${formatted}`;
    if (snapshot?.willRenew === false)
        return `Plan active until · ${formatted}`;
    return `Subscription date · ${formatted}`;
}

/** Usage cards and metadata for one provider (ChatGPT or Claude). */
class ProviderSection {
    readonly actor: St.BoxLayout;
    private readonly planLabel: St.Label;
    private readonly metaLabel: St.Label;
    private readonly fiveHourRow: UsageRow;
    private readonly weeklyRow: UsageRow;
    private readonly errorLabel: St.Label;

    constructor(provider: ProviderId) {
        this.actor = new St.BoxLayout({
            ...VERTICAL_PROPS,
            style_class: 'usage-provider',
            x_expand: true,
        } as never);

        const heading = new St.BoxLayout({
            ...HORIZONTAL_PROPS,
            style_class: 'usage-provider-heading',
            x_expand: true,
        } as never);
        heading.add_child(new St.Label({
            text: PROVIDER_NAMES[provider],
            style_class: 'usage-provider-title',
            x_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
        }));
        this.planLabel = new St.Label({
            text: '',
            style_class: 'usage-plan',
            x_align: Clutter.ActorAlign.END,
            y_align: Clutter.ActorAlign.CENTER,
        });
        heading.add_child(this.planLabel);

        this.metaLabel = new St.Label({
            text: '',
            style_class: 'usage-plan',
        });

        this.fiveHourRow = new UsageRow('5-hour');
        this.weeklyRow = new UsageRow('Weekly');

        this.errorLabel = new St.Label({
            text: '',
            style_class: 'usage-error',
        });
        this.errorLabel.clutter_text.line_wrap = true;

        this.actor.add_child(heading);
        this.actor.add_child(this.metaLabel);
        this.actor.add_child(this.fiveHourRow.actor);
        this.actor.add_child(this.weeklyRow.actor);
        this.actor.add_child(this.errorLabel);
    }

    update(state: PollerState | null, nowMs: number): void {
        const snapshot = state?.usage ?? null;

        this.planLabel.text = displayPlan(snapshot?.plan ?? null);
        this.planLabel.visible = this.planLabel.text.length > 0;

        const resetCredits = snapshot?.resetCreditsAvailable ?? null;
        const meta = [
            resetCredits === null ? '' : `Reset credits · ${resetCredits}`,
            billingText(snapshot),
        ].filter(text => text.length > 0);
        this.metaLabel.text = meta.join('  ·  ');
        this.metaLabel.visible = meta.length > 0;

        this.fiveHourRow.update(snapshot?.fiveHour ?? null, nowMs);
        this.weeklyRow.update(snapshot?.weekly ?? null, nowMs);

        const message = errorText(state?.error ?? null);
        this.errorLabel.text = message;
        this.errorLabel.visible = message.length > 0;
    }
}

export class UsageIndicator {
    readonly button: PanelMenu.Button;

    private readonly providers: readonly ProviderId[];
    private readonly panelBox: St.BoxLayout;
    private readonly panelIcon: St.Icon;
    private readonly panelLabel: St.Label;
    private readonly sections: ReadonlyMap<ProviderId, ProviderSection>;
    private readonly footerLabel: St.Label;
    private readonly onOpen: OpenListener;
    private readonly onRefresh: RefreshListener;
    private readonly onLoadActivity: ActivityLoader;
    private readonly onOpenPreferences: PreferencesListener;
    private readonly activitySection: ModelActivitySection;
    private readonly activityDivider: St.Widget;

    private readonly states = new Map<ProviderId, PollerState>();
    private popupTickId = 0;
    private openStateSignalId = 0;
    private activityRequestId = 0;
    private destroyed = false;
    private preferences: IndicatorPreferences;

    constructor(
        iconPath: string,
        providers: readonly ProviderId[],
        preferences: IndicatorPreferences,
        onOpen: OpenListener,
        onRefresh: RefreshListener,
        onLoadActivity: ActivityLoader,
        onOpenPreferences: PreferencesListener,
    ) {
        this.providers = providers;
        this.onOpen = onOpen;
        this.onRefresh = onRefresh;
        this.onLoadActivity = onLoadActivity;
        this.onOpenPreferences = onOpenPreferences;
        this.preferences = preferences;
        const usageIcon = new Gio.FileIcon({
            file: Gio.File.new_for_path(iconPath),
        });

        this.button = new PanelMenu.Button(0.0, 'AI Usage');

        this.panelBox = new St.BoxLayout({
            ...HORIZONTAL_PROPS,
            style_class: 'usage-panel',
            y_align: Clutter.ActorAlign.CENTER,
        } as never);
        this.panelIcon = new St.Icon({
            gicon: usageIcon,
            style_class: 'system-status-icon usage-panel-icon',
            icon_size: 16,
        });
        this.panelBox.add_child(this.panelIcon);
        this.panelLabel = new St.Label({
            text: this.panelText(),
            style_class: 'usage-panel-label',
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
            style_class: 'usage-popup',
            x_expand: true,
            width: 350,
        } as never);

        const header = new St.BoxLayout({
            ...HORIZONTAL_PROPS,
            style_class: 'usage-header',
            x_expand: true,
        } as never);

        const iconShell = new St.Bin({
            style_class: 'usage-header-icon-shell',
            y_align: Clutter.ActorAlign.CENTER,
        });
        iconShell.set_child(new St.Icon({
            gicon: usageIcon,
            style_class: 'usage-header-icon',
            icon_size: 22,
        }));
        header.add_child(iconShell);
        header.add_child(new St.Label({
            text: 'AI Usage',
            style_class: 'usage-title',
            x_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
        }));

        content.add_child(header);

        const sections = new Map<ProviderId, ProviderSection>();
        providers.forEach((provider, index) => {
            if (index > 0) {
                content.add_child(new St.Widget({
                    style_class: 'usage-section-divider',
                    height: 1,
                    x_expand: true,
                }));
            }
            const section = new ProviderSection(provider);
            sections.set(provider, section);
            content.add_child(section.actor);
        });
        this.sections = sections;

        this.activitySection = new ModelActivitySection();

        this.footerLabel = new St.Label({
            text: 'Not updated yet',
            style_class: 'usage-footer',
            x_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
        });

        const footer = new St.BoxLayout({
            ...HORIZONTAL_PROPS,
            style_class: 'usage-footer-row',
            x_expand: true,
        } as never);
        footer.add_child(this.footerLabel);

        const settingsButton = new St.Button({
            label: 'Settings',
            style_class: 'usage-button',
            can_focus: true,
            reactive: true,
            track_hover: true,
            y_align: Clutter.ActorAlign.CENTER,
        });
        settingsButton.connect('clicked', () => this.onOpenPreferences());
        footer.add_child(settingsButton);

        const refreshButton = new St.Button({
            label: 'Refresh',
            style_class: 'usage-button',
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

        this.activityDivider = new St.Widget({
            style_class: 'usage-section-divider',
            height: 1,
            x_expand: true,
        });
        content.add_child(this.activityDivider);
        content.add_child(this.activitySection.actor);
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
        this.render();
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
        this.states.set(state.provider, state);
        this.render();
    }

    private panelText(): string {
        const multiple = this.providers.length > 1;
        return this.providers
            .map(provider => formatPanel(
                this.states.get(provider)?.usage ?? null,
                multiple ? PROVIDER_SHORT_NAMES[provider] : null,
            ))
            .join('   ');
    }

    private footerText(nowMs: number): string {
        const states = this.providers.map(provider => this.states.get(provider) ?? null);
        if (states.some(state => state?.updating === true))
            return 'Updating…';

        // Show the age of the stalest provider so nothing looks fresher than it is.
        const successes = states.map(state => state?.lastSuccessMs ?? null);
        const oldest = successes.includes(null)
            ? successes.find(value => value !== null) ?? null
            : Math.min(...(successes as number[]));
        return formatAge(oldest, nowMs);
    }

    private render(): void {
        const nowMs = Date.now();

        this.panelLabel.text = this.panelText();
        for (const [provider, section] of this.sections)
            section.update(this.states.get(provider) ?? null, nowMs);
        this.footerLabel.text = this.footerText(nowMs);
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
