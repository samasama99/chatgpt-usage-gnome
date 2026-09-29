import {execFileSync} from 'node:child_process';
import {cp, mkdir, rm} from 'node:fs/promises';

await rm('extension', {recursive: true, force: true});
await mkdir('extension', {recursive: true});
await cp('dist', 'extension', {recursive: true});
await cp('metadata.json', 'extension/metadata.json');
await cp('stylesheet.css', 'extension/stylesheet.css');
await cp('chatgpt-symbolic.svg', 'extension/chatgpt-symbolic.svg');
await cp('prefs.js', 'extension/prefs.js');
await cp('schemas', 'extension/schemas', {recursive: true});
await cp('LICENSE', 'extension/LICENSE');

execFileSync('glib-compile-schemas', ['extension/schemas'], {stdio: 'inherit'});
