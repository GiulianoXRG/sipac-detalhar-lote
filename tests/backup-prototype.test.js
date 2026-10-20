// Backup gerado numa página com Prototype.js (Array.prototype.toJSON) e importado em outro computador.
const { chromium } = require('playwright'); const fs = require('fs');
const code = fs.readFileSync(process.env.SCRIPT || require('path').join(__dirname, '..', 'sipac-detalhar-lote.user.js'), 'utf8');
const proto = "Array.prototype.toJSON = function(){ var t = Array.prototype.toJSON; delete Array.prototype.toJSON; var s = JSON.stringify(this); Array.prototype.toJSON = t; return s; };";
(async () => {
  const b = await chromium.launch();
  const ctx1 = await b.newContext({ acceptDownloads: true, viewport: { width: 1366, height: 860 } });
  const pg = await ctx1.newPage(); const errs = []; pg.on('pageerror', e => errs.push('PC1 ' + e.message));
  pg.on('dialog', d => d.accept());
  await pg.route('**/*', r => r.fulfill({ contentType: 'text/html', body: `<html><head><meta charset=utf-8><script>${proto}</script></head><body>x</body></html>` }));
  await pg.goto('https://sipac.ufrn.br/sipac/protocolo/mesa_virtual/lista.jsf');
  await pg.evaluate(() => { localStorage.clear(); localStorage.setItem('sdl-bk-aviso', new Date().toLocaleDateString('pt-BR'));
    const t = Array.prototype.toJSON; delete Array.prototype.toJSON;
    localStorage.setItem('sdl2_proc', JSON.stringify({ 'a-1': { id: 'a-1', num: '900201', dv: '11', st: 'PRONTO', caso: 'DARF', multi: true, valor: '30,00', ob: '1', obData: '01/09/2026', obValor: '28,00',
      partes: [{ req: '1', valor: '10,00', obValor: '9,00', feito: true }, { req: '2', valor: '20,00', obValor: '19,00', feito: false }], ordem: 1, atualizado: Date.now() } }));
    localStorage.setItem('sdl2_log', JSON.stringify(['10:00 linha de log']));
    Array.prototype.toJSON = t; });
  await pg.evaluate(code); await pg.waitForTimeout(500);
  const [dl] = await Promise.all([pg.waitForEvent('download'), pg.evaluate(() => document.getElementById('b-baixar').click())]);
  await dl.saveAs('bk-proto.json');
  const j = JSON.parse(fs.readFileSync('bk-proto.json', 'utf8'));
  console.log('no arquivo: partes é', typeof j.proc['a-1'].partes, '| log é', Array.isArray(j.log) ? 'array' : typeof j.log);
  // "computador da chefe": página nova, sem dados, importa o arquivo
  const ctx2 = await b.newContext({ viewport: { width: 1366, height: 860 } });
  const pg2 = await ctx2.newPage(); pg2.on('pageerror', e => errs.push('PC2 ' + e.message)); pg2.on('dialog', d => d.accept());
  await pg2.route('**/*', r => r.fulfill({ contentType: 'text/html', body: `<html><head><meta charset=utf-8><script>${proto}</script></head><body>x</body></html>` }));
  await pg2.goto('https://sipac.ufrn.br/sipac/protocolo/mesa_virtual/lista.jsf');
  await pg2.evaluate(() => localStorage.setItem('sdl-bk-aviso', new Date().toLocaleDateString('pt-BR')));
  await pg2.evaluate(code); await pg2.waitForTimeout(500);
  await pg2.setInputFiles('#sdl-arq', 'bk-proto.json'); await pg2.waitForTimeout(800);
  await pg2.click('#sdl-tabs [data-f="todos"]').catch(() => {}); await pg2.waitForTimeout(400);
  console.log('PC2 lista:', await pg2.evaluate(() => document.getElementById('sdl-lista').innerText.replace(/\n+/g, ' | ').slice(0, 200)));
  console.log('PC2 partes salvo como:', await pg2.evaluate(() => { const P = JSON.parse(localStorage.getItem('sdl2_proc')); return typeof P['a-1'].partes + ' ' + JSON.stringify(P['a-1'].partes).slice(0, 80); }));
  console.log('erros', JSON.stringify(errs)); await b.close();
})();
