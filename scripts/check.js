const fs = require('fs');
const path = require('path');
const cp = require('child_process');
const roots = ['src'];
const files = [];
function walk(dir) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) walk(full);
    else if (ent.isFile() && full.endsWith('.js')) files.push(full);
  }
}
for (const r of roots) walk(path.resolve(__dirname, '..', r));
walk(path.resolve(__dirname, '..', 'scripts'));
let fail = 0;
for (const file of files) {
  const res = cp.spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
  if (res.status !== 0) {
    fail++;
    console.error(`ERRO: ${path.relative(path.resolve(__dirname, '..'), file)}\n${res.stderr || res.stdout}`);
  }
}
if (fail) process.exit(1);
console.log(`Sintaxe JavaScript OK em ${files.length} arquivos.`);
