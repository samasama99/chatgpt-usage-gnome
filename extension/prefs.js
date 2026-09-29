// SPDX-License-Identifier: GPL-2.0-or-later

import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import Gtk from 'gi://Gtk';

import {ExtensionPreferences} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

const POSITIONS = ['left', 'center', 'right'];
const POSITION_LABELS = ['Left', 'Center', 'Right'];

export default class ChatGPTUsagePreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();
        window._settings = settings;
        window.set_default_size(520, 500);
        window.search_enabled = true;

        const page = new Adw.PreferencesPage({
            title: 'General',
            icon_name: 'preferences-system-symbolic',
        });
        window.add(page);

        const panelGroup = new Adw.PreferencesGroup({
            title: 'Panel',
            description: 'Choose how ChatGPT Usage appears in the GNOME top bar.',
        });
        page.add(panelGroup);

        const showIcon = new Adw.SwitchRow({
            title: 'Show ChatGPT icon',
            subtitle: 'Hide the icon and keep only the 5-hour and weekly percentages.',
        });
        settings.bind('show-panel-icon', showIcon, 'active', Gio.SettingsBindFlags.DEFAULT);
        panelGroup.add(showIcon);

        const positionModel = Gtk.StringList.new(POSITION_LABELS);
        const position = new Adw.ComboRow({
            title: 'Panel position',
            subtitle: 'Move the indicator between the left, center, and right panel boxes.',
            model: positionModel,
        });
        const currentPosition = settings.get_string('panel-position');
        position.selected = Math.max(0, POSITIONS.indexOf(currentPosition));
        position.connect('notify::selected', () => {
            settings.set_string('panel-position', POSITIONS[position.selected] ?? 'right');
        });
        settings.connect('changed::panel-position', () => {
            const next = POSITIONS.indexOf(settings.get_string('panel-position'));
            if (next >= 0 && position.selected !== next)
                position.selected = next;
        });
        panelGroup.add(position);

        const backgroundEnabled = new Adw.SwitchRow({
            title: 'Panel background',
            subtitle: 'Add a rounded background behind this extension in the top bar.',
        });
        settings.bind(
            'panel-background-enabled',
            backgroundEnabled,
            'active',
            Gio.SettingsBindFlags.DEFAULT,
        );
        panelGroup.add(backgroundEnabled);

        const backgroundColor = new Adw.EntryRow({
            title: 'Background color (#RRGGBB)',
            text: settings.get_string('panel-background-color'),
        });
        backgroundColor.connect('changed', () => {
            const value = backgroundColor.text.trim();
            if (/^#[0-9a-fA-F]{6}$/.test(value))
                settings.set_string('panel-background-color', value.toLowerCase());
        });
        settings.connect('changed::panel-background-color', () => {
            const value = settings.get_string('panel-background-color');
            if (backgroundColor.text !== value)
                backgroundColor.text = value;
        });
        settings.bind(
            'panel-background-enabled',
            backgroundColor,
            'sensitive',
            Gio.SettingsBindFlags.DEFAULT,
        );
        panelGroup.add(backgroundColor);

        const activityGroup = new Adw.PreferencesGroup({
            title: 'Local activity',
            description: 'Control optional local Codex and OpenCode statistics.',
        });
        page.add(activityGroup);

        const localActivity = new Adw.SwitchRow({
            title: 'Show local coding activity',
            subtitle: 'When disabled, no Codex session scan or OpenCode stats command is run.',
        });
        settings.bind(
            'show-local-activity',
            localActivity,
            'active',
            Gio.SettingsBindFlags.DEFAULT,
        );
        activityGroup.add(localActivity);

        const resetGroup = new Adw.PreferencesGroup({
            title: 'Defaults',
        });
        page.add(resetGroup);

        const resetRow = new Adw.ActionRow({
            title: 'Reset appearance settings',
            subtitle: 'Restore the icon, right-side position, transparent background, and local activity.',
        });
        const resetButton = new Gtk.Button({
            label: 'Reset',
            valign: Gtk.Align.CENTER,
        });
        resetButton.add_css_class('destructive-action');
        resetButton.connect('clicked', () => {
            for (const key of [
                'show-panel-icon',
                'show-local-activity',
                'panel-position',
                'panel-background-enabled',
                'panel-background-color',
            ])
                settings.reset(key);
        });
        resetRow.add_suffix(resetButton);
        resetGroup.add(resetRow);
    }
}
