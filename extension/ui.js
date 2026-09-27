import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import St from 'gi://St';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import { formatAge, formatPanel, formatReset } from './model.js';
const VERTICAL_PROPS = 'orientation' in St.BoxLayout.prototype ? { orientation: Clutter.Orientation.VERTICAL } : { vertical: true };
class UsageRow {
    actor;
    title;
    value;
    reset;
    constructor(name) {
        this.actor = new St.BoxLayout({...VERTICAL_PROPS, style_class: 'chatgpt-usage-row', x_expand: true});
        this.title = new St.Label({ text: name, style_class: 'chatgpt-usage-row-title' });
        this.value = new St.Label({ text: '--', style_class: 'chatgpt-usage-row-value' });
        this.reset = new St.Label({ text: '', style_class: 'chatgpt-usage-row-reset' });
        this.actor.add_child(this.title);
        this.actor.add_child(this.value);
        this.actor.add_child(this.reset);
    }
    update(window, nowMs) {
        if (window === null) {
            this.value.text = 'Not provided for this plan';
            this.reset.text = '';
            return;
        }
        this.value.text = `${Math.round(window.remainingPercent)}% remaining`;
        this.reset.text = formatReset(window.resetAtMs, nowMs);
    }
}
function errorText(error) {
    if (error === null)
        return '';
    switch (error.kind) {
        case 'auth': return error.message;
        case 'rate-limit': return 'Rate limited; keeping the last known values.';
        case 'network': return 'Offline; keeping the last known values.';
        case 'server': return 'Usage service unavailable; keeping the last known values.';
        case 'invalid-response': return 'Usage response format changed; keeping the last known values.';
    }
}
export class UsageIndicator {
    button;
    panelLabel;
    fiveHourRow;
    weeklyRow;
    planLabel;
    errorLabel;
    footerLabel;
    onOpen;
    onRefresh;
    state = null;
    popupTickId = 0;
    openStateSignalId = 0;
    constructor(onOpen, onRefresh) {
        this.onOpen = onOpen;
        this.onRefresh = onRefresh;
        this.button = new PanelMenu.Button(0.0, 'ChatGPT Usage');
        this.panelLabel = new St.Label({text: '5h -- · W --', y_align: Clutter.ActorAlign.CENTER});
        this.button.add_child(this.panelLabel);
        const contentItem = new PopupMenu.PopupBaseMenuItem({reactive: true, activate: false, hover: false, can_focus: false});
        contentItem.remove_style_class_name('popup-inactive-menu-item');
        const content = new St.BoxLayout({...VERTICAL_PROPS, style_class: 'chatgpt-usage-popup', x_expand: true});
        const title = new St.Label({ text: 'ChatGPT Usage', style_class: 'chatgpt-usage-title' });
        this.planLabel = new St.Label({ text: '', style_class: 'chatgpt-usage-plan' });
        this.fiveHourRow = new UsageRow('5-hour');
        this.weeklyRow = new UsageRow('Weekly');
        this.errorLabel = new St.Label({ text: '', style_class: 'chatgpt-usage-error' });
        this.errorLabel.clutter_text.line_wrap = true;
        this.footerLabel = new St.Label({ text: 'not updated yet', style_class: 'chatgpt-usage-footer' });
        content.add_child(title);
        content.add_child(this.planLabel);
        content.add_child(this.fiveHourRow.actor);
        content.add_child(this.weeklyRow.actor);
        content.add_child(this.errorLabel);
        content.add_child(this.footerLabel);
        contentItem.add_child(content);
        this.button.menu.addMenuItem(contentItem);
        this.button.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        const refreshItem = new PopupMenu.PopupMenuItem('Refresh now');
        refreshItem.connect('activate', () => this.onRefresh());
        this.button.menu.addMenuItem(refreshItem);
        this.openStateSignalId = this.button.menu.connect('open-state-changed', (_menu, open) => {
            if (open) {
                this.onOpen();
                this.startPopupTick();
                this.render();
            } else {
                this.stopPopupTick();
            }
        });
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
        this.planLabel.text = snapshot?.plan ? `Plan: ${snapshot.plan}` : '';
        this.fiveHourRow.update(snapshot?.fiveHour ?? null, nowMs);
        this.weeklyRow.update(snapshot?.weekly ?? null, nowMs);
        const message = errorText(this.state.error);
        this.errorLabel.text = message;
        this.errorLabel.visible = message.length > 0;
        const age = formatAge(this.state.lastSuccessMs, nowMs);
        this.footerLabel.text = this.state.updating ? `Updating… · ${age}` : age;
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
        this.stopPopupTick();
        if (this.openStateSignalId !== 0) {
            this.button.menu.disconnect(this.openStateSignalId);
            this.openStateSignalId = 0;
        }
        this.button.destroy();
    }
}
