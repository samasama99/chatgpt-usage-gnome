// SPDX-License-Identifier: GPL-2.0-or-later
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import {ModelActivityScanner} from './activity.js';
import {UsagePoller} from './poller.js';
import {UsageIndicator} from './ui.js';

export default class ChatGPTUsageExtension extends Extension {
    indicator = null;
    poller = null;
    activityScanner = null;
    sleepSignalId = 0;

    enable() {
        this.poller = new UsagePoller(state => this.indicator?.update(state));
        this.activityScanner = new ModelActivityScanner();
        this.indicator = new UsageIndicator(
            GLib.build_filenamev([this.path, 'chatgpt-symbolic.svg']),
            () => this.poller?.refreshIfStale(),
            () => this.poller?.forceRefresh(),
            () => this.activityScanner?.scan() ?? Promise.reject(new Error('Activity scanner unavailable.')),
        );

        Main.panel.addToStatusArea(this.uuid, this.indicator.button, 0, 'right');
        this.subscribeToResume();
        this.poller.start();
    }

    disable() {
        this.unsubscribeFromResume();
        this.poller?.stop();
        this.poller = null;
        this.activityScanner?.clear();
        this.activityScanner = null;
        this.indicator?.destroy();
        this.indicator = null;
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
