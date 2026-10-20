const { chromium } = require('playwright'); const fs = require('fs');
(async () => {
  const b = await chromium.launch(); const pg = await b.newPage({ viewport: { width: 1366, height: 760 } });
  const errs = []; pg.on('pageerror', e => errs.push(e.message));
  await pg.route('**/*', r => r.fulfill({ contentType: 'text/html', body: `<html><head><meta charset=utf-8></head><body><p>26 - 50 de 500 Processos</p><table><tr><td><input type=checkbox><a id="f:0:verNumProcesso">23077.900103/2026-15</a></td></tr></table></body></html>` }));
  await pg.goto('https://sipac.ufrn.br/sipac/protocolo/mesa_virtual/lista.jsf');
  await pg.evaluate(() => { localStorage.clear(); localStorage.setItem('sdl2_proc', JSON.stringify({
    '900102-41': { id: '900102-41', num: '900102', dv: '41', st: 'GRAVADO', caso: 'DARF', valor: '1.963,90', ob: '476', obData: '28/08/2026', obValor: '1.849,01', pagina: 3, ordem: 1 },
    '900103-15': { id: '900103-15', num: '900103', dv: '15', st: 'GRAVADO', caso: 'INSS', valor: '5.621,74', ob: '477', obData: '28/08/2026', obValor: '5.292,87', pagina: 2, ordem: 2 },
    '900101-17': { id: '900101-17', num: '900101', dv: '17', st: 'GRAVADO', caso: 'ISS', valor: '1,00', ob: '1', obData: '01/09/2026', obValor: '1,00', ordem: 3 } })); });
  await pg.evaluate(fs.readFileSync('' + require('path').join(__dirname, '..', 'sipac-detalhar-lote.user.js') + '', 'utf8')); await pg.waitForTimeout(300);
  await pg.click('#sdl-tabs [data-f="mover"]'); await pg.waitForTimeout(200);
  console.log(await pg.evaluate(() => [...document.querySelectorAll('#sdl-tabs button')].map(b => b.textContent).join(' | ')));
  console.log(await pg.evaluate(() => [...document.querySelectorAll('#sdl-lista .proc')].map(e => e.textContent).join(', ')));
  await pg.screenshot({ path: 'f.png', clip: { x: 920, y: 300, width: 446, height: 360 } });
  console.log('erros', JSON.stringify(errs)); await b.close();
})();
