const { chromium } = require('playwright'); const fs = require('fs');
(async () => {
  const b = await chromium.launch(); const pg = await b.newPage({ viewport: { width: 1366, height: 860 } });
  const errs = []; pg.on('pageerror', e => errs.push(e.message));
  const dlg = []; pg.on('dialog', d => { dlg.push(d.message().slice(0, 200)); d.accept(); });
  await pg.route('**/*', r => r.fulfill({ contentType: 'text/html', body: '<html><head><meta charset=utf-8></head><body>x</body></html>' }));
  await pg.goto('https://sipac.ufrn.br/sipac/protocolo/mesa_virtual/lista.jsf');
  await pg.evaluate(() => { localStorage.clear(); localStorage.setItem('sdl-bk-aviso', new Date().toLocaleDateString('pt-BR')); localStorage.setItem('sdl2_proc', JSON.stringify({
    '900109-71': { id: '900109-71', num: '900109', dv: '71', st: 'PENDENTE', ne: '325', neAno: '2025', neFonte: 'capa+PDF', semReq: true, motivo: 'formulário não abriu após o empenho | campos: empenhoForm:txtDocumento – SIPAC: "Empenho não cadastrado para a gestora CENTRO DE CIÊNCIAS DA SAÚDE (15.00) ou não existe."', ordem: 1 },
    '900108-05': { id: '900108-05', num: '900108', dv: '05', st: 'PENDENTE', ne: '125', neAno: '2026', motivo: 'formulário não abriu após o empenho – SIPAC: "O empenho já foi totalmente liquidado."', ordem: 2 },
    '111111-11': { id: '111111-11', num: '111111', dv: '11', st: 'PENDENTE', motivo: 'NS anexada é só a LISTA do SIAFI', ordem: 3 } })); });
  await pg.evaluate(fs.readFileSync('' + require('path').join(__dirname, '..', 'sipac-detalhar-lote.user.js') + '', 'utf8')); await pg.waitForTimeout(500);
  console.log(await pg.evaluate(() => Object.values(JSON.parse(localStorage.getItem('sdl2_proc'))).map(r => r.id + ': ' + r.motivo).join('\n')));
  await pg.click('#sdl-tabs [data-f="pend"]'); await pg.waitForTimeout(200);
  console.log('GRUPOS', await pg.evaluate(() => [...document.querySelectorAll('details.grp>summary')].map(s => s.textContent).join(' | ')));
  await pg.check('#sdl-auto'); await pg.waitForTimeout(300);
  console.log('AUTO confirm:', dlg[dlg.length - 1].replace(/\n/g, ' / '));
  console.log('AUTO label:', await pg.evaluate(() => document.querySelector('#sdl-auto').closest('label').className), 'log:', await pg.evaluate(() => JSON.parse(localStorage.getItem('sdl2_log'))[0]));
  await pg.uncheck('#sdl-auto'); await pg.waitForTimeout(200);
  console.log('após desligar:', await pg.evaluate(() => JSON.parse(localStorage.getItem('sdl2_log'))[0]));
  await pg.screenshot({ path: 'k.png', clip: { x: 920, y: 50, width: 446, height: 560 } });
  console.log('erros', JSON.stringify(errs)); await b.close();
})();
