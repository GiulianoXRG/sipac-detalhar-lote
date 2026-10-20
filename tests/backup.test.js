// Backup: pasta (simulada com o OPFS do Chrome), salvar, cópias internas e restaurar cópia.
const { chromium } = require('playwright'); const fs = require('fs');
const code = fs.readFileSync(process.env.SCRIPT || require('path').join(__dirname, '..', 'sipac-detalhar-lote.user.js'), 'utf8');
(async () => {
  const b = await chromium.launch(); const ctx = await b.newContext({ viewport: { width: 1366, height: 860 } });
  await ctx.addInitScript(() => { window.showDirectoryPicker = () => navigator.storage.getDirectory(); });
  await ctx.addInitScript(c => { document.addEventListener('DOMContentLoaded', () => { try { (0, eval)(c); } catch (e) { console.log('ERRSCRIPT ' + e.message); } }); }, code);
  const pg = await ctx.newPage(); const errs = []; pg.on('pageerror', e => errs.push(e.message)); pg.on('console', m => /ERR/.test(m.text()) && errs.push(m.text()));
  const dlg = []; pg.on('dialog', d => { dlg.push(d.message().slice(0, 160)); d.accept(); });
  await ctx.route('**/*', r => r.fulfill({ contentType: 'text/html', body: '<html><head><meta charset=utf-8></head><body><p>x</p></body></html>' }));
  await pg.goto('https://sipac.ufrn.br/sipac/protocolo/mesa_virtual/lista.jsf');
  await pg.evaluate(() => { localStorage.clear(); localStorage.setItem('sdl-bk-aviso', new Date().toLocaleDateString('pt-BR'));
    localStorage.setItem('sdl2_proc', JSON.stringify({ 'a-1': { id: 'a-1', num: '111111', dv: '11', st: 'PENDENTE', motivo: 'x', ordem: 1, atualizado: Date.now() } })); });
  await pg.reload(); await pg.waitForTimeout(1500);
  const bk = () => pg.evaluate(() => document.getElementById('sdl-bk').innerText);
  console.log('1 sem pasta:', await bk());
  await pg.click('button[data-a="bk-pasta"]'); await pg.waitForTimeout(1200);
  console.log('2 com pasta:', await bk());
  const arquivos = () => pg.evaluate(async () => { const d = await navigator.storage.getDirectory(); const r = []; for await (const [n, h] of d.entries()) { const f = await h.getFile(); r.push(n + ':' + f.size); } return r.join(', '); });
  console.log('   arquivos na pasta:', await arquivos());
  // mudança + salvar agora
  await pg.evaluate(() => { const P = JSON.parse(localStorage.getItem('sdl2_proc')); P['b-2'] = { id: 'b-2', num: '222222', dv: '22', st: 'PRONTO', ordem: 2, atualizado: Date.now() }; localStorage.setItem('sdl2_proc', JSON.stringify(P)); });
  await pg.waitForTimeout(300);
  await pg.click('#b-backup'); await pg.waitForTimeout(1200);
  console.log('3 após salvar:', await bk(), '|', await arquivos());
  const conteudo = await pg.evaluate(async () => { const d = await navigator.storage.getDirectory(); for await (const [n, h] of d.entries()) { const j = JSON.parse(await (await h.getFile()).text()); return n + ' -> ' + Object.keys(j.proc).join(',') + ' v' + j.versao; } });
  console.log('   conteúdo:', conteudo);
  // recarregar: pasta continua configurada
  await pg.reload(); await pg.waitForTimeout(2000);
  console.log('4 após recarregar:', await bk());
  // cópias internas e restaurar
  await pg.evaluate(() => { document.getElementById('sdl-bkcfg').open = true; }); await pg.waitForTimeout(800);
  console.log('5 cópias:', await pg.evaluate(() => [...document.querySelectorAll('#sdl-snaps option')].map(o => o.textContent).join(' | ')));
  await pg.evaluate(() => { localStorage.setItem('sdl2_proc', JSON.stringify({})); });
  await pg.click('#b-snap'); await pg.waitForTimeout(1000);
  console.log('6 restaurado:', await pg.evaluate(() => Object.keys(JSON.parse(localStorage.getItem('sdl2_proc'))).join(',')), '| opções:', await pg.evaluate(() => [...document.querySelectorAll('#sdl-snaps option')].map(o => o.textContent.split(' · ')[0]).join(' | ')));
  console.log('dialogs:', dlg.map(d => d.replace(/\n/g, ' / ')).join(' || '));
  await pg.screenshot({ path: 'l.png', clip: { x: 920, y: 560, width: 446, height: 300 } });
  console.log('erros', JSON.stringify(errs)); await b.close();
})();
