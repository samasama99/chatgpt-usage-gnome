// SPDX-License-Identifier: GPL-2.0-or-later
export const DEFAULT_PANEL_BACKGROUND_COLOR = '#10a37f';

export function normalizePanelPosition(value) {
    return value === 'left' || value === 'center' || value === 'right'
        ? value
        : 'right';
}

export function normalizePanelColor(value) {
    const trimmed = value.trim();
    return /^#[0-9a-fA-F]{6}$/.test(trimmed)
        ? trimmed.toLowerCase()
        : DEFAULT_PANEL_BACKGROUND_COLOR;
}
