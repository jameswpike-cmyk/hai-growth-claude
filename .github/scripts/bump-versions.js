const { execFileSync } = require('child_process');
const fs = require('fs');

const changed = execFileSync(
  'git', ['diff', '--name-only', process.env.BEFORE_SHA, process.env.AFTER_SHA],
  { encoding: 'utf8' }
).trim().split('\n');

const plugins = [...new Set(
  changed.filter(f => f.startsWith('plugins/')).map(f => f.split('/')[1])
)].filter(p => fs.existsSync(`plugins/${p}/.claude-plugin/plugin.json`));

if (!plugins.length) { console.log('No plugin changes'); process.exit(0); }

const mpPath = '.claude-plugin/marketplace.json';
const mp = JSON.parse(fs.readFileSync(mpPath, 'utf8'));
const bumped = [];

for (const plugin of plugins.sort()) {
  const pjPath = `plugins/${plugin}/.claude-plugin/plugin.json`;
  const pj = JSON.parse(fs.readFileSync(pjPath, 'utf8'));
  const old = pj.version;
  const parts = old.split('.');
  parts[2] = String(Number(parts[2]) + 1);
  pj.version = parts.join('.');
  fs.writeFileSync(pjPath, JSON.stringify(pj, null, 2) + '\n');

  const entry = mp.plugins.find(p => p.name === pj.name);
  if (entry) entry.version = pj.version;

  console.log(`${plugin}: ${old} -> ${pj.version}`);
  bumped.push(`${plugin}@${pj.version}`);
}

fs.writeFileSync(mpPath, JSON.stringify(mp, null, 2) + '\n');
fs.appendFileSync(process.env.GITHUB_OUTPUT, `bumped=${bumped.join(', ')}\n`);
