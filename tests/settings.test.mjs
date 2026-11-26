import test from 'node:test';
import assert from 'node:assert/strict';

import {
    DEFAULT_PANEL_BACKGROUND_COLOR,
    normalizePanelColor,
    normalizePanelPosition,
} from '../extension/settings-model.js';

test('panel position accepts only supported GNOME panel boxes', () => {
    assert.equal(normalizePanelPosition('left'), 'left');
    assert.equal(normalizePanelPosition('center'), 'center');
    assert.equal(normalizePanelPosition('right'), 'right');
    assert.equal(normalizePanelPosition('unknown'), 'right');
});

test('panel background colors are normalized and validated', () => {
    assert.equal(normalizePanelColor('#3584E4'), '#3584e4');
    assert.equal(normalizePanelColor('  #123456  '), '#123456');
    assert.equal(normalizePanelColor('#fff'), DEFAULT_PANEL_BACKGROUND_COLOR);
    assert.equal(normalizePanelColor('red'), DEFAULT_PANEL_BACKGROUND_COLOR);
});

test('provider setting resolves to the shown subscriptions', async () => {
    const {normalizeProviderSetting, resolveProviders} = await import('../extension/settings-model.js');
    assert.equal(normalizeProviderSetting('claude'), 'claude');
    assert.equal(normalizeProviderSetting('bogus'), 'auto');

    assert.deepEqual(resolveProviders('auto', {chatgpt: true, claude: false}), ['chatgpt']);
    assert.deepEqual(resolveProviders('auto', {chatgpt: false, claude: true}), ['claude']);
    assert.deepEqual(resolveProviders('auto', {chatgpt: true, claude: true}), ['chatgpt', 'claude']);
    assert.deepEqual(resolveProviders('auto', {chatgpt: false, claude: false}), ['chatgpt', 'claude']);
    assert.deepEqual(resolveProviders('claude', {chatgpt: true, claude: false}), ['claude']);
    assert.deepEqual(resolveProviders('both', {chatgpt: false, claude: false}), ['chatgpt', 'claude']);
});
