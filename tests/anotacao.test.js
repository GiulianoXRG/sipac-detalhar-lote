const { chromium } = require('playwright'); const fs = require('fs');
(async () => {
  const b = await chromium.launch(); const pg = await b.newPage({ viewport: { width: 1366, height: 700 } });
  const errs = []; pg.on('pageerror', e => errs.push(e.message));
  const dlg = []; pg.on('dialog', d => { dlg.push(d.type() + ':' + d.message().slice(0, 80) + ' [' + d.defaultValue() + ']'); d.accept(d.type()==='prompt'?d.defaultValue():undefined); });
  await pg.route('**/*', r => r.fulfill({ contentType: 'text/html', body: `<html><head><meta charset=utf-8></head><body><h2>PROCESSO 23077.900104/2026-90</h2>
  <form id="menuForm"><a id="menuForm:visualizarNotasProcesso" href="#" onclick="document.getElementById('panelVisualizaNotasProcessoContainer').style.display='block';return false">notas</a></form>
  <div id="panelVisualizaNotasProcessoContainer" style="display:none"><form id="formVisualizaNotasProcesso"><textarea id="formVisualizaNotasProcesso:textoNota"></textarea>
  <input type=radio id="formVisualizaNotasProcesso:restricaoNotaProcesso:0" name="r" checked><input type=radio id="formVisualizaNotasProcesso:restricaoNotaProcesso:1" name="r">
  <input type=button id="b_mover" value="Cadastrar" onclick="setTimeout(()=>{const d=document.createElement('div');d.textContent='Nota Pública: '+document.getElementById('formVisualizaNotasProcesso:textoNota').value;document.getElementById('lst').appendChild(d)},500)"></form><div id="lst">Nota Pública: NP 481</div></div></body></html>` }));
  await pg.goto('https://sipac.ufrn.br/sipac/protocolo/mesa_virtual/processo.jsf');
  await pg.evaluate(() => { localStorage.clear(); localStorage.setItem('sdl2_proc', JSON.stringify({ '900104-90': { id: '900104-90', num: '900104', dv: '90', st: 'PENDENTE', motivo: 'NS anexada é só a LISTA do SIAFI (5 NS, 0 deste CNPJ), sem a NS detalhada (data/observação) – anexar a NS ou fazer manual', ordem: 1 } })); });
  const code = fs.readFileSync('' + require('path').join(__dirname, '..', 'sipac-detalhar-lote.user.js') + '', 'utf8');
  await pg.evaluate(code); await pg.waitForTimeout(500);
  console.log('pag:', await pg.evaluate(() => document.getElementById('sdl-pag').innerText));
  await pg.click('#sdl-pag button[data-a="anotar"]'); await pg.waitForTimeout(2500);
  console.log('lista notas:', await pg.evaluate(() => document.getElementById('lst').innerText.replace(/\n/g, ' | ')));
  console.log('rec:', await pg.evaluate(() => { const r = JSON.parse(localStorage.getItem('sdl2_proc'))['900104-90']; return r.nota + ' @ ' + !!r.notaEm; }));
  // segunda vez: não duplica
  await pg.click('#sdl-pag button[data-a="anotar"]'); await pg.waitForTimeout(1500);
  console.log('lista2:', await pg.evaluate(() => document.getElementById('lst').innerText.split('Nota').length-1));
  console.log('log:', await pg.evaluate(() => JSON.parse(localStorage.getItem('sdl2_log')).slice(0, 2).join(' || ')));
  console.log('dialogs:', dlg.join('\n  '));
  // fluxo via aba nova: nota pendente no storage
  await pg.evaluate(() => { localStorage.setItem('sdl2_nota', JSON.stringify({ id: '900104-90', texto: 'Teste via aba', t: Date.now() })); });
  await pg.reload(); await pg.evaluate(code); await pg.waitForTimeout(3500);
  console.log('via aba:', await pg.evaluate(() => document.getElementById('lst').innerText.replace(/\n/g, ' | ')), 'notaKey:', await pg.evaluate(() => localStorage.getItem('sdl2_nota')));
  console.log('erros', JSON.stringify(errs)); await b.close();
})();
