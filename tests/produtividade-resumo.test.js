const { chromium } = require('playwright'); const fs = require('fs');
(async () => {
  const b = await chromium.launch(); const ctx = await b.newContext({ viewport: { width: 1366, height: 860 }, permissions: ['clipboard-read', 'clipboard-write'] });
  const pg = await ctx.newPage(); const errs = []; pg.on('pageerror', e => errs.push(e.message));
  const dlg = []; pg.on('dialog', d => { dlg.push(d.message().slice(0, 120)); d.accept(); });
  await pg.route('**/*', r => r.fulfill({ contentType: 'text/html', body: `<html><head><meta charset=utf-8></head><body>x</body></html>` }));
  await pg.goto('https://sipac.ufrn.br/sipac/protocolo/mesa_virtual/lista.jsf');
  await pg.evaluate(() => {
    localStorage.clear(); const now = Date.now(), h = 3600e3, d = 864e5; const P = {};
    const add = (id, o) => P[id] = Object.assign({ id, num: id.split('-')[0], dv: id.split('-')[1], ordem: now - 2 * h, atualizado: now - h }, o);
    for (let i = 0; i < 6; i++) add('10000' + i + '-1' + i, { st: 'ARQUIVADO', caso: 'SIMPLES', valor: '1.000,00', motivo: 'arquivado em 09 - PAGAMENTOS SETEMBRO', gravadoTs: now - 3 * h + i * 150e3, destinoTs: now - h });
    for (let i = 0; i < 3; i++) add('20000' + i + '-2' + i, { st: 'MOVIDO', caso: 'DARF', valor: '500,00', gravadoTs: now - d - 2 * h + i * 200e3, destinoTs: now - d });
    add('300000-30', { st: 'PENDENTE', motivo: 'NS anexada é só a LISTA do SIAFI', ordem: now - h });
    add('300001-31', { st: 'PENDENTE', motivo: 'conferência falhou: favorecido x', rev: 'esperando', revNota: 'aguardando retorno', ordem: now - h });
    add('300002-32', { st: 'GRAVADO', caso: 'SIMPLES', valor: '50,00', obData: '01/09/2026', gravadoTs: now - 10 * 60e3, relConf: 'ok' });
    localStorage.setItem('sdl2_proc', JSON.stringify(P));
    localStorage.setItem('sdl-backup', JSON.stringify({ t: now - 2 * d }));
  });
  await pg.evaluate(fs.readFileSync('' + require('path').join(__dirname, '..', 'sipac-detalhar-lote.user.js') + '', 'utf8')); await pg.waitForTimeout(3000);
  console.log('dialogs ao abrir:', dlg.join(' || '));
  await pg.click('#sdl-tabs [data-f="hist"]'); await pg.waitForTimeout(300);
  await pg.click('button[data-a="resumo"]'); await pg.waitForTimeout(300);
  console.log('RESUMO:\n' + await pg.evaluate(() => navigator.clipboard.readText()));
  console.log('bk:', await pg.evaluate(() => document.getElementById('sdl-bk').innerText));
  await pg.screenshot({ path: 'j.png', clip: { x: 920, y: 340, width: 446, height: 520 } });
  console.log('erros', JSON.stringify(errs)); await b.close();
})();
