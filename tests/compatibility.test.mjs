import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

test('GNOME support declarations stay in sync', () => {
    const sourceMetadata = JSON.parse(fs.readFileSync('metadata.json', 'utf8'));
    const runtimeMetadata = JSON.parse(fs.readFileSync('extension/metadata.json', 'utf8'));
    const installer = fs.readFileSync('install.sh', 'utf8');
    const readme = fs.readFileSync('README.md', 'utf8');

    const expected = ['46', '47', '48', '49', '50', '51'];

    assert.deepEqual(sourceMetadata['shell-version'], expected);
    assert.deepEqual(runtimeMetadata['shell-version'], expected);
    assert.match(installer, /SUPPORTED_MIN=46\b/);
    assert.match(installer, /SUPPORTED_MAX=51\b/);
    assert.match(readme, /Supports GNOME Shell 46–51\./);
});
