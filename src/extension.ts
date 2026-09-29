// SPDX-License-Identifier: GPL-2.0-or-later

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';

import {ModelActivityScanner} from './activity.js';
import {UsagePoller} from './poller.js';
import {
    normalizePanelColor,
    normalizePanelPosition,
    type IndicatorPreferences,
    type PanelPosition,
} from './settings-model.js';
import {UsageIndicator} from './ui.js';

export default class ChatGPTUsageExtension extends Extension {
    private indicator: UsageIndicator | null = null;
    private poller: UsagePoller | null = null;
    private activityScanner: ModelActivityScanner | null = null;
    private settings: Gio.Settings | null = null;
    private settingsSignalId = 0;
    private sleepSignalId = 0;

    override enable(): void {
        this.settings = this.getSettings();
        const preferences = this.readPreferences();

        this.poller = new UsagePoller(state => this.indicator?.update(state));
        this.activityScanner = new ModelActivityScanner();
        this.indicator = new UsageIndicator(
            GLib.build_filenamev([this.path, 'chatgpt-symbolic.svg']),
            preferences,
            () => this.poller?.refreshIfStale(),
            () => this.poller?.forceRefresh(),
            () => {
                if (!this.settings?.get_boolean('show-local-activity'))
                    return Promise.reject(new Error('Local activity is disabled.'));
                return this.activityScanner?.scan() ??
                    Promise.reject(new Error('Activity scanner unavailable.'));
            },
            () => this.openPreferences(),
        );

        Main.panel.addToStatusArea(
            this.uuid,
            this.indicator.button,
            0,
            preferences.panelPosition,
        );

        this.settingsSignalId = this.settings.connect(
            'changed',
            (_settings, key: string) => this.onSettingChanged(key),
        );

        this.subscribeToResume();
        this.poller.start();
    }

    override disable(): void {
        this.unsubscribeFromResume();

        if (this.settings !== null && this.settingsSignalId !== 0) {
            this.settings.disconnect(this.settingsSignalId);
            this.settingsSignalId = 0;
        }
        this.settings = null;

        this.poller?.stop();
        this.poller = null;

        this.activityScanner?.clear();
        this.activityScanner = null;

        this.indicator?.destroy();
        this.indicator = null;
    }

    private readPreferences(): IndicatorPreferences {
        const settings = this.settings;
        if (settings === null) {
            return {
                showPanelIcon: true,
                showLocalActivity: true,
                panelPosition: 'right',
                panelBackgroundEnabled: false,
                panelBackgroundColor: '#10a37f',
            };
        }

        return {
            showPanelIcon: settings.get_boolean('show-panel-icon'),
            showLocalActivity: settings.get_boolean('show-local-activity'),
            panelPosition: normalizePanelPosition(settings.get_string('panel-position')),
            panelBackgroundEnabled: settings.get_boolean('panel-background-enabled'),
            panelBackgroundColor: normalizePanelColor(
                settings.get_string('panel-background-color'),
            ),
        };
    }

    private onSettingChanged(key: string): void {
        if (key === 'show-local-activity' &&
            !this.settings?.get_boolean('show-local-activity')) {
            this.activityScanner?.clear();
        }

        const preferences = this.readPreferences();
        this.indicator?.applyPreferences(preferences);

        if (key === 'panel-position')
            this.moveIndicator(preferences.panelPosition);
    }

    private moveIndicator(position: PanelPosition): void {
        const indicator = this.indicator;
        if (indicator === null)
            return;

        const panel = Main.panel as unknown as {
            _leftBox: {insert_child_at_index(actor: unknown, index: number): void};
            _centerBox: {insert_child_at_index(actor: unknown, index: number): void};
            _rightBox: {insert_child_at_index(actor: unknown, index: number): void};
        };
        const button = indicator.button as unknown as {
            container: {
                get_parent(): {remove_child(actor: unknown): void} | null;
            };
        };

        const container = button.container;
        const parent = container.get_parent();
        parent?.remove_child(container);

        const target = position === 'left'
            ? panel._leftBox
            : position === 'center'
                ? panel._centerBox
                : panel._rightBox;

        target.insert_child_at_index(container, 0);
    }

    private subscribeToResume(): void {
        if (this.sleepSignalId !== 0)
            return;

        this.sleepSignalId = Gio.DBus.system.signal_subscribe(
            'org.freedesktop.login1',
            'org.freedesktop.login1.Manager',
            'PrepareForSleep',
            '/org/freedesktop/login1',
            null,
            Gio.DBusSignalFlags.NONE,
            (_connection, _sender, _path, _interface, _signal, parameters) => {
                const [preparingForSleep] = parameters.deepUnpack() as [boolean];
                if (!preparingForSleep)
                    this.poller?.refreshAfterResume();
            },
        );
    }

    private unsubscribeFromResume(): void {
        if (this.sleepSignalId === 0)
            return;

        Gio.DBus.system.signal_unsubscribe(this.sleepSignalId);
        this.sleepSignalId = 0;
    }
}
