import {execFileSync} from 'node:child_process';
import {readFileSync} from 'node:fs';

const tracked = execFileSync('git', ['ls-files', '-z'], {encoding: 'utf8'})
    .split('\0')
    .filter(Boolean);

const forbiddenPaths = [
    /(^|\/)auth\.json$/i,
    /(^|\/)\.env(?:\..+)?$/i,
    /\.(?:pem|key|p12|pfx)$/i,
];

const secretPatterns = [
    ['private key', /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/],
    ['GitHub token', /\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/],
    ['OpenAI-style secret', /\bsk-[A-Za-z0-9_-]{20,}\b/],
    ['AWS access key', /\bAKIA[0-9A-Z]{16}\b/],
    ['Slack token', /\bxox[baprs]-[A-Za-z0-9-]{20,}\b/],
];

const problems = [];

for (const path of tracked) {
    if (forbiddenPaths.some(pattern => pattern.test(path)) && path !== '.env.example')
        problems.push(`credential-like path is tracked: ${path}`);

    let content;
    try {
        content = readFileSync(path, 'utf8');
    } catch {
        continue;
    }

    for (const [name, pattern] of secretPatterns) {
        if (pattern.test(content))
            problems.push(`${name} pattern found in: ${path}`);
    }
}

if (problems.length > 0) {
    console.error('Security check failed:');
    for (const problem of problems)
        console.error(`- ${problem}`);
    process.exit(1);
}

console.log(`Security check passed for ${tracked.length} tracked files.`);
