import {readdir, readFile} from 'node:fs/promises';
import path from 'node:path';

const root = 'extension';
const expected = new Set([
    'LICENSE',
    'api.js',
    'auth.js',
    'extension.js',
    'http.js',
    'metadata.json',
    'model.js',
    'poller.js',
    'schedule.js',
    'stylesheet.css',
    'ui.js',
]);

const files = (await readdir(root, {withFileTypes: true}))
    .filter(entry => entry.isFile())
    .map(entry => entry.name)
    .sort();

const unexpected = files.filter(file => !expected.has(file));
const missing = [...expected].filter(file => !files.includes(file));

if (unexpected.length || missing.length) {
    if (unexpected.length)
        console.error(`Unexpected store files: ${unexpected.join(', ')}`);
    if (missing.length)
        console.error(`Missing store files: ${missing.join(', ')}`);
    process.exit(1);
}

const metadata = JSON.parse(await readFile(path.join(root, 'metadata.json'), 'utf8'));
if ('version' in metadata)
    throw new Error('metadata.version must be omitted for extensions.gnome.org.');
if (metadata.uuid !== 'quota-monitor@samasama99.github.io')
    throw new Error('Unexpected extension UUID.');

console.log(`Store package check passed (${files.length} runtime files).`);
