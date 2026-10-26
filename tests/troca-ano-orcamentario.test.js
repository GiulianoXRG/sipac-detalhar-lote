// v0.20: troca do ano orçamentário para empenho de ano anterior no "Outros" (SIPAC simulado).
const { chromium } = require('playwright'); const fs = require('fs'), path = require('path');
const SCRIPT = fs.readFileSync(path.join(__dirname, '..', 'sipac-detalhar-lote.user.js'), 'utf8');
const ERRO_NE = 'Empenho não cadastrado para a gestora CENTRO DE CIÊNCIAS DA SAÚDE (15.00) ou não existe.';
const html = b => ({ contentType: 'text/html', body: '<html><head><meta charset=utf-8></head><body>' + b + '</body></html>' });
let falhas = 0;
const confere = (ok, msg) => { console.log((ok ? '  ✓ ' : '  ✗ ') + msg); if (!ok) falhas++; };

// sim = { ano: ano da sessão, anos: opções do combo, neAno: ano em que o empenho existe, pesquisas: [] }
async function cenario(b, sim, prep, acao) {
  const pg = await b.newPage({ viewport: { width: 1366, height: 860 } });
  const errs = []; pg.on('pageerror', e => errs.push(e.message));
  pg.on('dialog', d => d.accept());
  await pg.route('**/*', r => {
    const u = new URL(r.request().url()), p = u.pathname, q = u.searchParams;
    if (p === '/sim/ano') { sim.ano = q.get('a'); return r.fulfill({ contentType: 'text/plain', body: 'ok' }); }
    if (p.endsWith('/orcamento/index.jsf'))
      return r.fulfill(html(`<form id="menuForm">Ano: <select id="menuForm:anoOrcamentario" onchange="var i=document.getElementById('menuForm:imgStAno');i.style.display='';fetch('/sim/ano?a='+this.value).then(function(){setTimeout(function(){i.style.display='none'},300)})">` +
        sim.anos.map(a => `<option value="${a}"${a === sim.ano ? ' selected' : ''}>${a}</option>`).join('') +
        `</select><img id="menuForm:imgStAno" style="display:none"></form>`));
    if (p.endsWith('/liquidar/form_geral.jsf')) {
      const topo = `<p>Orçamento: ${sim.ano}</p>`;
      if (q.get('pesq')) {
        sim.pesquisas.push(sim.ano);
        return r.fulfill(html(topo + (sim.ano === sim.neAno
          ? '<form id="empenhoForm"><select id="empenhoForm:comboTipoLancamento"><option value="1">Processo</option></select></form>'
          : `<ul class="erros"><li>${ERRO_NE}</li></ul>`)));
      }
      if (q.get('outros'))
        return r.fulfill(html(topo + '<form action="form_geral.jsf"><input type="hidden" name="pesq" value="1">' +
          '<input type="text" id="empenhoForm:txtDocumento" name="ne"><input type="submit" value="Pesquisar"></form>'));
      return r.fulfill(html(topo + '<a href="form_geral.jsf?req=1">Vinculado a Requisição</a> <a href="form_geral.jsf?outros=1">Outros</a>'));
    }
    return r.fulfill(html('x'));
  });
  await pg.goto('https://sipac.ufrn.br/sipac/protocolo/mesa_virtual/lista.jsf');
  await pg.evaluate(extra => {
    localStorage.clear(); localStorage.setItem('sdl-bk-aviso', new Date().toLocaleDateString('pt-BR'));
    localStorage.setItem('sdl2_proc', JSON.stringify({
      '900110-22': { id: '900110-22', num: '900110', dv: '22', st: 'PRONTO', caso: 'SIMPLES', semReq: true, ne: '325', neAno: '2025', neFonte: 'capa+PDF', valor: '100,00', obValor: '100,00', ordem: 1 } }));
    Object.entries(extra).forEach(([k, v]) => localStorage.setItem(k, v));
  }, prep || {});
  await pg.evaluate(SCRIPT); await pg.waitForTimeout(500);
  const log = () => pg.evaluate(() => (JSON.parse(localStorage.getItem('sdl2_log') || '[]')).map(l => typeof l === 'string' ? l : (l.m || l.t || JSON.stringify(l))));
  const reg = () => pg.evaluate(() => JSON.parse(localStorage.getItem('sdl2_proc'))['900110-22']);
  const anoOrc = () => pg.evaluate(() => localStorage.getItem('sdl2_anoOrc'));
  const fim = () => pg.waitForFunction(() => !document.querySelector('#sdl-panel iframe') && !document.querySelector('body > iframe'), null, { timeout: 120000 });
  await acao(pg, { log, fim });
  const r = { log: await log(), reg: await reg(), anoOrc: await anoOrc(), errs };
  console.log('  log:', r.log.filter(l => /ano orçament/i.test(l)).join(' | ') || '(nada sobre ano)');
  console.log('  registro:', r.reg.st, '–', r.reg.motivo || '', '· pesquisas com ano', JSON.stringify(sim.pesquisas), '· ano final da sessão', sim.ano);
  await pg.close();
  return r;
}

