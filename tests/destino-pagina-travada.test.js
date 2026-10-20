const { chromium } = require('playwright'); const fs = require('fs');
const code = fs.readFileSync('' + require('path').join(__dirname, '..', 'sipac-detalhar-lote.user.js') + '', 'utf8');
// "servidor" do SIPAC simulado
let p07 = []; for (let i = 0; i < 60; i++) p07.push(String(100000 + i) + '-' + String(i % 90).padStart(2, '0'));
let p08 = [], arq = {}; let msg = '';
const pastaBar = () => `<div class="bg-pastas"><div onclick="atualizarPasta(0)">TODOS <span>${p07.length + p08.length}</span></div>
 <div class="${'active'}" onclick="atualizarPasta(29578)">07 - PAGOS</div><span id="atualizaPastaItens">${p07.length}</span>
 <div onclick="atualizarPasta(30001)">08 - AGUARD. DARF E GPS</div><span>${p08.length}</span></div>`;
const mesa = () => `<html><head><meta charset=utf-8><title>Mesa</title></head><body>
<div id="msg">${msg}</div>
<div id="pastas">${pastaBar()}</div>
<select id="menuForm:atualizarPaginacao"><option>25</option><option>50</option><option>100</option></select>
<div id="lista"></div><div id="cont">0 Itens Selecionados</div>
<a id="menuForm:b_opcao_arquivar_procs" href="#" onclick="var ids=[...document.querySelectorAll('input.ck:checked')].map(c=>c.dataset.id);location.href='/sipac/protocolo/mesa_virtual/arquivar.jsf?ids='+ids.join(',');return false">Arquivar Processos Selecionados</a>
<button id="b_mover_procs_unidade" onclick="document.getElementById('modal').style.display='block'">Mover Processos Selecionados...</button>
<form id="formMoverItensPasta"><div id="modal" style="display:none">Pasta origem: 07 - PAGOS
 <select id="formMoverItensPasta:gavetas" onchange="document.getElementById('formMoverItensPasta:pastas').innerHTML='<option>--</option><option value=8>08 - AGUARD. DARF E GPS</option>'"><option>--</option><option value=v>VIRTUAL</option></select>
 <select id="formMoverItensPasta:pastas"></select>
 <input type=button value="Mover Processos" onclick="var ids=[...document.querySelectorAll('input.ck:checked')].map(c=>c.dataset.id);fetch('/mock/mover?ids='+ids.join(',')).then(()=>{document.getElementById('pastas').innerHTML='(atualiza só ao recarregar)'})"></div></form>
<script>
let pg = 0;
function render(d){ document.getElementById('lista').innerHTML='<p>'+(d.ini)+' - '+d.fim+' de '+d.total+' Processos</p><table>'+d.rows.map((id,i)=>'<tr><td><input type=checkbox class=ck data-id="'+id+'" onchange="countItensSelecionados()"><a id="f:'+i+':verNumProcesso">23077.'+id.split('-')[0]+'/2026-'+id.split('-')[1]+'</a></td></tr>').join('')+'</table>'; countItensSelecionados(); }
function countItensSelecionados(){ document.getElementById('cont').textContent=document.querySelectorAll('input.ck:checked').length+' Itens Selecionados'; }
function mudarPagina(n){ pg=n; setTimeout(()=>fetch('/mock/rows?pg='+n).then(r=>r.json()).then(render),300); }
function atualizarPasta(id){ mudarPagina(0); }
mudarPagina(0);
</script></body></html>`;
const arquivarTela = ids => `<html><head><meta charset=utf-8></head><body><form id="arquivamentoForm">
<p>Processos: ${ids.map(id => '23077.' + id.split('-')[0] + '/2026-' + id.split('-')[1]).join(' ')}</p>
<select id="arquivamentoForm:gavetas" onchange="setTimeout(()=>{document.getElementById('px').innerHTML='<select id=\\'arquivamentoForm:pastas\\'><option>--</option><option value=8>08 - PAGAMENTOS AGOSTO</option><option value=9>09 - PAGAMENTOS SETEMBRO</option></select>'},500)"><option>--</option><option value=a>2025</option><option value=b>2026</option></select>
<span id="px"></span>
<input type=button id="arquivamentoForm:b_arquivar_processo" value="Confirmar" onclick="var p=document.getElementById('arquivamentoForm:pastas');fetch('/mock/arquivar?ids=${ids.join(',')}&pasta='+encodeURIComponent(p.options[p.selectedIndex].text)).then(()=>{document.body.insertAdjacentHTML('beforeend','<p>processando…</p>')})">
</form></body></html>`;
(async () => {
  const b = await chromium.launch(); const ctx = await b.newContext({ viewport: { width: 1366, height: 800 } });
  await ctx.addInitScript(c => { document.addEventListener('DOMContentLoaded', () => { try { (0, eval)(c); } catch (e) { console.log('ERRSCRIPT ' + e.message); } }); }, code);
  const pg = await ctx.newPage();
  const errs = []; pg.on('pageerror', e => errs.push(e.message)); pg.on('console', m => { if (/ERR/.test(m.text())) errs.push(m.text()); });
  const dlg = []; pg.on('dialog', d => { dlg.push(d.message().slice(0, 300)); d.accept(); });
  await ctx.route('**/*', r => {
    const u = new URL(r.request().url());
    if (u.pathname === '/mock/rows') { const n = +u.searchParams.get('pg'); const rows = p07.slice(n * 25, n * 25 + 25); return r.fulfill({ contentType: 'application/json', body: JSON.stringify({ ini: n * 25 + 1, fim: n * 25 + rows.length, total: p07.length, rows }) }); }
    if (u.pathname === '/mock/arquivar') { const ids = u.searchParams.get('ids').split(','); p07 = p07.filter(x => !ids.includes(x)); arq[u.searchParams.get('pasta')] = (arq[u.searchParams.get('pasta')] || []).concat(ids); msg = 'Operação realizada com sucesso!'; return r.fulfill({ body: 'ok' }); }
    if (u.pathname === '/mock/mover') { const ids = u.searchParams.get('ids').split(','); p07 = p07.filter(x => !ids.includes(x)); p08 = p08.concat(ids); return r.fulfill({ body: 'ok' }); }
    if (u.pathname.endsWith('/arquivar.jsf')) return r.fulfill({ contentType: 'text/html', body: arquivarTela(u.searchParams.get('ids').split(',')) });
    if (u.pathname.endsWith('/lista.jsf')) { const h = mesa(); msg = ''; return r.fulfill({ contentType: 'text/html', body: h }); }
    return r.fulfill({ contentType: 'text/html', body: '<html><body>x</body></html>' });
  });
  await pg.goto('https://sipac.ufrn.br/sipac/protocolo/mesa_virtual/lista.jsf');
  // página 2: 100025..100049. Registros: 3 SIMPLES agosto, 2 SIMPLES setembro, 2 DARF
  const recs = {};
  const mk = (i, st, caso, ob) => { const id = p07[i]; recs[id] = { id, num: id.split('-')[0], dv: id.split('-')[1], st, caso, obData: ob, valor: '10,00', ordem: i, atualizado: Date.now() }; };
  [26, 30, 41].forEach(i => mk(i, 'GRAVADO', 'SIMPLES', '18/08/2026'));
  [27, 44].forEach(i => mk(i, 'GRAVADO', 'ISS', '02/09/2026'));
  [33, 48].forEach(i => mk(i, 'GRAVADO', 'DARF', '18/08/2026'));
  mk(5, 'GRAVADO', 'SIMPLES', '18/08/2026'); // página 1 – não deve ser tocado
  await pg.evaluate(r => { localStorage.clear(); localStorage.setItem('sdl2_proc', JSON.stringify(r)); localStorage.setItem('sdl-bk-aviso', new Date().toLocaleDateString('pt-BR')); }, recs);
  await pg.reload(); await pg.waitForTimeout(1500);
  await pg.evaluate(() => mudarPagina(1)); await pg.waitForTimeout(1200);
  console.log('dest:', await pg.evaluate(() => document.getElementById('sdl-dest').innerText.replace(/\n+/g, ' | ')));
  await pg.click('button[data-a="dest-tudo"]');
  for (let i = 0; i < 400; i++) { await pg.waitForTimeout(1000); const q = await pg.evaluate(() => localStorage.getItem('sdl2_filaDest')).catch(() => 'nav'); if (q === null) break; }
  await pg.waitForTimeout(1500);
  console.log('CONFIRM:', dlg[0]);
  console.log('arq:', JSON.stringify(arq), '08:', p08.join(','));
  console.log('07 restantes:', p07.length, 'pagina atual:', await pg.evaluate(() => (document.body.innerText.match(/\d+ - \d+ de \d+ Processos/) || [''])[0]));
  console.log('status:', await pg.evaluate(() => { const P = JSON.parse(localStorage.getItem('sdl2_proc')); return Object.values(P).map(r => r.id + ':' + r.st).join(' '); }));
  console.log('log:', await pg.evaluate(() => JSON.parse(localStorage.getItem('sdl2_log')).slice(0, 6).join('\n  ')));
  console.log('outros dialogs:', dlg.slice(1).join(' || '));
  console.log('erros', JSON.stringify(errs)); await b.close();
})();
