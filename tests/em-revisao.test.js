const { chromium } = require('playwright'); const fs = require('fs');
(async () => {
  const b = await chromium.launch(); const pg = await b.newPage({ viewport: { width: 1366, height: 800 } });
  const errs = []; pg.on('pageerror', e => errs.push(e.message));
  let resp = []; pg.on('dialog', d => { const v = resp.shift(); d.accept(v); });
  await pg.route('**/*', r => r.fulfill({ contentType: 'text/html', body: `<html><head><meta charset=utf-8></head><body><p>x</p></body></html>` }));
  await pg.goto('https://sipac.ufrn.br/sipac/protocolo/mesa_virtual/lista.jsf');
  await pg.evaluate(() => { localStorage.clear(); localStorage.setItem('sdl2_proc', JSON.stringify({
    'a-1': { id: 'a-1', num: '900107', dv: '09', st: 'PENDENTE', motivo: 'NS anexada é só a LISTA do SIAFI', ordem: 1 },
    'b-2': { id: 'b-2', num: '900105', dv: '09', st: 'PENDENTE', motivo: 'conferência falhou: favorecido 00.000.000/0001-91', ordem: 2 },
    'c-3': { id: 'c-3', num: '900106', dv: '11', st: 'PENDENTE', motivo: 'o SIPAC recusou a requisição 1374', ordem: 3 } })); });
  await pg.evaluate(fs.readFileSync('' + require('path').join(__dirname, '..', 'sipac-detalhar-lote.user.js') + '', 'utf8')); await pg.waitForTimeout(300);
  const tabs = () => pg.evaluate(() => [...document.querySelectorAll('#sdl-tabs button')].map(b => b.textContent).join(' | '));
  const procs = () => pg.evaluate(() => [...document.querySelectorAll('#sdl-lista .proc')].map(e => e.textContent).join(', '));
  await pg.click('#sdl-tabs [data-f="pend"]'); await pg.waitForTimeout(150);
  console.log(await tabs()); console.log('pend:', await procs());
  await pg.selectOption('select[data-rev="b-2"]', 'esperando'); await pg.waitForTimeout(200);
  resp = ['ver com a chefia']; await pg.click('button[data-a="minha"][data-id="a-1"]'); await pg.waitForTimeout(200);
  console.log(await tabs()); console.log('pend:', await procs());
  await pg.click('#sdl-tabs [data-f="rev"]'); await pg.waitForTimeout(150);
  console.log('rev:', await procs(), '|', await pg.evaluate(() => document.querySelector('.subchips').innerText.replace(/\n/g, ' ')));
  await pg.click('[data-sub="esperando"]'); await pg.waitForTimeout(150); console.log('rev esperando:', await procs());
  await pg.screenshot({ path: 'i.png', clip: { x: 920, y: 300, width: 446, height: 420 } });
  console.log('erros', JSON.stringify(errs)); await b.close();
})();
