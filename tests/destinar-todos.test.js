// Destinar todos: processos espalhados em várias páginas; depois de arquivar a Mesa volta em TODOS (gaveta TODOS),
// e o select de gaveta só ganha a opção VIRTUAL 2 s depois.
const { chromium } = require('playwright'); const fs = require('fs');
const code = fs.readFileSync(process.env.SCRIPT || require('path').join(__dirname, '..', 'sipac-detalhar-lote.user.js'), 'utf8');
let p07 = []; for (let i = 0; i < 230; i++) p07.push(String(100000 + i) + '-' + String(i % 90).padStart(2, '0'));
let p08 = [], arq = {}, voltaTodos = false, msg = '';
const mesa = () => `<html><head><meta charset=utf-8></head><body><div>${msg}</div>
<select id="menuForm:selecaoCategorias" onchange="atualizarCategoria()"><option value=1>PROCESSOS PENDENTES DE RECEBIMENTO NA UNIDADE</option><option value=3 selected>PROCESSOS NA UNIDADE</option></select>
<select id="menuForm:combo_gavetas" onchange="atualizarGaveta()"><option value=0>TODOS</option></select>
<div id="pastas"></div>
<select id="menuForm:atualizarPaginacao" onchange="atualizarPainelListagem()"><option>25</option><option>50</option><option>100</option></select>
<div id="lista"></div><div id="cont">0 Itens Selecionados</div>
<a id="menuForm:b_opcao_arquivar_procs" href="#" onclick="var ids=[...document.querySelectorAll('input.ck:checked')].map(c=>c.dataset.id);location.href='/sipac/protocolo/mesa_virtual/arquivar.jsf?ids='+ids.join(',');return false">Arquivar Processos Selecionados</a>
<button onclick="document.getElementById('modal').style.display='block'">Mover Processos Selecionados...</button>
<form id="formMoverItensPasta"><div id="modal" style="display:none">Pasta origem: 07 - PAGOS
 <select id="formMoverItensPasta:gavetas" onchange="document.getElementById('formMoverItensPasta:pastas').innerHTML='<option>--</option><option value=8>08 - AGUARD. DARF E GPS</option>'"><option>--</option><option value=v>VIRTUAL</option></select>
 <select id="formMoverItensPasta:pastas"></select>
 <input type=button value="Mover Processos" onclick="var ids=[...document.querySelectorAll('input.ck:checked')].map(c=>c.dataset.id);fetch('/mock/mover?ids='+ids.join(','))"></div></form>
<script>
let pg=0, size=25, gav=${voltaTodos ? 0 : 621}, pasta=${voltaTodos ? 0 : 29578};
function bar(d){ document.getElementById('pastas').innerHTML = gav ? '<div class="bg-pastas"><div class="'+(pasta===29578?'active':'')+'" onclick="atualizarPasta(29578)">07 - PAGOS</div><span onclick="atualizarPasta(29578)">'+d.n07+'</span></div>' : '<div class="bg-pastas"><div class="active" onclick="atualizarPasta(0)">TODOS</div></div>'; }
function render(d){ bar(d); if(!pasta){document.getElementById('lista').innerHTML='<p>1 - 25 de 630 Processos</p>';return;} document.getElementById('lista').innerHTML='<p>'+d.ini+' - '+d.fim+' de '+d.total+' Processos</p><table>'+d.rows.map((id,i)=>'<tr><td><input type=checkbox class=ck data-id="'+id+'" onchange="countItensSelecionados()"><a id="f:'+i+':verNumProcesso">23077.'+id.split('-')[0]+'/2026-'+id.split('-')[1]+'</a></td></tr>').join('')+'</table>'; countItensSelecionados(); }
function countItensSelecionados(){ document.getElementById('cont').textContent=document.querySelectorAll('input.ck:checked').length+' Itens Selecionados'; }
function carregar(){ setTimeout(()=>fetch('/mock/rows?pg='+pg+'&size='+size).then(r=>r.json()).then(render),300); }
function mudarPagina(n){ pg=n; carregar(); }
function atualizarPasta(id){ pasta=id; pg=0; carregar(); }
function atualizarPainelListagem(){ size=+document.getElementById('menuForm:atualizarPaginacao').value; pg=0; carregar(); }
function atualizarCategoria(){ carregar(); }
function atualizarGaveta(){ gav=+document.getElementById('menuForm:combo_gavetas').value; carregar(); }
if (gav) { document.getElementById('menuForm:combo_gavetas').innerHTML='<option value=0>TODOS</option><option value=621 selected>VIRTUAL</option>'; }
else setTimeout(()=>{ document.getElementById('menuForm:combo_gavetas').innerHTML='<option value=0 selected>TODOS</option><option value=621>VIRTUAL</option>'; }, 2000);
carregar();
</script></body></html>`;
const arquivarTela = ids => `<html><head><meta charset=utf-8></head><body><form id="arquivamentoForm"><p>${ids.map(id => '23077.' + id.split('-')[0] + '/2026-' + id.split('-')[1]).join(' ')}</p>
<select id="arquivamentoForm:gavetas" onchange="setTimeout(()=>{document.getElementById('px').innerHTML='<select id=\\'arquivamentoForm:pastas\\'><option>--</option><option>06 - PAGAMENTOS JUNHO</option><option>07 - PAGAMENTOS JULHO</option><option>08 - PAGAMENTOS AGOSTO</option></select>'},400)"><option>--</option><option>2025</option><option>2026</option></select><span id="px"></span>
<input type=button id="arquivamentoForm:b_arquivar_processo" value="Confirmar" onclick="var p=document.getElementById('arquivamentoForm:pastas');fetch('/mock/arquivar?ids=${ids.join(',')}&pasta='+encodeURIComponent(p.options[p.selectedIndex].text)).then(()=>location.href='/sipac/protocolo/mesa_virtual/lista.jsf')"></form></body></html>`;
(async () => {
  const b = await chromium.launch(); const ctx = await b.newContext({ viewport: { width: 1366, height: 800 } });
  await ctx.addInitScript(c => { document.addEventListener('DOMContentLoaded', () => { try { (0, eval)(c); } catch (e) { console.log('ERRSCRIPT ' + e.message); } }); }, code);
  const pg = await ctx.newPage(); const errs = []; pg.on('pageerror', e => errs.push(e.message));
  const dlg = []; pg.on('dialog', d => { dlg.push(d.message().slice(0, 400)); d.accept(); });
  await ctx.route('**/*', r => {
    const u = new URL(r.request().url());
    if (u.pathname === '/mock/rows') { const n = +u.searchParams.get('pg'), sz = +u.searchParams.get('size'); const rows = p07.slice(n * sz, n * sz + sz); return r.fulfill({ contentType: 'application/json', body: JSON.stringify({ ini: n * sz + 1, fim: n * sz + rows.length, total: p07.length, rows, n07: p07.length }) }); }
    if (u.pathname === '/mock/arquivar') { const ids = u.searchParams.get('ids').split(','); p07 = p07.filter(x => !ids.includes(x)); const k = u.searchParams.get('pasta'); arq[k] = (arq[k] || []).concat(ids); voltaTodos = true; msg = 'Operação realizada com sucesso!'; return r.fulfill({ body: 'ok' }); }
    if (u.pathname === '/mock/mover') { const ids = u.searchParams.get('ids').split(','); p07 = p07.filter(x => !ids.includes(x)); p08 = p08.concat(ids); return r.fulfill({ body: 'ok' }); }
    if (u.pathname.endsWith('/arquivar.jsf')) return r.fulfill({ contentType: 'text/html', body: arquivarTela(u.searchParams.get('ids').split(',')) });
    if (u.pathname.endsWith('/lista.jsf')) { const h = mesa(); voltaTodos = false; msg = ''; return r.fulfill({ contentType: 'text/html', body: h }); }
    return r.fulfill({ contentType: 'text/html', body: '<html><body>x</body></html>' });
  });
  await pg.goto('https://sipac.ufrn.br/sipac/protocolo/mesa_virtual/lista.jsf');
  const recs = {};
  const mk = (id, caso, ob) => { recs[id] = { id, num: id.split('-')[0], dv: id.split('-')[1], st: 'GRAVADO', caso, obData: ob, valor: '10,00', ordem: 1, atualizado: Date.now() }; };
  [3, 40, 77, 120, 199, 225].forEach(i => mk(p07[i], 'SIMPLES', '10/07/2026'));
  [10, 150].forEach(i => mk(p07[i], 'SIMPLES', '10/06/2026'));
  [60, 210].forEach(i => mk(p07[i], 'DARF', '10/07/2026'));
  mk('999999-99', 'SIMPLES', '10/07/2026'); // não está na 07 (já arquivado à mão)
  await pg.evaluate(r => { localStorage.clear(); localStorage.setItem('sdl2_proc', JSON.stringify(r)); localStorage.setItem('sdl-bk-aviso', new Date().toLocaleDateString('pt-BR')); }, recs);
  await pg.reload(); await pg.waitForTimeout(1500);
  console.log('secao3:', await pg.evaluate(() => document.getElementById('sdl-dest').innerText.replace(/\n+/g, ' | ')));
  await pg.click('button[data-a="dest-todos"]');
  for (let i = 0; i < 200; i++) { await pg.waitForTimeout(1000); const q = await pg.evaluate(() => localStorage.getItem('sdl2_filaDest')).catch(() => 'nav'); if (q === null) break; }
  await pg.waitForTimeout(1500);
  console.log('CONFIRM:', dlg[0].replace(/\n/g, ' / ').slice(0, 300));
  console.log('arq:', JSON.stringify(arq), '| 08:', p08.join(','), '| 07 restantes:', p07.length);
  console.log('status:', await pg.evaluate(() => Object.values(JSON.parse(localStorage.getItem('sdl2_proc'))).map(r => r.id + ':' + r.st).join(' ')));
  console.log('secao3 fim:', await pg.evaluate(() => document.getElementById('sdl-dest').innerText.replace(/\n+/g, ' | ')));
  console.log('log:', await pg.evaluate(() => JSON.parse(localStorage.getItem('sdl2_log')).slice(0, 8).map(l => l.slice(0, 160)).join('\n  ')));
  console.log('erros', JSON.stringify(errs)); await b.close();
})();