(async () => {
  const b = await chromium.launch(); const errs = [];

  console.log('A) NE 2025 com a sessão em 2026: troca, acha o empenho e volta para 2026');
  let sim = { ano: '2026', anos: ['2024', '2025', '2026'], neAno: '2025', pesquisas: [] };
  let r = await cenario(b, sim, null, async (pg, { fim }) => { await pg.click('#b-detalhar'); await fim(); });
  errs.push(...r.errs);
  confere(sim.pesquisas[0] === '2025', 'pesquisou o empenho com o orçamento 2025');
  confere(!/NÃO CADASTRADO/.test(r.reg.motivo || ''), 'não virou "EMPENHO NÃO CADASTRADO"');
  confere(r.log.some(l => /mudado para 2025/.test(l)), 'log avisa a troca para 2025');
  confere(sim.ano === '2026' && r.log.some(l => /voltou para 2026/.test(l)), 'sessão voltou para 2026 no fim da fila');
  confere(r.anoOrc === null, 'sdl2_anoOrc limpo');

  console.log('B) combo sem 2025: pendência sem pesquisar');
  sim = { ano: '2026', anos: ['2026'], neAno: '2025', pesquisas: [] };
  r = await cenario(b, sim, null, async (pg, { fim }) => { await pg.click('#b-detalhar'); await fim(); });
  errs.push(...r.errs);
  confere(r.reg.st === 'PENDENTE' && /não consegui mudar o ano orçamentário do SIPAC para 2025/.test(r.reg.motivo), 'pendência "não consegui mudar o ano"');
  confere(sim.pesquisas.length === 0 && sim.ano === '2026', 'não pesquisou e a sessão ficou em 2026');

  console.log('C) Parar logo depois da troca: volta para 2026');
  sim = { ano: '2026', anos: ['2025', '2026'], neAno: '2025', pesquisas: [] };
  r = await cenario(b, sim, null, async (pg, { log, fim }) => {
    await pg.click('#b-detalhar');
    await pg.waitForFunction(() => /mudado para 2025/.test(localStorage.getItem('sdl2_log') || ''), null, { timeout: 60000 });
    await pg.click('#b-parar'); await fim();
  });
  errs.push(...r.errs);
  confere(sim.ano === '2026' && r.anoOrc === null, 'sessão voltou para 2026 após Parar');

  console.log('D) página recarregada com o ano trocado: aviso no log');
  sim = { ano: '2025', anos: ['2025', '2026'], neAno: '2025', pesquisas: [] };
  r = await cenario(b, sim, { sdl2_anoOrc: JSON.stringify('2025') }, async () => {});
  errs.push(...r.errs);
  confere(r.log.some(l => /pode ter ficado em 2025/.test(l)), 'log avisa o ano 2025 ao abrir');

  console.log('erros', JSON.stringify(errs)); await b.close();
  if (falhas) { console.log(`${falhas} verificação(ões) falharam`); process.exit(1); }
})();
