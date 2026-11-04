'use strict';

const fs = require('fs');
const path = require('path');
const cp = require('child_process');

const root = path.resolve(__dirname, '..');
const roots = ['src', 'scripts'];
const files = [];

function walk(dir) {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory() && entry.name !== 'node_modules') walk(full);
    else if (entry.isFile() && full.endsWith('.js')) files.push(full);
  }
}

function resolveLocal(fromFile, request) {
  const base = path.resolve(path.dirname(fromFile), request);
  const candidates = [
    base,
    base + '.js',
    base + '.json',
    path.join(base, 'index.js'),
    path.join(base, 'index.json'),
  ];
  return candidates.find((candidate) => {
    try { return fs.statSync(candidate).isFile(); } catch { return false; }
  }) || null;
}

for (const relativeRoot of roots) walk(path.join(root, relativeRoot));

let syntaxFailures = 0;
let importFailures = 0;
let architectureFailures = 0;

for (const file of files) {
  const relative = path.relative(root, file);
  const syntax = cp.spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
  if (syntax.status !== 0) {
    syntaxFailures += 1;
    console.error('ERRO DE SINTAXE: ' + relative + '\n' + (syntax.stderr || syntax.stdout));
  }

  const source = fs.readFileSync(file, 'utf8');
  const requires = /require\s*\(\s*['"](\.{1,2}\/[^'"]+)['"]\s*\)/g;
  let match;
  while ((match = requires.exec(source))) {
    if (!resolveLocal(file, match[1])) {
      importFailures += 1;
      console.error('IMPORT LOCAL AUSENTE: ' + relative + ' -> ' + match[1]);
    }
  }
}

// Acesso SQLite só é permitido no importador de primeira execução.
for (const file of files) {
  const relative = path.relative(root, file);
  const source = fs.readFileSync(file, 'utf8');
  const sqliteImporter = relative === 'src/official/database/migrate-sqlite.js';
  if (!sqliteImporter && relative !== 'scripts/check.js' && /better-sqlite3|\bdb\.(?:prepare|transaction|pragma|backup)\s*\(/.test(source)) {
    architectureFailures += 1;
    console.error('ACESSO DIRETO AO SQLITE FORA DO IMPORTADOR: ' + relative);
  }
  if (relative !== 'src/official/database/settings.js') {
    for (const match of source.matchAll(/settings\.set\s*\(/g)) {
      const before = source.slice(Math.max(0, match.index - 24), match.index);
      if (!/\bawait\s*$/.test(before)) {
        architectureFailures += 1;
        console.error('WRITE DE CONFIGURAÇÃO SEM AWAIT: ' + relative);
        break;
      }
    }
  }
}

const bootstrap = fs.readFileSync(path.join(root, 'src', 'index.js'), 'utf8');
if (!bootstrap.includes('runSqliteMigration()')) {
  architectureFailures += 1;
  console.error('O bootstrap não executa a migração SQLite antes de iniciar os serviços.');
}

if (syntaxFailures || importFailures || architectureFailures) {
  console.error('\nVerificação falhou: ' + syntaxFailures + ' erro(s) de sintaxe, ' + importFailures + ' import(s) local(is) ausente(s) e ' + architectureFailures + ' falha(s) de arquitetura.');
  process.exit(1);
}
console.log('Verificação estática OK: sintaxe, imports relativos e banco único em ' + files.length + ' arquivos JavaScript.');
