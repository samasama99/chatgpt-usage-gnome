// SPDX-License-Identifier: GPL-2.0-or-later

export type PanelPosition = 'left' | 'center' | 'right';

export interface IndicatorPreferences {
    readonly showPanelIcon: boolean;
    readonly showLocalActivity: boolean;
    readonly panelPosition: PanelPosition;
    readonly panelBackgroundEnabled: boolean;
    readonly panelBackgroundColor: string;
}

export const DEFAULT_PANEL_BACKGROUND_COLOR = '#10a37f';

export function normalizePanelPosition(value: string): PanelPosition {
    return value === 'left' || value === 'center' || value === 'right'
        ? value
        : 'right';
}

export function normalizePanelColor(value: string): string {
    const trimmed = value.trim();
    return /^#[0-9a-fA-F]{6}$/.test(trimmed)
        ? trimmed.toLowerCase()
        : DEFAULT_PANEL_BACKGROUND_COLOR;
}
