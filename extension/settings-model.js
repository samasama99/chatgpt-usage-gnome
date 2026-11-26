// SPDX-License-Identifier: GPL-2.0-or-later
export const ALL_PROVIDERS = ['chatgpt', 'claude'];
export const PROVIDER_NAMES = {
    chatgpt: 'ChatGPT',
    claude: 'Claude',
};
export const PROVIDER_SHORT_NAMES = {
    chatgpt: 'GPT',
    claude: 'Claude',
};
export const DEFAULT_PANEL_BACKGROUND_COLOR = '#3584e4';
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
export function normalizeProviderSetting(value) {
    return value === 'chatgpt' || value === 'claude' || value === 'both'
        ? value
        : 'auto';
}
/**
 * Resolve which usage providers to show. In `auto` mode every provider with a
 * local login is shown; when no login is found at all, both are shown so the
 * popup can explain how to sign in.
 */
export function resolveProviders(setting, loggedIn) {
    if (setting === 'chatgpt' || setting === 'claude')
        return [setting];
    if (setting === 'both')
        return ALL_PROVIDERS;
    const available = ALL_PROVIDERS.filter(id => loggedIn[id]);
    return available.length > 0 ? available : ALL_PROVIDERS;
}
export function workspaceRelativeInsertionIndex(activityIndex, rtl, position) {
    if (position === 'center')
        return 0;
    const visualAfter = position === 'right';
    const logicalAfter = rtl ? !visualAfter : visualAfter;
    return Math.max(0, activityIndex + (logicalAfter ? 1 : 0));
}
