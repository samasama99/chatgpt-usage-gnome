import {cp, mkdir, rm} from 'node:fs/promises';

await rm('extension', {recursive: true, force: true});
await mkdir('extension', {recursive: true});
await cp('dist', 'extension', {recursive: true});
await cp('metadata.json', 'extension/metadata.json');
await cp('stylesheet.css', 'extension/stylesheet.css');
await cp('LICENSE', 'extension/LICENSE');
