// Roda todos os testes numa Mesa Virtual SIMULADA (nada toca o SIPAC real).
// Uso: npm install && npx playwright install chromium && npm test
const { execFileSync } = require('child_process');
const fs = require('fs'), path = require('path');
execFileSync(process.execPath, ['--check', path.join(__dirname, '..', 'sipac-detalhar-lote.user.js')], { stdio: 'inherit' });
let falhas = 0;
for (const f of fs.readdirSync(__dirname).filter(f => f.endsWith('.test.js'))) {
  process.stdout.write(`\n== ${f}\n`);
  try {
    const out = execFileSync(process.execPath, [path.join(__dirname, f)], { cwd: path.join(__dirname, 'out'), encoding: 'utf8', timeout: 240000 });
    process.stdout.write(out);
    if (/erros \[(?!\])/.test(out)) { falhas++; console.log('  ✗ erros de JavaScript na página'); }
  } catch (e) { falhas++; console.log('  ✗ ' + (e.stdout || '') + (e.stderr || e.message)); }
}
console.log(falhas ? `\n${falhas} teste(s) com problema` : '\nTodos os testes rodaram sem erro de JavaScript.');
process.exit(falhas ? 1 : 0);
