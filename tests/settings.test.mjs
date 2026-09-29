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
    assert.equal(normalizePanelColor('#10A37F'), '#10a37f');
    assert.equal(normalizePanelColor('  #123456  '), '#123456');
    assert.equal(normalizePanelColor('#fff'), DEFAULT_PANEL_BACKGROUND_COLOR);
    assert.equal(normalizePanelColor('red'), DEFAULT_PANEL_BACKGROUND_COLOR);
});
