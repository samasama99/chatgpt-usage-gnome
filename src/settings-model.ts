// SPDX-License-Identifier: GPL-2.0-or-later

export type PanelPosition = 'left' | 'center' | 'right';

export type ProviderId = 'chatgpt' | 'claude';
export type ProviderSetting = 'auto' | ProviderId | 'both';

export const ALL_PROVIDERS: readonly ProviderId[] = ['chatgpt', 'claude'];

export const PROVIDER_NAMES: Readonly<Record<ProviderId, string>> = {
    chatgpt: 'ChatGPT',
    claude: 'Claude',
};

export const PROVIDER_SHORT_NAMES: Readonly<Record<ProviderId, string>> = {
    chatgpt: 'GPT',
    claude: 'Claude',
};

export interface IndicatorPreferences {
    readonly showPanelIcon: boolean;
    readonly showLocalActivity: boolean;
    readonly panelPosition: PanelPosition;
    readonly panelBackgroundEnabled: boolean;
    readonly panelBackgroundColor: string;
}

export const DEFAULT_PANEL_BACKGROUND_COLOR = '#3584e4';

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

export function normalizeProviderSetting(value: string): ProviderSetting {
    return value === 'chatgpt' || value === 'claude' || value === 'both'
        ? value
        : 'auto';
}

/**
 * Resolve which usage providers to show. In `auto` mode every provider with a
 * local login is shown; when no login is found at all, both are shown so the
 * popup can explain how to sign in.
 */
export function resolveProviders(
    setting: ProviderSetting,
    loggedIn: Readonly<Record<ProviderId, boolean>>,
): readonly ProviderId[] {
    if (setting === 'chatgpt' || setting === 'claude')
        return [setting];
    if (setting === 'both')
        return ALL_PROVIDERS;

    const available = ALL_PROVIDERS.filter(id => loggedIn[id]);
    return available.length > 0 ? available : ALL_PROVIDERS;
}

export function workspaceRelativeInsertionIndex(
    activityIndex: number,
    rtl: boolean,
    position: PanelPosition,
): number {
    if (position === 'center')
        return 0;

    const visualAfter = position === 'right';
    const logicalAfter = rtl ? !visualAfter : visualAfter;
    return Math.max(0, activityIndex + (logicalAfter ? 1 : 0));
}
