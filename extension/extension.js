// SPDX-License-Identifier: GPL-2.0-or-later
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';

import {ModelActivityScanner} from './activity.js';
import {UsagePoller} from './poller.js';
import {normalizePanelColor, normalizePanelPosition} from './settings-model.js';
import {UsageIndicator} from './ui.js';

export default class ChatGPTUsageExtension extends Extension {
    indicator = null;
    poller = null;
    activityScanner = null;
    settings = null;
    settingsSignalId = 0;
    sleepSignalId = 0;

    enable() {
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
            (_settings, key) => this.onSettingChanged(key),
        );

        this.subscribeToResume();
        this.poller.start();
    }

    disable() {
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

    readPreferences() {
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

    onSettingChanged(key) {
        if (key === 'show-local-activity' &&
            !this.settings?.get_boolean('show-local-activity')) {
            this.activityScanner?.clear();
        }

        const preferences = this.readPreferences();
        this.indicator?.applyPreferences(preferences);

        if (key === 'panel-position')
            this.moveIndicator(preferences.panelPosition);
    }

    moveIndicator(position) {
        const indicator = this.indicator;
        if (indicator === null)
            return;

        const panel = Main.panel;
        const container = indicator.button.container;
        const parent = container.get_parent();
        parent?.remove_child(container);

        const target = position === 'left'
            ? panel._leftBox
            : position === 'center'
                ? panel._centerBox
                : panel._rightBox;

        target.insert_child_at_index(container, 0);
    }

    subscribeToResume() {
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
                const [preparingForSleep] = parameters.deepUnpack();
                if (!preparingForSleep)
                    this.poller?.refreshAfterResume();
            },
        );
    }

    unsubscribeFromResume() {
        if (this.sleepSignalId === 0)
            return;

        Gio.DBus.system.signal_unsubscribe(this.sleepSignalId);
        this.sleepSignalId = 0;
    }
}
