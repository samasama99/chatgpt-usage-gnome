// SPDX-License-Identifier: GPL-2.0-or-later
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';
import { ModelActivityScanner } from './activity.js';
import { createUsageSource } from './api.js';
import { hasClaudeLogin, hasCodexLogin } from './auth.js';
import { UsagePoller } from './poller.js';
import { DEFAULT_PANEL_BACKGROUND_COLOR, normalizePanelColor, normalizePanelPosition, normalizeProviderSetting, resolveProviders, } from './settings-model.js';
import { UsageIndicator } from './ui.js';
export default class AIUsageExtension extends Extension {
    indicator = null;
    pollers = [];
    providers = [];
    activityScanner = null;
    settings = null;
    settingsSignalId = 0;
    sleepSignalId = 0;
    enable() {
        this.settings = this.getSettings();
        this.activityScanner = new ModelActivityScanner();
        this.settingsSignalId = this.settings.connect('changed', (_settings, key) => this.onSettingChanged(key));
        this.subscribeToResume();
        this.build();
    }
    disable() {
        this.unsubscribeFromResume();
        if (this.settings !== null && this.settingsSignalId !== 0) {
            this.settings.disconnect(this.settingsSignalId);
            this.settingsSignalId = 0;
        }
        this.teardown();
        this.settings = null;
        this.activityScanner?.clear();
        this.activityScanner = null;
    }
    resolveProviders() {
        const setting = normalizeProviderSetting(this.settings?.get_string('providers') ?? 'auto');
        return resolveProviders(setting, {
            chatgpt: hasCodexLogin(),
            claude: hasClaudeLogin(),
        });
    }
    /** Create the indicator and one poller per shown provider. */
    build() {
        const preferences = this.readPreferences();
        this.providers = this.resolveProviders();
        this.indicator = new UsageIndicator(GLib.build_filenamev([this.path, 'usage-symbolic.svg']), this.providers, preferences, () => this.pollers.forEach(poller => poller.refreshIfStale()), () => this.pollers.forEach(poller => poller.forceRefresh()), () => {
            if (!this.settings?.get_boolean('show-local-activity'))
                return Promise.reject(new Error('Local activity is disabled.'));
            return this.activityScanner?.scan(this.providers) ??
                Promise.reject(new Error('Activity scanner unavailable.'));
        }, () => this.openPreferences());
        Main.panel.addToStatusArea(this.uuid, this.indicator.button, 0, preferences.panelPosition === 'center' ? 'center' : 'left');
        this.moveIndicator(preferences.panelPosition);
        this.pollers = this.providers.map(provider => new UsagePoller(createUsageSource(provider), state => this.indicator?.update(state)));
        this.pollers.forEach(poller => poller.start());
    }
    teardown() {
        this.pollers.forEach(poller => poller.stop());
        this.pollers = [];
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
                panelBackgroundColor: DEFAULT_PANEL_BACKGROUND_COLOR,
            };
        }
        return {
            showPanelIcon: settings.get_boolean('show-panel-icon'),
            showLocalActivity: settings.get_boolean('show-local-activity'),
            panelPosition: normalizePanelPosition(settings.get_string('panel-position')),
            panelBackgroundEnabled: settings.get_boolean('panel-background-enabled'),
            panelBackgroundColor: normalizePanelColor(settings.get_string('panel-background-color')),
        };
    }
    onSettingChanged(key) {
        if (key === 'providers') {
            this.activityScanner?.clear();
            this.teardown();
            this.build();
            return;
        }
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
        const button = indicator.button;
        const container = button.container;
        container.get_parent()?.remove_child(container);
        if (position === 'center') {
            panel._centerBox.insert_child_at_index(container, 0);
            return;
        }
        // "Left" and "Right" are visual positions around the normal workspace /
        // activities area.  On Fedora's panel the workspace indicator lives in the
        // left box, so putting "Right" in GNOME's right box was surprising.
        const index = position === 'left'
            ? 0
            : panel._leftBox.get_n_children();
        panel._leftBox.insert_child_at_index(container, index);
    }
    subscribeToResume() {
        if (this.sleepSignalId !== 0)
            return;
        this.sleepSignalId = Gio.DBus.system.signal_subscribe('org.freedesktop.login1', 'org.freedesktop.login1.Manager', 'PrepareForSleep', '/org/freedesktop/login1', null, Gio.DBusSignalFlags.NONE, (_connection, _sender, _path, _interface, _signal, parameters) => {
            const [preparingForSleep] = parameters.deepUnpack();
            if (!preparingForSleep)
                this.pollers.forEach(poller => poller.refreshAfterResume());
        });
    }
    unsubscribeFromResume() {
        if (this.sleepSignalId === 0)
            return;
        Gio.DBus.system.signal_unsubscribe(this.sleepSignalId);
        this.sleepSignalId = 0;
    }
}
