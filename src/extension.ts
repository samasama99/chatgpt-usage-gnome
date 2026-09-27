import Gio from 'gi://Gio';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';

import {UsagePoller} from './poller.js';
import {UsageIndicator} from './ui.js';

export default class ChatGPTUsageExtension extends Extension {
    private indicator: UsageIndicator | null = null;
    private poller: UsagePoller | null = null;
    private sleepSignalId = 0;

    override enable(): void {
        this.poller = new UsagePoller(state => this.indicator?.update(state));
        this.indicator = new UsageIndicator(
            () => this.poller?.refreshIfStale(),
            () => this.poller?.forceRefresh(),
        );

        Main.panel.addToStatusArea(this.uuid, this.indicator.button, 0, 'right');
        this.subscribeToResume();
        this.poller.start();
    }

    override disable(): void {
        this.unsubscribeFromResume();
        this.poller?.stop();
        this.poller = null;
        this.indicator?.destroy();
        this.indicator = null;
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
                const unpacked = parameters.deepUnpack() as [boolean];
                const preparingForSleep = unpacked[0];
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
