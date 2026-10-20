// ==UserScript==
// @name         SIPAC – Detalhar Despesas em lote
// @namespace    giuliano.sipac
// @version      0.19.1
// @description  Analisa a página da 07 - PAGOS, detalha os prontos (inclusive ISS com DAR em Tributos), arquiva SIMPLES/ISS por mês e move DARF/INSS para a 08.
// @match        https://sipac.ufrn.br/sipac/*
// @match        http://sipac.ufrn.br/sipac/*
// @require      https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js
// @grant        none
// @updateURL    https://raw.githubusercontent.com/GiulianoXRG/sipac-detalhar-lote/main/sipac-detalhar-lote.user.js
// @downloadURL  https://raw.githubusercontent.com/GiulianoXRG/sipac-detalhar-lote/main/sipac-detalhar-lote.user.js
// @homepageURL  https://github.com/GiulianoXRG/sipac-detalhar-lote
// @run-at       document-end
// ==/UserScript==

(function () {
  'use strict';
  if (window.top !== window) return;

  function iniciarPainel() {
    if (document.getElementById('sdl')) return;
    const VERSAO = '0.19.1';

    // ================= ESTADO =================
    const ST = {
      get(k, d) {
        try {
          const v = localStorage.getItem('sdl2_' + k);
          return v ? JSON.parse(v) : d;
        } catch (e) { return d; }
      },
      set(k, v) {
        const t = Array.prototype.toJSON;
        delete Array.prototype.toJSON;
        try { localStorage.setItem('sdl2_' + k, JSON.stringify(v)); }
        finally { if (t) Array.prototype.toJSON = t; }
      },
      del(k) { localStorage.removeItem('sdl2_' + k); }
    };

    const S = ms => new Promise(r => setTimeout(r, ms));
    const num = s => s == null ? NaN : +String(s).replace(/\./g, '').replace(',', '.');
    const cn = s => String(s || '').replace(/\D/g, '');
    const cl = s => s == null ? s : String(s).replace(/\.$/, '');
    const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    const norm = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '')
      .replace(/\s+/g, ' ').trim().toUpperCase();
    const TOL = 0.0101;
    // O SIPAC usa Prototype.js, que substitui Array.prototype.reduce: somar com laço simples
    const somar = (arr, fn) => { let t = 0; for (const x of arr) t += fn(x); return t; };
    const ANO = '2026';
    const URL_FORM = '/sipac/orcamento/movimentacao/empenho/liquidar/form_geral.jsf';
    const urlPDF = n => '/sipac/gerarPDFProcessoServlet?numeroProcesso=' + n + '&anoProcesso=' + ANO;

    // Registros: um por processo, chave "numero-dv"
    // st: NOVO | PRONTO | GRAVADO | PENDENTE | IGNORADO | ARQUIVADO | MOVIDO
    const todos = () => ST.get('proc', {});
    const rec = id => todos()[id];
    const salvar = (id, patch) => {
      const P = todos();
      const [n, dv] = id.split('-');
      P[id] = Object.assign(P[id] || { id, num: n, dv, ordem: Date.now() }, patch, { atualizado: Date.now() });
      ST.set('proc', P);
      agendarRender();
      return P[id];
    };
    const lista = f => Object.values(todos()).filter(f || (() => true))
      .sort((a, b) => (a.ordem || 0) - (b.ordem || 0));

    const MESN = ['JANEIRO', 'FEVEREIRO', 'MARÇO', 'ABRIL', 'MAIO', 'JUNHO', 'JULHO',
      'AGOSTO', 'SETEMBRO', 'OUTUBRO', 'NOVEMBRO', 'DEZEMBRO'];
    const tipo = r => r && r.caso ? (r.caso === 'SIMPLES' || r.caso === 'ISS' ? 'SIMPLES' : 'DARF') : '';
    // Nome exibido: ISS = só ISS (DAR) → arquivar; ISS+DARF = ISS (DAR) com sobra federal → 08
    const nomeTipo = r => !r || !r.caso ? '' : r.caso === 'ISS' ? 'ISS/DAR' : r.caso === 'ISS+DARF' ? 'ISS/DAR + DARF' :
      tipo(r) === 'SIMPLES' ? 'SIMPLES' : 'DARF/INSS';
    const chaveMes = r => {
      const m = String((r && r.obData) || '').split('/');
      return m[1] ? m[1] + '/' + m[2] : '';
    };
    const nomeMes = ch => {
      const [mm, aa] = String(ch).split('/');
      return mm ? `${mm} - ${MESN[+mm - 1]}/${aa}` : 'mês ?';
    };
    const destino = r => !tipo(r) ? '' :
      tipo(r) === 'SIMPLES' ? 'arquivar em ' + nomeMes(chaveMes(r)) : 'mover para 08 - AGUARD. DARF E GPS';

    const ROT = {
      NOVO: ['Analisando', 'cinza'],
      PRONTO: ['Pronto p/ detalhar', 'azul'],
      GRAVADO: ['Detalhado', 'verde'],
      PENDENTE: ['Pendência', 'verm'],
      IGNORADO: ['Ignorado', 'cinza'],
      ARQUIVADO: ['Arquivado', 'verdee'],
      MOVIDO: ['Na 08', 'larane']
    };
    const corDe = r => r.st === 'GRAVADO' ? (tipo(r) === 'SIMPLES' ? 'verde' : 'laran') : (ROT[r.st] || ['', 'cinza'])[1];
    const rotuloDe = r => r.st === 'GRAVADO'
      ? (tipo(r) === 'SIMPLES' ? nomeTipo(r) + ' · arquivar ' + (chaveMes(r) || '') : nomeTipo(r) + ' · mover p/ 08')
      : r.st === 'PRONTO' ? 'Pronto · ' + nomeTipo(r) +
        (r.partes ? ` · ${r.partes.filter(q => q.feito).length}/${r.partes.length} req` : '')
      : (ROT[r.st] || [r.st])[0];

    // ================= MESA =================
    const naMesa = () => /mesa_virtual\/lista/.test(location.pathname);
    // Tentou detalhar e não terminou: falhou/pulou na preparação ou na gravação, ou só parte das requisições gravada
    const PADRAO_TENTADO = /conferência falhou|comprovante não conferiu|pulado por você|^detalhamento \d+\/\d+|erro em "|interrompido|não abriu|recusou a requisição|botão .* não encontrado|não apareceu em|fixa o valor do detalhamento|parcialmente liquidada|já totalmente liquidada/;
    const naoTerminado = r => (r.st === 'PENDENTE' && (r.tentado || PADRAO_TENTADO.test(r.motivo || ''))) ||
      (r.partes && r.partes.some(q => q.feito) && !r.partes.every(q => q.feito) && r.st !== 'GRAVADO');
    // ---- datas (registros antigos só têm o texto "dd/mm/aaaa, hh:mm:ss") ----
    const tsDeTexto = t => {
      const m = String(t || '').match(/(\d{2})\/(\d{2})\/(\d{4}),?\s*(\d{2}):(\d{2})(?::(\d{2}))?/);
      return m ? new Date(+m[3], +m[2] - 1, +m[1], +m[4], +m[5], +(m[6] || 0)).getTime() : null;
    };
    const tsGravado = r => r.gravadoTs || tsDeTexto(r.gravadoEm);
    const tsDestino = r => r.destinoTs || tsDeTexto(r.destinoEm) || (['ARQUIVADO', 'MOVIDO'].includes(r.st) ? r.atualizado : null);
    const diaTxt = ts => ts ? new Date(ts).toLocaleDateString('pt-BR') : '';
    const brl = v => 'R$ ' + v.toFixed(2).replace('.', ',').replace(/\B(?=(\d{3})+(?!\d))/g, '.');

    // Tempo médio entre gravações seguidas no mesmo dia (ignora pausas > 15 min)
    function tempoMedio(tss) {
      const t = tss.filter(Boolean).sort((a, b) => a - b), gaps = [];
      for (let i = 1; i < t.length; i++) { const g = t[i] - t[i - 1]; if (g > 0 && g < 15 * 60000) gaps.push(g); }
      if (!gaps.length) return '';
      const m = somar(gaps, g => g) / gaps.length / 1000;
      return m >= 60 ? Math.floor(m / 60) + ' min ' + Math.round(m % 60) + ' s' : Math.round(m) + ' s';
    }
    function estatDia(all, dia) {
      const grav = all.filter(r => diaTxt(tsGravado(r)) === dia);
      const arq = all.filter(r => r.st === 'ARQUIVADO' && diaTxt(tsDestino(r)) === dia);
      const mov = all.filter(r => r.st === 'MOVIDO' && diaTxt(tsDestino(r)) === dia);
      const pend = all.filter(r => r.st === 'PENDENTE' && diaTxt(r.ordem) === dia);
      const resol = all.filter(r => r.rev === 'resolvido' && diaTxt(tsDeTexto(r.revEm)) === dia);
      return { grav, arq, mov, pend, resol, valor: somar(grav, r => num(r.valor) || 0), tempo: tempoMedio(grav.map(tsGravado)) };
    }
    function painelProdutividade(all) {
      const dias = [];
      for (let k = 0; k < 7; k++) dias.push(new Date(Date.now() - k * 864e5).toLocaleDateString('pt-BR'));
      const linhas = dias.map(d => ({ d, e: estatDia(all, d) })).filter(x => x.d === dias[0] || x.e.grav.length || x.e.arq.length || x.e.mov.length);
      const cats = {};
      all.filter(r => r.st === 'PENDENTE' || r.rev).forEach(r => { const c = categoria(r); cats[c] = (cats[c] || 0) + 1; });
      const top = Object.keys(cats).sort((a, b) => cats[b] - cats[a]).slice(0, 4);
      const td = 'style="padding:2px 6px;text-align:right"';
      return `<div class="row" style="border-left-color:#1e4f8f;background:#f4f7fb">
        <div class="l1"><b>📊 Produtividade (últimos 7 dias)</b><span style="margin-left:auto"><button class="mini pri" data-a="resumo">📋 Copiar resumo de hoje</button></span></div>
        <table style="width:100%;font-size:12px;border-collapse:collapse;margin-top:4px">
          <tr style="color:#5d6b7a"><td>Dia</td><td ${td}>Detalhados</td><td ${td}>Arquiv.</td><td ${td}>Na 08</td><td ${td}>Pend.</td><td ${td}>Tempo/proc.</td></tr>
          ${linhas.map(({ d, e }) => `<tr style="border-top:1px solid #e6ebf2"><td>${d === dias[0] ? '<b>Hoje</b>' : d.slice(0, 5)}</td><td ${td}>${e.grav.length}</td><td ${td}>${e.arq.length}</td><td ${td}>${e.mov.length}</td><td ${td}>${e.pend.length}</td><td ${td}>${e.tempo || '–'}</td></tr>`).join('')}
        </table>
        ${top.length ? `<div class="l2" style="margin-top:4px">Pendências mais comuns: ${top.map(c => `${esc(c)} (${cats[c]})`).join(' · ')}</div>` : ''}
      </div>`;
    }
    function textoResumoDia(all) {
      const hoje = new Date().toLocaleDateString('pt-BR');
      const e = estatDia(all, hoje);
      const porPasta = {};
      e.arq.forEach(r => { const k = String(r.motivo || '').replace(/^arquivado em\s*/i, '') || 'arquivo'; porPasta[k] = (porPasta[k] || 0) + 1; });
      const abertas = all.filter(r => r.st === 'PENDENTE' && revDe(r) !== 'resolvido');
      const cats = {};
      abertas.forEach(r => { const c = categoria(r); cats[c] = (cats[c] || 0) + 1; });
      const L = [];
      L.push(`*Detalhamento de despesas – ${hoje}* (SEO/CCS)`);
      L.push(`• Detalhados: ${e.grav.length} processo(s) – ${brl(e.valor)}` + (e.tempo ? ` (média ${e.tempo} por processo)` : ''));
      if (e.arq.length) L.push(`• Arquivados: ${e.arq.length} – ` + Object.keys(porPasta).map(k => `${porPasta[k]} em ${k}`).join('; '));
      if (e.mov.length) L.push(`• Movidos para 08 - AGUARD. DARF E GPS: ${e.mov.length}`);
      const aguardando = all.filter(r => r.st === 'GRAVADO').length;
      if (aguardando) L.push(`• Detalhados aguardando arquivar/mover: ${aguardando}`);
      if (e.resol.length) L.push(`• Pendências resolvidas hoje: ${e.resol.length}`);
      L.push(`• Pendências em aberto: ${abertas.length}` + (abertas.length ? ' – ' + Object.keys(cats).sort((a, b) => cats[b] - cats[a]).map(c => `${c}: ${cats[c]}`).join('; ') : ''));
      const esp = abertas.filter(r => revDe(r) === 'esperando');
      if (esp.length) L.push(`• Esperando retorno: ` + esp.map(r => `${r.num}/${ANO}-${r.dv}${r.revNota ? ' (' + r.revNota + ')' : ''}`).join('; '));
      return L.join('\n');
    }

    // ---- empenho não cadastrado / já liquidado: texto padronizado com o nº do empenho ----
    function textoErroEmpenho(ne, neAno, sp, fonte) {
      const ano = neAno || ANO, numNE = `NE ${ne || '?'}/${ano}`;
      if (/totalmente liquidado/i.test(sp))
        return `EMPENHO JÁ LIQUIDADO: ${numNE} já foi totalmente liquidado no SIPAC – conferir se o processo já foi detalhado ou se o empenho está certo – SIPAC: "${sp}"`;
      return `EMPENHO NÃO CADASTRADO: ${numNE} não existe para a gestora no SIPAC (orçamento ${ANO})` +
        (String(ano) !== ANO ? ` – é empenho de ${ano} (exercício anterior / restos a pagar): detalhar à parte ou ver com a chefia`
          : ' – conferir o nº do empenho na capa e na Nota de Empenho') +
        (fonte ? ` [empenho lido: ${fonte}]` : '') + ` – SIPAC: "${sp}"`;
    }

    // ---- caderno de pendências: categoria (pelo motivo) e situação da revisão ----
    const CATS = [
      ['Urgente', /urgente/i],
      ['Pulado por você', /pulado por você/i],
      ['Empenho não cadastrado / já liquidado', /EMPENHO NÃO CADASTRADO|EMPENHO JÁ LIQUIDADO|Empenho não cadastrado para a gestora|empenho já foi totalmente liquidado/i],
      ['NS só em lista do SIAFI', /LISTA do SIAFI/i],
      ['Quantidade de NS / OB / NE / DAR', /\bNS=\d|\bOB=\d|\bNE=\d|DARs no processo|2 OBs|mais de um empenho/i],
      ['ISS / DAR', /\bISS\b|\bDAR\b/i],
      ['Favorecido / CNPJ', /favorecido|CNPJ/i],
      ['Requisição', /requisi/i],
      ['Empenho', /empenho|ORDIN/i],
      ['Comprovante / gravação', /comprovante|gravad/i],
      ['Tela do SIPAC / sessão', /erro em "|não abriu|interrompido|não encontrad|não apareceu|PDF/i],
      ['Valores / NF / retenções', /NF|retenç|diferença|≠|valor/i]
    ];
    const categoria = r => (CATS.find(([, re]) => re.test(r.motivo || '')) || ['Outros'])[0];
    const REV = { aver: 'A ver', vendo: 'Vendo', esperando: 'Esperando alguém', resolvido: 'Resolvido' };
    const revDe = r => r.rev || 'aver';
    const naProcesso = () => /mesa_virtual\/processo/.test(location.pathname);
    // Processo aberto na tela processo.jsf (cabeçalho "PROCESSO 23077.nnnnnn/2026-dv")
    const idProcessoAberto = () => {
      const m = (document.body.innerText || '').match(/PROCESSO\s+23077\.(\d+)\/(\d{4})-(\d+)/);
      return m ? m[1] + '-' + m[3] : null;
    };
    const linksMesa = () => [...document.querySelectorAll('a[id$="verNumProcesso"]')];
    const idDoLink = a => {
      const m = (a.textContent || '').match(/23077\.(\d+)\/(\d{4})-(\d+)/);
      return m ? { id: m[1] + '-' + m[3], num: m[1], dv: m[3], ano: m[2] } : null;
    };
    const linkDe = id => linksMesa().find(a => { const x = idDoLink(a); return x && x.id === id; });
    const idsDaPagina = () => linksMesa().map(idDoLink).filter(Boolean).map(x => x.id);
    const paginaAtual = () => {
      const bt = document.body.innerText || document.body.textContent || '';
      const m = bt.match(/(\d+)\s*-\s*(\d+)\s+de\s+(\d+)\s+Processos/i) ||
        bt.match(/(\d+)\s*-\s*(\d+)\s+de\s+(\d+)/i);
      return m ? `${m[1]}–${m[2]} de ${m[3]}` : '';
    };

    // ================= INTERFACE =================
    const P = document.createElement('div');
    P.id = 'sdl';
    P.innerHTML = `
<style>
#sdl{position:fixed;right:10px;top:56px;bottom:10px;z-index:999999;width:430px;display:flex;flex-direction:column;
  background:#fff;border:1px solid #c9d3e0;border-radius:10px;box-shadow:0 6px 24px #0003;font:13px/1.35 "Segoe UI",Arial,sans-serif;color:#1d2733}
#sdl.grande{width:640px}
#sdl.mini{display:none}
#sdl *{box-sizing:border-box}
#sdl header{background:#1e4f8f;color:#fff;padding:7px 10px;border-radius:10px 10px 0 0;display:flex;align-items:center;gap:6px;user-select:none}
#sdl header b{font-size:14px}#sdl header small{opacity:.75}
#sdl header .sp{flex:1}
#sdl header span.ic{cursor:pointer;padding:2px 6px;font-size:14px;border-radius:5px;line-height:1}
#sdl header span.ic:hover{background:#ffffff2e}
#sdl header span.ic.on{background:#ffffff40}
#sdl .barra{height:4px;background:#e6ebf2;margin:0 10px 4px;border-radius:2px;overflow:hidden;display:none}
#sdl .barra.on{display:block}
#sdl .barra i{display:block;height:100%;width:0;background:#1e4f8f;transition:width .3s}
#sdl .filtros{display:flex;gap:6px;align-items:center;padding:6px 10px 0}
#sdl .filtros input{flex:1;min-width:0;font:inherit;padding:5px 8px;border:1px solid #c9d3e0;border-radius:6px}
#sdl .filtros .chip{font-size:11px;background:#e9eef5;border-radius:9px;padding:2px 8px;cursor:pointer;white-space:nowrap}
#sdl .proc{cursor:copy}
#sdl .exec.acao{background:#e8f5e9;border-bottom-color:#9ccc9f}
#sdl-pill{position:fixed;z-index:999999;display:none;align-items:center;gap:7px;padding:7px 12px;border-radius:20px;
  background:#1e4f8f;color:#fff;font:600 12px/1.2 "Segoe UI",Arial,sans-serif;box-shadow:0 4px 16px #0004;cursor:grab;user-select:none;touch-action:none}
#sdl-pill.on{display:flex}
#sdl-pill.arrastando{cursor:grabbing;opacity:.85}
#sdl-pill.acao{background:#1f8b3a}
#sdl-pill .dot{width:9px;height:9px;border-radius:50%;background:#9fb3cc;flex:none}
#sdl-pill .dot.trab{background:#ffb300;animation:sdlpulso 1s infinite}
#sdl-pill .dot.acao{background:#fff;animation:sdlpulso .7s infinite}
#sdl-pill .n{background:#ffffff2b;border-radius:9px;padding:1px 7px}
@keyframes sdlpulso{50%{opacity:.3}}
#sdl-toast{position:fixed;left:50%;bottom:24px;transform:translateX(-50%);z-index:1000000;background:#1d2733;color:#fff;
  padding:8px 14px;border-radius:8px;font:13px "Segoe UI",Arial,sans-serif;opacity:0;transition:opacity .2s;pointer-events:none}
#sdl-toast.on{opacity:1}
#sdl-body{display:flex;flex-direction:column;flex:1;min-height:0}
#sdl button{font:inherit;cursor:pointer;border-radius:6px;border:1px solid #9fb3cc;background:#f2f6fb;padding:6px 8px}
#sdl button:hover{filter:brightness(.96)}
#sdl button:disabled{opacity:.45;cursor:default}
#sdl button.pri{background:#1e4f8f;color:#fff;border-color:#1e4f8f;font-weight:600}
#sdl button.ok{background:#1f8b3a;color:#fff;border-color:#1f8b3a;font-weight:600}
#sdl button.no{background:#b3261e;color:#fff;border-color:#b3261e}
#sdl button.mini{padding:2px 7px;font-size:12px}
#sdl .sec{padding:8px 10px;border-bottom:1px solid #e6ebf2}
#sdl .acoes{display:grid;grid-template-columns:1fr 1fr;gap:6px}
#sdl .auto.on{background:#e8f5e9;border-radius:6px;padding:3px 6px;color:#1b5e20}
#sdl .varias input{font:inherit;padding:2px 4px;border:1px solid #c9d3e0;border-radius:5px}
#sdl .pag{font-size:12px;color:#55657a;padding:6px 10px 0}
#sdl .exec{background:#fff8e1;border-bottom:1px solid #f0d78c}
#sdl .exec .txt{white-space:pre-line;margin-bottom:6px}
#sdl .exec .bts{display:flex;gap:6px}#sdl .exec .bts button{flex:1}
#sdl .prog{font-size:12px;color:#1e4f8f;padding:4px 10px}
#sdl .cards{display:grid;grid-template-columns:repeat(3,1fr);gap:5px}
#sdl .card{border-radius:7px;padding:5px 7px;cursor:pointer;border:1px solid transparent}
#sdl .card b{display:block;font-size:17px}
#sdl .card span{font-size:11px}
#sdl .card.sel{border-color:#1d2733}
#sdl .dest h4{margin:0 0 5px;font-size:12px;color:#55657a;text-transform:uppercase;letter-spacing:.03em}
#sdl .dest .ln{display:flex;align-items:center;gap:6px;margin:3px 0}
#sdl .dest .ln .t{flex:1}
#sdl .tabs{display:flex;gap:4px;padding:6px 10px 0}
#sdl .tabs button{border-radius:6px 6px 0 0;border-bottom:none;background:#e9eef5;padding:5px 7px;font-size:12px;white-space:nowrap}
#sdl .tabs{flex-wrap:wrap}
#sdl .subchips{display:flex;flex-wrap:wrap;gap:4px;margin:2px 0 6px}
#sdl .subchips span{font-size:11px;border:1px solid #c9d3e0;border-radius:10px;padding:2px 8px;cursor:pointer;background:#fff}
#sdl .subchips span.on{background:#1e4f8f;color:#fff;border-color:#1e4f8f}
#sdl details.grp{margin:4px 0}
#sdl details.grp>summary{cursor:pointer;font-weight:600;font-size:12px;color:#33475b;padding:4px 2px;list-style:none}
#sdl details.grp>summary::before{content:'▸ ';color:#8796a8}
#sdl details.grp[open]>summary::before{content:'▾ '}
#sdl .rev{font:inherit;font-size:11px;padding:1px 3px;border-radius:5px;border:1px solid #9fb3cc;background:#fff}
#sdl .rev.r-vendo{background:#fff8e1;border-color:#e0b400}
#sdl .rev.r-esperando{background:#ede7f6;border-color:#8e6cc8}
#sdl .rev.r-resolvido{background:#e8f5e9;border-color:#5aa469}
#sdl .minha{background:#fffbe6;border:1px dashed #e0c25a;border-radius:5px;padding:2px 6px;margin-top:3px;font-size:12px}
#sdl .rod .bk{font-size:11px;color:#5d6b7a;align-self:center}
#sdl .rod .bk.alerta{color:#b85c00;font-weight:600}
#sdl .tabs button.on{background:#fff;font-weight:600}
#sdl #sdl-lista{flex:1;overflow:auto;border-top:1px solid #c9d3e0;padding:4px 6px}
#sdl .row{border-left:5px solid #ccc;background:#fafbfd;border-radius:6px;margin:4px 0;padding:5px 8px}
#sdl .row .l1{display:flex;gap:6px;align-items:center;flex-wrap:wrap}
#sdl .row .proc{font-weight:700;font-family:Consolas,monospace}
#sdl .row .val{margin-left:auto;color:#333;font-family:Consolas,monospace}
#sdl .row .l2{font-size:12px;color:#44515f;margin-top:2px}
#sdl .row .l3{display:flex;gap:4px;margin-top:4px}
#sdl .badge{font-size:11px;font-weight:700;padding:1px 7px;border-radius:9px;color:#fff}
#sdl .vazio{color:#888;padding:14px;text-align:center}
#sdl details{border-top:1px solid #e6ebf2;padding:4px 10px}
#sdl details summary{cursor:pointer;color:#55657a;font-size:12px}
#sdl #sdl-log{max-height:160px;overflow:auto;white-space:pre-wrap;font:11px Consolas,monospace;background:#f7f7f7;padding:4px;margin-top:4px}
#sdl .rod{display:flex;gap:6px;padding:6px 10px;border-top:1px solid #e6ebf2}#sdl .rod button{flex:1;font-size:12px}
.c-azul{--c:#1565c0}.c-verde{--c:#2e7d32}.c-verdee{--c:#1b5e20}.c-laran{--c:#e67e00}.c-larane{--c:#a35400}.c-verm{--c:#c62828}.c-cinza{--c:#8a96a3}
#sdl .badge[class*=c-]{background:var(--c)}
#sdl .row[class*=c-]{border-left-color:var(--c)}
#sdl .card[class*=c-]{background:color-mix(in srgb,var(--c) 12%,#fff);color:var(--c)}
tr.sdl-tr-azul td{background:#e3eefb!important}tr.sdl-tr-verde td{background:#e3f4e5!important}
tr.sdl-tr-laran td{background:#fff0dc!important}tr.sdl-tr-verm td{background:#fde3e3!important}
tr.sdl-tr-cinza td{opacity:.6}tr.sdl-tr-verdee td,tr.sdl-tr-larane td{opacity:.5}
.sdl-tag[class*=c-]{background:var(--c)}
.sdl-tag{display:inline-block;margin-left:6px;padding:1px 7px;border-radius:9px;font:bold 10px Arial;color:#fff;vertical-align:middle}
.sdl-alvo{outline:4px solid #e53935!important;outline-offset:2px;animation:sdlpisca 1s infinite}
@keyframes sdlpisca{50%{outline-color:#ffb300}}
</style>
<header><b>SIPAC · Detalhar lote</b><small>v0.19.1</small><span class="sp"></span>
  <span class="ic" id="sdl-pin" title="Empurrar a página para o painel não cobrir a Mesa">📌</span>
  <span class="ic" id="sdl-som" title="Aviso sonoro quando um processo estiver pronto para gravar">🔔</span>
  <span class="ic" id="sdl-max" title="Aumentar/diminuir">⛶</span>
  <span class="ic" id="sdl-min" title="Minimizar (Alt+S ou duplo clique no título)">–</span></header>
<div id="sdl-body">
  <div class="pag" id="sdl-pag"></div>
  <div class="sec acoes">
    <button id="b-analisar" class="pri">▶ 1. Analisar esta página</button>
    <button id="b-detalhar" class="pri">▶ 2. Detalhar prontos</button>
    <label class="auto" style="grid-column:1/3;display:flex;gap:6px;align-items:center;font-size:12px;cursor:pointer" title="Quando tudo CONFERE, grava sozinho depois de uma contagem curta. Qualquer divergência vira pendência e o painel segue; problema no comprovante ou no relatório PARA tudo.">
      <input type="checkbox" id="sdl-auto"> 🤖 <b>Detalhamento automático</b>: gravar sozinho quando CONFERE
      <span id="sdl-auto-n" style="margin-left:auto;color:#5d6b7a"></span></label>
    <div class="varias" style="grid-column:1/3;display:flex;gap:5px;align-items:center;font-size:12px;color:#44515f">
      Analisar as páginas <input id="sdl-pde" type="number" min="1" value="1" style="width:46px">
      a <input id="sdl-pate" type="number" min="1" style="width:46px"> da 07
      <button id="b-varias" class="mini" title="Lê os PDFs de várias páginas seguidas (só leitura)">▶ Analisar várias</button>
    </div>
  </div>
  <div class="sec exec" id="sdl-exec" hidden>
    <div class="txt" id="sdl-exec-txt"></div>
    <div class="bts" id="sdl-exec-bts">
      <button id="b-gravar" class="ok">✔ Gravar este</button>
      <button id="b-pular">Pular → pendência</button>
      <button id="b-parar" class="no">■ Parar</button>
    </div>
  </div>
  <div class="prog" id="sdl-prog"></div>
  <div class="barra" id="sdl-barra"><i></i></div>
  <div class="sec"><div class="cards" id="sdl-cards"></div></div>
  <div class="sec dest" id="sdl-dest"></div>
  <div class="tabs" id="sdl-tabs">
    <button data-f="pagina" class="on">Esta página</button>
    <button data-f="prontos">Prontos</button>
    <button data-f="pend" title="Pendências novas, ainda não vistas por você">Pendências</button>
    <button data-f="rev" title="Pendências que você já está vendo ou esperando alguém">Em revisão</button>
    <button data-f="tent" title="Processos que o painel tentou detalhar e não terminou">Não terminados</button>
    <button data-f="mover" title="Detalhados DARF/INSS que precisam ir para 08 - AGUARD. DARF E GPS">Mover → 08</button>
    <button data-f="hist" title="Tudo o que você já passou, por dia">Histórico</button>
    <button data-f="todos">Todos</button>
  </div>
  <div class="filtros"><input id="sdl-busca" placeholder="Buscar nº do processo, motivo, caso…"><span class="chip" id="sdl-chip" hidden></span></div>
  <div id="sdl-lista"></div>
  <details><summary>Log detalhado</summary><div id="sdl-log"></div></details>
  <div class="rod"><button id="b-csv" title="Planilha com todos os processos">CSV</button>
    <button id="b-backup" title="Salvar o backup agora (na pasta escolhida ou, sem pasta, em Downloads)">💾 Salvar backup</button>
    <button id="b-restaurar" title="Carregar um arquivo de backup (junta com o que já está aqui)">⤒ Restaurar</button>
    <button id="b-limpar">Limpar</button><input type="file" id="sdl-arq" accept=".json,application/json" hidden></div>
  <div class="rod" style="border-top:none;padding-top:0"><span class="bk" id="sdl-bk"></span></div>
  <details id="sdl-bkcfg" style="padding:0 10px 8px;font-size:12px"><summary style="cursor:pointer;color:#33475b">Backup: pasta automática e cópias internas</summary>
    <div style="display:flex;flex-wrap:wrap;gap:5px;margin-top:6px;align-items:center">
      <button class="mini" id="b-pasta" title="Escolher a pasta onde o painel salva o backup sozinho">📁 Escolher pasta</button>
      <button class="mini" id="b-baixar" title="Baixar um arquivo de backup agora (pasta Downloads)">⬇ Baixar arquivo</button>
    </div>
    <div style="display:flex;gap:5px;margin-top:6px;align-items:center">
      🕘 Cópias internas: <select id="sdl-snaps" style="flex:1;min-width:0;font:inherit"></select>
      <button class="mini" id="b-snap" title="Voltar o painel para esta cópia (uma cópia de segurança do estado atual é guardada antes)">Restaurar</button>
    </div>
    <div class="l2" style="margin-top:4px;color:#5d6b7a">Com a pasta escolhida, o painel salva sozinho a cada 30 min, ao terminar um destino e ao fechar a página (1 arquivo por dia).
      As cópias internas (últimos 7 dias) ficam neste navegador.</div>
  </details>
</div>`;
    document.body.appendChild(P);
    const $id = i => document.getElementById(i);

    // ---- log ----
    const LOG = m => {
      const lg = ST.get('log', []);
      lg.unshift(new Date().toLocaleTimeString('pt-BR') + ' ' + m);
      ST.set('log', lg.slice(0, 300));
      const el = $id('sdl-log');
      if (el) el.textContent = lg.slice(0, 300).join('\n');
    };
    $id('sdl-log').textContent = ST.get('log', []).join('\n');
    // Estado de trabalho (para a pílula): trab = analisando/detalhando; acao = esperando "Gravar"
    const EST = { trab: false, acao: false, msg: '' };
    const prog = (m, frac) => {
      $id('sdl-prog').textContent = m || '';
      EST.msg = m || '';
      const br = $id('sdl-barra');
      br.classList.toggle('on', frac != null);
      if (frac != null) br.firstElementChild.style.width = Math.round(Math.min(Math.max(frac, 0), 1) * 100) + '%';
      EST.trab = frac != null || !$id('sdl-exec').hidden;
      atualizarPill();
    };

    // ---- toast ----
    const TO = document.createElement('div');
    TO.id = 'sdl-toast';
    document.body.appendChild(TO);
    let toT = null;
    const toast = m => { TO.textContent = m; TO.classList.add('on'); clearTimeout(toT); toT = setTimeout(() => TO.classList.remove('on'), 1800); };

    // ---- preferências da interface (sobrevivem ao recarregar a página) ----
    const UI = (() => {
      const d = { mini: false, grande: false, empurrar: false, som: true, pill: null };
      try {
        const v = JSON.parse(localStorage.getItem('sdl-ui') || 'null');
        if (v) return Object.assign(d, v);
        if (localStorage.getItem('sdl-grande')) d.grande = true; // versões antigas
      } catch (e) {}
      return d;
    })();
    const salvarUI = () => { try { localStorage.setItem('sdl-ui', JSON.stringify(UI)); } catch (e) {} };

    // ---- pílula do painel minimizado (arrastável) ----
    const PL = document.createElement('div');
    PL.id = 'sdl-pill';
    PL.title = 'Clique para abrir o painel · arraste para mover (Alt+S)';
    document.body.appendChild(PL);
    function atualizarPill() {
      if (!PL.classList.contains('on')) return;
      const all = lista();
      const np = all.filter(r => r.st === 'PRONTO').length, nq = all.filter(r => r.st === 'PENDENTE').length;
      const cls = EST.acao ? 'acao' : EST.trab ? 'trab' : '';
      const txt = EST.acao ? '✔ Conferido · clique p/ gravar' : EST.trab ? (EST.msg || 'Trabalhando…').slice(0, 38) : 'Detalhar lote';
      PL.classList.toggle('acao', EST.acao);
      PL.innerHTML = `<span class="dot ${cls}"></span><span>${esc(txt)}</span>` +
        `<span class="n" title="Prontos para detalhar">▶ ${np}</span><span class="n" title="Pendências">⚠ ${nq}</span>`;
    }
    function posicionarPill() {
      if (!PL.classList.contains('on')) return;
      const w = PL.offsetWidth || 220, h = PL.offsetHeight || 32;
      let x = UI.pill ? UI.pill.x : innerWidth - w - 16;
      let y = UI.pill ? UI.pill.y : innerHeight - h - 16;
      x = Math.min(Math.max(x, 4), innerWidth - w - 4);
      y = Math.min(Math.max(y, 4), innerHeight - h - 4);
      PL.style.left = x + 'px'; PL.style.top = y + 'px';
    }
    let arr = null;
    PL.addEventListener('pointerdown', e => {
      arr = { x0: e.clientX, y0: e.clientY, l: PL.offsetLeft, t: PL.offsetTop, mov: false };
      PL.setPointerCapture(e.pointerId);
    });
    PL.addEventListener('pointermove', e => {
      if (!arr) return;
      const dx = e.clientX - arr.x0, dy = e.clientY - arr.y0;
      if (!arr.mov && Math.abs(dx) + Math.abs(dy) < 5) return;
      arr.mov = true; PL.classList.add('arrastando');
      UI.pill = { x: arr.l + dx, y: arr.t + dy };
      posicionarPill();
    });
    PL.addEventListener('pointerup', () => {
      if (!arr) return;
      const mov = arr.mov; arr = null; PL.classList.remove('arrastando');
      if (mov) salvarUI(); else definirMini(false);
    });
    addEventListener('resize', posicionarPill);

    // ---- layout: tamanho, minimizar, empurrar a página ----
    let F = null;
    const mrOrig = document.body.style.marginRight;
    const larguraPainel = () => UI.mini ? 0 : UI.grande ? 640 : 430;
    function aplicarLayout() {
      P.classList.toggle('grande', !!UI.grande);
      P.classList.toggle('mini', !!UI.mini);
      PL.classList.toggle('on', !!UI.mini);
      const lp = larguraPainel();
      if (F) F.style.width = `calc(100% - ${lp ? lp + 25 : 16}px)`;
      document.body.style.marginRight = UI.empurrar && lp ? (lp + 20) + 'px' : mrOrig;
      $id('sdl-pin').classList.toggle('on', !!UI.empurrar);
      $id('sdl-som').textContent = UI.som ? '🔔' : '🔕';
      atualizarPill();
      posicionarPill();
    }
    function definirMini(v) { UI.mini = v; salvarUI(); aplicarLayout(); if (!v) agendarRender(); }
    $id('sdl-max').onclick = e => { e.stopPropagation(); UI.grande = !UI.grande; salvarUI(); aplicarLayout(); };
    $id('sdl-min').onclick = e => { e.stopPropagation(); definirMini(true); };
    $id('sdl-pin').onclick = e => { e.stopPropagation(); UI.empurrar = !UI.empurrar; salvarUI(); aplicarLayout(); };
    $id('sdl-som').onclick = e => {
      e.stopPropagation(); UI.som = !UI.som; salvarUI(); aplicarLayout();
      if (UI.som) {
        bip();
        try { if (window.Notification && Notification.permission === 'default') Notification.requestPermission(); } catch (er) {}
      }
      toast(UI.som ? 'Aviso sonoro ligado' : 'Aviso sonoro desligado');
    };
    P.querySelector('header').addEventListener('dblclick', e => { if (!e.target.closest('.ic')) definirMini(true); });
    document.addEventListener('keydown', e => {
      if (e.altKey && !e.ctrlKey && !e.metaKey && (e.key === 's' || e.key === 'S')) { e.preventDefault(); definirMini(!UI.mini); }
    });

    // ---- aviso quando um processo fica pronto para gravar ----
    const titulo0 = document.title;
    function bip() {
      try {
        const AC = window.AudioContext || window.webkitAudioContext;
        const ac = new AC();
        [[880, 0], [1175, 0.18]].forEach(([f, t]) => {
          const o = ac.createOscillator(), g = ac.createGain();
          o.frequency.value = f; o.connect(g); g.connect(ac.destination);
          g.gain.setValueAtTime(0.0001, ac.currentTime + t);
          g.gain.exponentialRampToValueAtTime(0.25, ac.currentTime + t + 0.02);
          g.gain.exponentialRampToValueAtTime(0.0001, ac.currentTime + t + 0.16);
          o.start(ac.currentTime + t); o.stop(ac.currentTime + t + 0.18);
        });
        setTimeout(() => ac.close(), 800);
      } catch (e) {}
    }
    function avisarPronto(txt) {
      if (UI.mini) definirMini(false);
      document.title = '✔ Gravar? · ' + titulo0;
      if (!UI.som) return;
      bip();
      try {
        if (document.hidden && window.Notification && Notification.permission === 'granted')
          new Notification('SIPAC · pronto para gravar', { body: String(txt).split('\n').slice(0, 2).join('\n'), tag: 'sdl' });
      } catch (e) {}
    }

    // ---- filtro da lista ----
    let filtro = naMesa() ? 'pagina' : 'todos';
    const marcarAba = () => [...$id('sdl-tabs').children].forEach(b => b.classList.toggle('on', b.dataset.f === filtro));
    $id('sdl-tabs').onclick = e => {
      const f = e.target.dataset && e.target.dataset.f;
      if (f) { filtro = f; marcarAba(); render(); }
    };
    marcarAba();
    let busca = '';
    // Pendências = novas (A ver). Em revisão = Vendo / Esperando alguém. Resolvidas vão para o Histórico.
    const ehNova = r => r.st === 'PENDENTE' && revDe(r) === 'aver';
    const emRevisao = r => r.st === 'PENDENTE' && (revDe(r) === 'vendo' || revDe(r) === 'esperando');
    let subRev = 'todas';
    const SUBR = {
      todas: ['Todas', emRevisao],
      vendo: ['Vendo', r => emRevisao(r) && revDe(r) === 'vendo'],
      esperando: ['Esperando alguém', r => emRevisao(r) && revDe(r) === 'esperando']
    };
    const noHist = r => ['GRAVADO', 'ARQUIVADO', 'MOVIDO', 'IGNORADO'].includes(r.st) || revDe(r) === 'resolvido';
    const diaDe = r => { const d = new Date(tsDestino(r) || tsGravado(r) || tsDeTexto(r.revEm) || r.atualizado || r.ordem || 0); return isNaN(d) ? '?' : d.toLocaleDateString('pt-BR'); };
    $id('sdl-busca').addEventListener('input', e => { busca = norm(e.target.value); agendarRender(); });
    $id('sdl-chip').onclick = () => { filtro = 'todos'; marcarAba(); render(); };
    const CARDF = {
      PRONTO: ['Prontos', r => r.st === 'PRONTO'],
      PENDENTE: ['Pendências', r => r.st === 'PENDENTE'],
      GS: ['SIMPLES/ISS a arquivar', r => r.st === 'GRAVADO' && tipo(r) === 'SIMPLES'],
      GD: ['DARF/INSS a mover', r => r.st === 'GRAVADO' && tipo(r) === 'DARF'],
      FEITO: ['Arquivados / na 08', r => r.st === 'ARQUIVADO' || r.st === 'MOVIDO'],
      FORA: ['Detalhados fora da 07', r => r.st === 'GRAVADO' && ST.get('fora07', []).includes(r.id)],
      IGNORADO: ['Ignorados', r => r.st === 'IGNORADO']
    };

    // ---- render ----
    let rTimer = null;
    function agendarRender() { clearTimeout(rTimer); rTimer = setTimeout(render, 80); }

    function linhaHTML(r) {
      const c = corDe(r);
      let det = '';
      if (r.st === 'PENDENTE' || r.st === 'IGNORADO') det = '⚠ ' + esc(r.motivo || 'sem motivo registrado') +
        (naoTerminado(r) ? `<br><span style="color:#8a5a00">⏸ parou em: <b>${esc(r.tentEtapa || 'detalhamento')}</b>${r.tentEm ? ' · ' + esc(r.tentEm) : ''}` +
          (r.partes ? ` · requisições: ${r.partes.map(q => (q.feito ? (q.externo ? '↷' : '✔') : '○') + ' ' + q.req).join(', ')}` : '') + '</span>' : '') +
        (r.notaEm ? `<br>📝 anotação cadastrada em ${esc(r.notaEm)}: “${esc(r.nota)}”` : '');
      else if (r.caso && r.partes) det = `${r.caso} · ${r.partes.length} requisições, um detalhamento cada:<br>` +
        r.partes.map(q => `${q.feito ? (q.externo ? '↷' : '✔') : '○'} req ${q.req}: R$ ${q.valor} · OB R$ ${q.obValor}${q.porNF ? '' : ' (sem NF casada)'}`).join('<br>') +
        (r.ob ? `<br>OB ${r.ob} de ${r.obData} (total R$ ${r.obValor})` : '') +
        (r.st === 'ARQUIVADO' ? ' · ' + esc(r.motivo || 'arquivado') : r.st === 'MOVIDO' ? ' · movido para a 08' : ' → ' + destino(r));
      else if (r.caso) det = `${r.caso}${r.semReq ? ' (sem requisição)' : r.req ? ' · req ' + r.req : ''}` +
        (r.ob ? ` · OB ${r.ob} de ${r.obData} R$ ${r.obValor}` : '') +
        (r.dar ? ` · DAR ${r.dar}/${ANO} de ${r.darData} R$ ${r.darValor}` + (r.sobra && num(r.sobra) > TOL ? ` · sobra R$ ${r.sobra}` : '') : '') +
        (r.st === 'ARQUIVADO' ? ' · ' + esc(r.motivo || 'arquivado') :
          r.st === 'MOVIDO' ? ' · movido para a 08' : ' → ' + destino(r));
      else det = esc(r.motivo || '');
      // nº do empenho sempre visível (quando já foi lido do PDF)
      if (r.ne && !/NE\s*\d+\/\d{4}/.test(det)) det = `<b>Empenho ${esc(r.ne)}/${esc(r.neAno || ANO)}</b> · ` + det;
      if (r.relConf && ['GRAVADO', 'ARQUIVADO', 'MOVIDO'].includes(r.st))
        det += r.relConf === 'ok' ? '<br><span style="color:#1f8b3a">🔎 conferido no Relatório de Detalhamento</span>'
          : `<br><span style="color:#b3261e">⚠ relatório: ${esc(r.relConf)}</span>`;
      const acoes = [
        `<button class="mini" data-a="abrir" data-id="${r.id}" title="Abrir o processo em nova aba">↗ Abrir</button>`,
        `<button class="mini" data-a="pdf" data-id="${r.id}" title="Abrir o PDF completo em nova aba">📄 PDF</button>`
      ];
      if (r.st === 'PENDENTE' || r.st === 'IGNORADO')
        acoes.push(`<button class="mini" data-a="reanalisar" data-id="${r.id}" title="Ler o PDF de novo (depois de corrigir)">↻ Reanalisar</button>`);
      if (r.st === 'PENDENTE')
        acoes.push(`<button class="mini" data-a="ignorar" data-id="${r.id}" title="Tirar das pendências">✕ Ignorar</button>`);
      if (r.st === 'PENDENTE')
        acoes.push(`<button class="mini" data-a="anotar" data-id="${r.id}" title="Cadastrar uma anotação pública no processo (Cadastrar/Visualizar Anotações)">📝 ${r.notaEm ? 'Anotar SIPAC de novo' : 'Anotar SIPAC'}</button>`);
      if (r.st === 'PENDENTE' || r.rev) {
        const rv = revDe(r);
        acoes.push(`<select class="rev r-${rv}" data-rev="${r.id}" title="Situação da sua revisão">` +
          Object.keys(REV).map(k => `<option value="${k}"${k === rv ? ' selected' : ''}>${REV[k]}</option>`).join('') + '</select>');
        acoes.push(`<button class="mini" data-a="minha" data-id="${r.id}" title="Nota só sua (fica no painel e no backup, não vai para o SIPAC)">✎ ${r.revNota ? 'Editar nota' : 'Minha nota'}</button>`);
      }
      return `<div class="row c-${c}">
        <div class="l1"><span class="proc" data-copia="23077.${r.num}/${ANO}-${r.dv}" title="Copiar o número">${r.num}/${ANO}-${r.dv}</span>
          <span class="badge c-${c}">${esc(rotuloDe(r))}${r.st === 'PENDENTE' && r.rev && r.rev !== 'aver' ? ' · ' + REV[r.rev].toLowerCase() : ''}</span>
          <span class="val">${r.valor ? 'R$ ' + r.valor : ''}</span></div>
        <div class="l2">${det}</div>
        ${r.revNota ? `<div class="minha">🗒 ${esc(r.revNota)}${r.revEm ? ' <small style="color:#8796a8">· ' + esc(r.revEm) + '</small>' : ''}</div>` : ''}
        <div class="l3" style="flex-wrap:wrap">${acoes.join('')}</div></div>`;
    }

    function render() {
      const all = lista();
      const cont = st => all.filter(r => r.st === st).length;
      const grS = all.filter(r => r.st === 'GRAVADO' && tipo(r) === 'SIMPLES');
      const grD = all.filter(r => r.st === 'GRAVADO' && tipo(r) === 'DARF');

      const ab = naProcesso() && idProcessoAberto(), rAb = ab && rec(ab);
      if (ab) $id('sdl-pag').innerHTML = `Processo aberto: <b>${ab.replace('-', '/' + ANO + '-')}</b> · ` +
        (rAb ? esc(rotuloDe(rAb)) : 'não analisado') +
        (rAb && rAb.st === 'PENDENTE' ? ` <button class="mini" data-a="anotar" data-id="${ab}">📝 Anotar este processo</button>` : '');
      else $id('sdl-pag').textContent = naMesa()
        ? `Mesa: ${paginaAtual() || 'página ?'} · ${idsDaPagina().length} processos nesta página`
        : 'Fora da Mesa Virtual: abra a 07 - PAGOS para analisar.';

      // cards
      const cards = [
        ['PRONTO', 'Prontos p/ detalhar', 'azul', cont('PRONTO')],
        ['PENDENTE', 'Pendências', 'verm', cont('PENDENTE')],
        ['GS', 'SIMPLES a arquivar', 'verde', grS.length],
        ['GD', 'DARF/INSS a mover', 'laran', grD.length],
        ['FEITO', 'Arquivados / na 08', 'verdee', cont('ARQUIVADO') + cont('MOVIDO')],
        ['IGNORADO', 'Ignorados', 'cinza', cont('IGNORADO')]
      ];
      $id('sdl-cards').innerHTML = cards.map(([k, t, c, n]) =>
        `<div class="card c-${c}${filtro === (k === 'PRONTO' ? 'prontos' : k === 'PENDENTE' ? 'pend' : 'card:' + k) ? ' sel' : ''}" data-k="${k}" title="Mostrar só estes na lista"><b>${n}</b><span>${t}</span></div>`).join('');

      $id('b-detalhar').textContent = `▶ 2. Detalhar prontos (${cont('PRONTO')})`;
      $id('sdl-tabs').querySelector('[data-f="prontos"]').textContent = `Prontos (${cont('PRONTO')})`;
      $id('sdl-tabs').querySelector('[data-f="pend"]').textContent = `Pendências (${all.filter(ehNova).length})`;
      $id('sdl-tabs').querySelector('[data-f="rev"]').textContent = `Em revisão (${all.filter(emRevisao).length})`;
      $id('sdl-tabs').querySelector('[data-f="hist"]').textContent = `Histórico (${all.filter(noHist).length})`;
      $id('sdl-tabs').querySelector('[data-f="tent"]').textContent = `Não terminados (${all.filter(naoTerminado).length})`;
      $id('sdl-tabs').querySelector('[data-f="mover"]').textContent = `Mover → 08 (${grD.length})`;

      // destinos
      const naPag = new Set(naMesa() ? idsDaPagina() : []);
      const meses = {};
      grS.forEach(r => { const k = chaveMes(r) || '?'; (meses[k] = meses[k] || []).push(r); });
      const linhasMes = Object.keys(meses).sort().map(k => {
        const n = meses[k].length, np = meses[k].filter(r => naPag.has(r.id)).length;
        return `<div class="ln"><span class="t">🟩 <b>${nomeMes(k)}</b>: ${n} processo(s) · ${np} nesta página</span>
          <button class="mini ok" data-a="arquivar" data-mes="${k}" ${np ? '' : 'disabled'}>Arquivar ${np}</button></div>`;
      }).join('');
      const npD = grD.filter(r => naPag.has(r.id)).length;
      const linhaD = grD.length ? `<div class="ln"><span class="t">🟧 <b>DARF/INSS</b>: ${grD.length} processo(s) · ${npD} nesta página</span>
          <button class="mini" style="background:#e67e00;color:#fff;border-color:#e67e00" data-a="mover" ${npD ? '' : 'disabled'}>Mover ${npD} → 08</button></div>` : '';
      const qD = ST.get('filaDest', null);
      const nAqui = grS.filter(r => naPag.has(r.id)).length + npD;
      const nTot = grS.length + grD.length;
      const fora = new Set(ST.get('fora07', []).filter(id => (rec(id) || {}).st === 'GRAVADO'));
      const topoD = qD
        ? `<div class="ln" style="background:#fff8e1;border-radius:6px;padding:4px 6px"><span class="t">⏯ <b>${qD.modo === 'todas' ? 'Destinando todos' : 'Destino automático'} em andamento</b> (página ${qD.pagina}${qD.modo === 'todas' ? ' de ' + (totalPaginas() || '?') : ''}, grupo ${Math.min(qD.i + 1, Math.max(qD.grupos.length, 1))}/${Math.max(qD.grupos.length, 1)}, ${qD.feitos.length} feito(s))</span>
            <button class="mini pri" data-a="dest-cont">Continuar</button><button class="mini" data-a="dest-canc">Cancelar</button></div>`
        : (nTot ? `<div class="ln"><span class="t"><b>${nTot}</b> detalhado(s) em todas as páginas: arquivar por mês e mover p/ 08, percorrendo a 07 sozinho</span>
            <button class="mini pri" data-a="dest-todos">▶ Destinar todos (${nTot})</button></div>` : '') +
          (nAqui ? `<div class="ln"><span class="t"><b>${nAqui}</b> só nesta página</span>
            <button class="mini" data-a="dest-tudo">Dar destino nesta página</button></div>` : '');
      const linhaFora = fora.size ? `<div class="ln" style="background:#fdecea;border-radius:6px;padding:4px 6px"><span class="t">⚠ <b>${fora.size}</b> detalhado(s) não estão mais na 07 (destino feito fora do painel?)</span>
            <button class="mini" data-a="fora-ver">Ver</button><button class="mini" data-a="fora-ok">Marcar como já destinados</button></div>` : '';
      $id('sdl-dest').innerHTML = (linhasMes || linhaD || qD || linhaFora)
        ? `<h4>3. Destino dos detalhados</h4>${topoD}${linhaFora}${linhasMes}${linhaD}`
        : '<h4>3. Destino dos detalhados</h4><div style="color:#888;font-size:12px">Nada detalhado aguardando arquivamento ou movimentação.</div>';

      // lista
      let rows;
      if (filtro === 'pagina') {
        const ids = idsDaPagina();
        const P2 = todos();
        rows = ids.map(id => P2[id] || { id, num: id.split('-')[0], dv: id.split('-')[1], st: '_', motivo: 'ainda não analisado' });
      } else if (filtro === 'prontos') rows = all.filter(r => r.st === 'PRONTO'); // na ordem da fila de detalhamento
      else if (filtro === 'pend') rows = all.filter(ehNova);
      else if (filtro === 'rev') rows = all.filter(SUBR[subRev][1]).sort((a, b) => String(b.revEm || '').localeCompare(String(a.revEm || '')));
      else if (filtro === 'hist') rows = all.filter(noHist).sort((a, b) => (b.atualizado || 0) - (a.atualizado || 0));
      else if (filtro === 'mover') {
        const naPagM = new Set(naMesa() ? idsDaPagina() : []);
        // os desta página primeiro (são os que dá para mover agora), depois por página da Mesa
        rows = all.filter(r => r.st === 'GRAVADO' && tipo(r) === 'DARF')
          .sort((a, b) => (naPagM.has(b.id) - naPagM.has(a.id)) || ((+a.pagina || 99) - (+b.pagina || 99)));
      }
      else if (filtro === 'tent') rows = all.filter(naoTerminado).sort((a, b) => String(b.tentEm || '').localeCompare(String(a.tentEm || '')));
      else if (filtro.startsWith('card:') && CARDF[filtro.slice(5)]) rows = all.filter(CARDF[filtro.slice(5)][1]).reverse();
      else rows = all.slice().reverse();
      const chip = $id('sdl-chip');
      chip.hidden = !filtro.startsWith('card:');
      if (!chip.hidden) chip.textContent = (CARDF[filtro.slice(5)] || ['?'])[0] + ' ✕';
      if (busca) rows = rows.filter(r => norm([r.num + '/' + ANO + '-' + r.dv, r.id, r.motivo, r.caso, r.req, r.ob, r.cnpj, r.ne ? 'NE ' + r.ne + '/' + (r.neAno || ANO) + ' empenho ' + r.ne : ''].join(' ')).includes(busca));

      // Pendências: situação da revisão + agrupado por tipo de problema
      let custom = null;
      if (filtro === 'pend' || filtro === 'rev') {
        const chips = filtro === 'rev' ? '<div class="subchips">' + Object.keys(SUBR).map(k =>
          `<span data-sub="${k}" class="${k === subRev ? 'on' : ''}">${SUBR[k][0]} (${all.filter(SUBR[k][1]).length})</span>`).join('') + '</div>'
          : '<div class="l2" style="margin:2px 0 6px">Pendências novas. Ao marcar <b>Vendo</b>, <b>Esperando alguém</b> ou escrever uma nota, ela passa para <b>Em revisão</b>; <b>Resolvido</b> vai para o Histórico.</div>';
        const grupos = {};
        rows.forEach(r => { const c = categoria(r); (grupos[c] = grupos[c] || []).push(r); });
        const ordemC = CATS.map(c => c[0]).concat('Outros');
        const abertos = (() => { try { return JSON.parse(localStorage.getItem('sdl-grp') || '{}'); } catch (e) { return {}; } })();
        custom = chips + (rows.length ? ordemC.filter(c => grupos[c]).map(c =>
          `<details class="grp" data-grp="${esc(c)}"${abertos[c] === false ? '' : ' open'}><summary>${esc(c)} (${grupos[c].length})</summary>` +
          grupos[c].map(linhaHTML).join('') + '</details>').join('')
          : `<div class="vazio">${busca ? 'Nada encontrado para a busca.' : filtro === 'pend' ? 'Nenhuma pendência nova 🎉' : 'Nada em revisão.'}</div>`);
      } else if (filtro === 'hist') {
        const dias = {};
        const prod = painelProdutividade(all);
        rows.forEach(r => { const d = diaDe(r); (dias[d] = dias[d] || []).push(r); });
        const resumo = l => {
          const c = k => l.filter(k).length, p = [];
          const n1 = c(r => r.st === 'ARQUIVADO'), n2 = c(r => r.st === 'MOVIDO'), n3 = c(r => r.st === 'GRAVADO'),
            n4 = c(r => r.st === 'IGNORADO'), n5 = c(r => revDe(r) === 'resolvido' && r.st === 'PENDENTE');
          if (n1) p.push(n1 + ' arquivado(s)'); if (n2) p.push(n2 + ' na 08'); if (n3) p.push(n3 + ' detalhado(s) aguardando destino');
          if (n4) p.push(n4 + ' ignorado(s)'); if (n5) p.push(n5 + ' pendência(s) resolvida(s)');
          return p.join(' · ');
        };
        const ordDia = d => { const [dd, mm, aa] = d.split('/'); return +(aa + mm + dd) || 0; };
        custom = prod + (rows.length ? Object.keys(dias).sort((a, b) => ordDia(b) - ordDia(a)).map((d, i) =>
          `<details class="grp"${i === 0 ? ' open' : ''}><summary>📅 ${d} — ${dias[d].length} processo(s)<br><span style="font-weight:400;color:#5d6b7a">${resumo(dias[d])}</span></summary>` +
          dias[d].map(linhaHTML).join('') + '</details>').join('')
          : `<div class="vazio">${busca ? 'Nada encontrado para a busca.' : 'Nada concluído ainda.'}</div>`);
      }

      let topoMover = '';
      if (filtro === 'mover' && rows.length) {
        const naPagM = new Set(naMesa() ? idsDaPagina() : []);
        const aqui = rows.filter(r => naPagM.has(r.id)).length;
        const pags = [...new Set(rows.filter(r => !naPagM.has(r.id)).map(r => r.pagina || '?'))].sort((a, b) => (+a || 99) - (+b || 99));
        topoMover = `<div class="row" style="background:#fff4e5;border-left-color:#e67e00">
          <div class="l1"><b>${rows.length} detalhado(s) DARF/INSS aguardando a 08</b>
          <button class="mini" style="background:#e67e00;color:#fff;border-color:#e67e00" data-a="mover" ${aqui ? '' : 'disabled'}>Mover ${aqui} desta página → 08</button></div>
          <div class="l2">${aqui ? aqui + ' nesta página da Mesa.' : naMesa() ? 'Nenhum nesta página da Mesa.' : 'Abra a Mesa Virtual (07 - PAGOS).'}` +
          (pags.length ? ` Outros estavam na(s) página(s) ${pags.join(', ')} da 07 (a lista anda depois de mover/arquivar).` : '') + `</div></div>`;
      }
      $id('sdl-lista').innerHTML = custom != null ? custom : topoMover + (rows.length
        ? rows.map(r => r.st === '_'
          ? `<div class="row c-cinza"><div class="l1"><span class="proc" data-copia="23077.${r.num}/${ANO}-${r.dv}" title="Copiar o número">${r.num}/${ANO}-${r.dv}</span><span class="badge c-cinza">não analisado</span></div></div>`
          : linhaHTML(r)).join('')
        : busca ? '<div class="vazio">Nada encontrado para a busca.</div>'
        : `<div class="vazio">${filtro === 'pagina' ? (naMesa() ? 'Nenhum processo na página.' : 'Abra a Mesa Virtual.') : filtro === 'pend' ? 'Nenhuma pendência 🎉' : filtro === 'tent' ? 'Nenhum detalhamento interrompido. 👍' : filtro === 'mover' ? 'Nada a mover para a 08. 👍' : filtro === 'prontos' ? 'Nenhum processo pronto. Use “1. Analisar esta página”.' : 'Nenhum processo analisado ainda.'}</div>`);

      pintarMesa();
      atualizarPill();
      indicadorBackup(all);
    }

    // cards como atalho de filtro
    $id('sdl-cards').onclick = e => {
      const c = e.target.closest('.card');
      if (!c) return;
      const k = c.dataset.k === 'PRONTO' ? 'prontos' : c.dataset.k === 'PENDENTE' ? 'pend' : 'card:' + c.dataset.k;
      filtro = filtro === k ? 'todos' : k;
      marcarAba(); render();
    };

    // Destaca as linhas da Mesa conforme o status
    function pintarMesa() {
      if (!naMesa()) return;
      const P2 = todos();
      for (const a of linksMesa()) {
        const x = idDoLink(a);
        const r = x && P2[x.id];
        const tr = a.closest('tr');
        if (!tr) continue;
        tr.className = tr.className.replace(/\bsdl-tr-\S+/g, '').trim();
        let tag = a.parentElement.querySelector('.sdl-tag');
        if (!r) { if (tag) tag.remove(); continue; }
        const c = corDe(r);
        tr.classList.add('sdl-tr-' + c);
        if (!tag) { tag = document.createElement('span'); a.insertAdjacentElement('afterend', tag); }
        const txt = rotuloDe(r);
        if (tag.textContent !== txt) tag.textContent = txt;
        tag.className = 'sdl-tag c-' + c;
        tag.title = r.st === 'PENDENTE' || r.st === 'IGNORADO' ? (r.motivo || '') : destino(r);
      }
    }

    // A Mesa troca a lista por AJAX: re-renderiza quando a página muda
    let assinatura = '';
    setInterval(() => {
      if (!naMesa()) return;
      const s = idsDaPagina().join(',');
      if (s !== assinatura) { assinatura = s; render(); }
      else pintarMesa();
    }, 2000);

    // ================= TRIAGEM PELO PDF =================
    const pdfjs = window.pdfjsLib;
    if (pdfjs) {
      pdfjs.GlobalWorkerOptions.workerSrc =
        'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
    }

    async function pageText(pdf, i) {
      const pg = await pdf.getPage(i);
      const tc = await pg.getTextContent();
      const rows = {};

      tc.items.forEach(it => {
        const y = Math.round(it.transform[5]);
        (rows[y] = rows[y] || []).push(it);
      });

      return Object.keys(rows)
        .map(Number)
        .sort((a, b) => b - a)
        .map(y => {
          const its = rows[y].sort((a, b) => a.transform[4] - b.transform[4]);
          let s = '';
          let end = null;

          its.forEach(it => {
            const x = it.transform[4];
            if (end !== null && x - end > 1.5) s += ' ';
            s += it.str;
            end = x + it.width;
          });

          return s;
        })
        .join('\n');
    }

    const MES = {
      Jan: '01', Fev: '02', Mar: '03', Abr: '04',
      Mai: '05', Jun: '06', Jul: '07', Ago: '08',
      Set: '09', Out: '10', Nov: '11', Dez: '12'
    };

    const dt = s => {
      const m = String(s || '').match(/(\d{2})([A-Za-z]{3})(\d{2})/);
      return m && MES[m[2]]
        ? m[1] + '/' + MES[m[2]] + '/20' + m[3]
        : null;
    };

    function joinObs(lines) {
      let o = '';
      lines.forEach(l => {
        if (!o) {
          o = l;
          return;
        }
        if (/[A-Za-zÀ-ÿ0-9(\/]$/.test(o) &&
            /^[A-Za-zÀ-ÿ0-9()]/.test(l)) {
          o += l;
        } else {
          o += ' ' + l;
        }
      });
      return o.trim();
    }

    // Texto da capa normalizado (sem acento, maiúsculo, espaços únicos)
    const normCapa = s => String(s || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/\s+/g, ' ')
      .toUpperCase();

    // Lê o(s) empenho(s) citados na capa, aceitando várias grafias:
    //   "EMPENHOS: 211/2026", "EMPENHO Nº 211 / 2026", "NE 211/2026",
    //   "NOTA DE EMPENHO 211/2026", "EMP. 211/2026 E 212/2026", "2026NE000211"
    // Devolve [['211','2026'], ...] sem repetições.
    function empenhosDaCapa(capa) {
      const t = normCapa(capa);
      const achados = new Set();

      // formato SIAFI: 2026NE000211 / 2026 NE 211
      for (const m of t.matchAll(/\b(20\d{2})\s*NE\s*0*(\d{1,6})\b/g))
        achados.add(+m[2] + '/' + m[1]);

      // rótulo + trecho seguinte, cortado no próximo campo (NF, valor, CNPJ…)
      const rot = /(?:NOTAS? DE EMPENHO|EMPENHOS?|\bEMP\b\.?|\bNE\b)/g;
      let m;
      while ((m = rot.exec(t))) {
        let trecho = t.slice(m.index + m[0].length, m.index + m[0].length + 90);
        const corte = trecho.search(
          /N\.?\s*FISC|NOTAS? FISC|\bNFS?E?\b|\bVALOR|\bCNPJ|\bREQUISI|\bPROCESSO|\bOB\b/
        );
        if (corte >= 0) trecho = trecho.slice(0, corte);
        for (const n of trecho.matchAll(/(\d{1,6})\s*\/\s*(20\d{2})/g))
          achados.add(+n[1] + '/' + n[2]);
      }

      return [...achados].map(s => s.split('/').map(String));
    }

    // Trecho curto da capa para diagnóstico no log
    function trechoCapa(capa) {
      const t = normCapa(capa);
      let i = t.search(/OBSERVA/);
      if (i < 0) i = t.search(/VALOR: R\$/);
      return t.slice(Math.max(i, 0), Math.max(i, 0) + 140).trim();
    }

    async function carregarPDF(n) {
      const url =
        '/sipac/gerarPDFProcessoServlet?numeroProcesso=' +
        n + '&anoProcesso=2026';

      for (let tent = 1; tent <= 2; tent++) {
        try {
          const r = await fetch(url, { credentials: 'include' });
          if (!r.ok) throw new Error('HTTP ' + r.status);
          return await pdfjs.getDocument({
            data: await r.arrayBuffer()
          }).promise;
        } catch (e) {
          if (tent === 2) throw e;
          await S(2000);
        }
      }
    }

    async function triar(id) {
      const [n, dv] = id.split('-');
      const pdf = await carregarPDF(n);
      const capa = await pageText(pdf, 1);
      const o = { id, num: n, dv };
      const skip = m => Object.assign(o, { st: 'PULADO', mot: m });

      if (!capa.includes('23077.' + n + '/2026-' + dv))
        return skip('capa não confere');

      o.cnpj = (capa.match(/\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}/) || [])[0];

      const tr = capa.match(/Total de Requisi[çc][õo]es:\s*(\d+)/);
      o.valor = cl((capa.match(/Valor: R\$ ([\d.,]+)/) || [])[1]);

      if (!o.cnpj || !o.valor)
        return skip('CNPJ ou valor não identificado na capa');

      if (!tr || +tr[1] === 0) {
        // SEM REQUISIÇÃO → detalhar pelo "Outros" com o empenho.
        // 1º tenta a capa; se a capa não citar, usa a NE única do PDF (conferida depois).
        o.semReq = true;
        const emps = empenhosDaCapa(capa);
        if (emps.length > 1)
          return skip('sem requisição com mais de um empenho na capa (' +
            emps.map(e => e.join('/')).join(', ') + ')');
        if (emps.length === 1) {
          o.neCapa = emps[0][0];
          o.neAnoCapa = emps[0][1];
        } else {
          o.neCapa = null;
          o.capaTrecho = trechoCapa(capa);
        }
      } else {
        const trechoReq = capa.slice(Math.max(0, capa.search(/Total de Requisi/))).replace(/\s+/g, ' ');
        const reqs = [...trechoReq.matchAll(/(\d+)\/(\d{4}) - R\$ (\d{1,3}(?:\.\d{3})*,\d{2})/g)];

        if (+tr[1] > 1) {
          // VÁRIAS REQUISIÇÕES → um detalhamento por requisição
          if (reqs.length !== +tr[1]) return skip(`capa diz ${tr[1]} requisições, mas li ${reqs.length}`);
          if (reqs.some(r => r[2] !== '2026')) return skip('requisição de outro ano');
          const somaReq = somar(reqs, r => num(r[3]));
          if (Math.abs(somaReq - num(o.valor)) > TOL)
            return skip(`soma das requisições ≠ valor da solicitação (${o.valor})`);
          o.multi = true;
          o.reqs = reqs.map(r => ({ req: r[1], reqAno: r[2], valor: r[3] }));
          o.req = o.reqs.map(r => r.req).join(' + ');
        } else {
        if (!reqs[0]) return skip('requisição não lida na capa');

        o.req = reqs[0][1];
        o.reqAno = reqs[0][2];

        if (o.reqAno !== '2026')
          return skip('requisição de outro ano');

        if (Math.abs(num(reqs[0][3]) - num(o.valor)) > TOL)
          return skip(`valor da req (${reqs[0][3]}) ≠ solicitação (${o.valor})`);
        }
      }

      const pages = [];
      for (let i = 2; i <= pdf.numPages; i++) {
        pages.push(await pageText(pdf, i));
      }

      const nsP = pages.filter(t => /CONNS/.test(t));
      const obP = pages.filter(t => /CONOB/.test(t));
      const darP = pages.filter(t => /CONDAR/.test(t));
      const neP = pages.filter(t =>
        /Nota de Empenho/.test(t) && /\n202\d NE \d+/.test(t)
      );
      const nfP = pages.filter(t =>
        /Reten[çc][ãa]o do ISSQN|DANFSe|Total das Reten[çc][õo]es/i.test(t)
      );

      const uniq = (arr, re) => [
        ...new Set(arr.map(t => (t.match(re) || [])[1]).filter(Boolean))
      ];

      const nsN = uniq(nsP, /NUMERO\s*:\s*(2026NS\d+)/);
      const obN = uniq(obP, /NUMERO\s*:\s*2026OB0*(\d+)/);
      const darN = uniq(darP, /NUMERO\s*:\s*(2026DR\d+)/);
      const neMatch = neP.map(t => t.match(/\n(202\d) NE (\d+)/)).filter(Boolean);
      const neN = [...new Set(neMatch.map(m => m[2]))];

      o.neAno = neMatch[0] ? neMatch[0][1] : '2026';

      // NS anexada como tela de LISTA (CONNS com "NUMERO TIPO DE NS"), sem a NS detalhada
      const nsLista = nsP.filter(t => /NUMERO\s+TIPO DE NS/.test(t));
      if (nsN.length === 0 && nsLista.length) {
        const linhas = nsLista.join('\n').match(/^\s*\d{6}\s+NS\s+\S+/gm) || [];
        const c0l = cn(o.cnpj);
        const doCnpj = linhas.filter(l => cn(l.split(/\s+NS\s+/)[1]) === c0l).length;
        return skip(`NS anexada é só a LISTA do SIAFI (${linhas.length} NS, ${doCnpj} deste CNPJ), ` +
          `sem a NS detalhada (data/observação) – anexar a NS ou fazer manual`);
      }

      if (nsN.length !== 1 || obN.length !== 1 || neN.length !== 1)
        return skip(`NS=${nsN.length} OB=${obN.length} NE=${neN.length}` +
          (o.semReq && !o.neCapa ? ` | empenho não lido na capa: "${o.capaTrecho}"` : ''));

      if (darN.length > 1)
        return skip(`${darN.length} DARs no processo – fazer manualmente`);
      if (darN.length === 1 && o.multi)
        return skip('DAR (ISS) com várias requisições – fazer manualmente');

      const ns = nsP.find(t => t.includes(nsN[0]));
      o.data = dt((ns.match(/DATA EMISSAO\s*:\s*(\S+)/) || [])[1]);

      const nsFav = (ns.match(
        /FAVORECIDO\s*:\s*(\d{8}\/\d{4}-\d{2})/
      ) || [])[1];

      const L = ns.split('\n');
      const i0 = L.findIndex(l => /^OBSERVACAO/.test(l.trim()));
      const ol = [];

      for (let i = i0 + 1; i < L.length; i++) {
        const l = L[i].trim();
        if (/^(CONTINUA|LANCADO POR)/.test(l)) break;
        if (l) ol.push(l);
      }

      o.obs = joinObs(ol);

      const ob = obP.find(t =>
        new RegExp('2026OB0*' + obN[0] + '\\b').test(t)
      );

      o.ob = obN[0];
      o.obData = dt((ob.match(/DATA EMISSAO\s*:\s*(\S+)/) || [])[1]);
      o.obValor = cl((ob.match(/\nVALOR\s*:\s*([\d.,]+)/) || [])[1]);

      const obProc = (ob.match(
        /PROCESSO\s*:\s*23077\.(\d+\/2026-\d+)/
      ) || [])[1];

      const obFav = (ob.match(
        /FAVORECIDO\s*:\s*(\d{8}\/\d{4}-\d{2})/
      ) || [])[1];

      o.ne = String(+neN[0]);
      const ne = neP.find(t => new RegExp(o.neAno + ' NE 0*' + o.ne + '\\b').test(t)) || neP[0];
      o.nat = (ne.match(/\b(3390\d\d|4490\d\d)\b/) || [])[1];

      if (o.semReq) {
        if (o.neCapa) {
          if (o.ne !== String(+o.neCapa) || o.neAno !== o.neAnoCapa)
            return skip(`empenho da capa (${o.neCapa}/${o.neAnoCapa}) ≠ NE do PDF (${o.ne}/${o.neAno})`);
          o.neFonte = 'capa+PDF';
        } else {
          // capa não cita o empenho: vale a NE única do PDF (CNPJ conferido abaixo)
          o.neFonte = 'só PDF';
        }
      }

      const neFav = (ne.slice(ne.indexOf('Favorecido')).match(
        /\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}/
      ) || [])[0];

      const c0 = cn(o.cnpj);
      const bad = [];

      if (!o.data || !o.obData || !o.obValor || !o.nat || !o.obs)
        return skip('faltam dados de data, OB, natureza ou observação');

      if (cn(nsFav) !== c0) bad.push('CNPJ NS');
      if (cn(obFav) !== c0) bad.push('CNPJ OB');
      if (cn(neFav) !== c0) bad.push('CNPJ NE');
      if (obProc !== n + '/2026-' + dv) bad.push('OB cita outro processo');

      if (bad.length) return skip(bad.join('; '));

      // ISS COM DAR: detalhar com a OB + o DAR em Tributos.
      // Sobra (NF − OB − DAR) = 0 → arquivar no mês da OB; sobra > 0 (federais) → 08.
      if (darN.length === 1) {
        const fmt2 = v => v.toFixed(2).replace('.', ',').replace(/\B(?=(\d{3})+(?!\d))/g, '.');
        const dm = darN[0].match(/^2026DR8000(\d+)$/);
        if (!dm) return skip(`DAR ${darN[0]} fora do padrão 2026DR8000nn – fazer manualmente`);
        const dar = darP.find(t => t.includes(darN[0]));
        o.dar = String(+dm[1]);
        o.darData = dt((dar.match(/DATA EMISSAO\s*:\s*(\S+)/) || [])[1]);
        o.darValor = cl((dar.match(/VALOR TOTAL\s*:\s*([\d.,]+)/) || [])[1]);
        const darRec = (dar.match(/RECEITA\s*:\s*([^\n]+)/) || [])[1] || '';
        const darCnpj = (dar.match(/RECOLHEDOR[^:]*:\s*(\d{8}\/\d{4}-\d{2})/) || [])[1];
        const darNF = cn((dar.match(/NUMERO DA NF\/RECIBO\s*:\s*(\S+)/) || [])[1]);
        const darValNF = cl((dar.match(/VALOR NF\s*:\s*([\d.,]+)/) || [])[1]);
        if (!o.darData || !o.darValor) return skip('DAR: data de emissão ou valor total não lidos');
        if (!nfP.length) return skip('tem DAR, mas a NF não está no padrão DANFSe – fazer manualmente');

        const fNF = nfP[0];
        const kIss = fNF.indexOf('BC ISSQN');
        const bIss = kIss < 0 ? '' : fNF.slice(kIss, kIss + 350).split('\n').slice(0, 3).join(' ');
        const issRetido = /Retido/i.test(bIss) && !/N[ãa]o Retido/i.test(bIss);
        const issNF = cl((bIss.match(/Retido[^\n]*?R\$\s*([\d.,]+)/i) || [])[1]);

        // nº da NF citado no DAR tem de aparecer na capa ou no cabeçalho da NFS-e
        const nfNum = String(+darNF || '');
        const zonas = [];
        const kc = normCapa(capa).search(/FISCA/);
        if (kc >= 0) zonas.push(normCapa(capa).slice(kc, kc + 80));
        const kn = fNF.search(/N[úu]mero da NFS/i);
        if (kn >= 0) zonas.push(fNF.slice(kn, kn + 120));
        const nfConfere = +darNF > 0 && zonas.join(' ').match(/\d{3,}/g) &&
          zonas.join(' ').match(/\d{3,}/g).some(d => String(+d).endsWith(nfNum));

        const bd = [];
        if (!/ISS/i.test(darRec)) bd.push(`receita do DAR não é ISS (${darRec.trim()})`);
        if (cn(darCnpj) !== c0) bd.push('CNPJ do DAR ≠ interessado');
        if (darValNF && Math.abs(num(darValNF) - num(o.valor)) > TOL) bd.push(`valor da NF no DAR (${darValNF}) ≠ ${o.valor}`);
        if (!nfConfere) bd.push(`nº da NF no DAR (${darNF || '?'}) não confere com a NF do processo`);
        if (!issRetido) bd.push('há DAR, mas a NF não diz ISS retido');
        else if (!issNF) bd.push('ISSQN apurado não lido na NF');
        else if (Math.abs(num(issNF) - num(o.darValor)) > TOL) bd.push(`ISSQN da NF (${issNF}) ≠ DAR (${o.darValor})`);
        if (bd.length) return skip('DAR: ' + bd.join('; '));

        const sobra = Math.round((num(o.valor) - num(o.obValor) - num(o.darValor)) * 100) / 100;
        if (sobra < -TOL) return skip(`NF − OB − DAR negativo (${fmt2(sobra)})`);
        o.sobra = fmt2(Math.abs(sobra) <= TOL ? 0 : sobra);
        o.caso = Math.abs(sobra) <= TOL ? 'ISS' : 'ISS+DARF';
        o.st = 'OK';
        return o;
      }

      if (o.multi) {
        const fmt = v => v.toFixed(2).replace('.', ',').replace(/\B(?=(\d{3})+(?!\d))/g, '.');
        const totOB = num(o.obValor);
        const diffM = Math.round((num(o.valor) - totOB) * 100) / 100;
        const vals = t => [...String(t).matchAll(/(\d{1,3}(?:\.\d{3})*,\d{2})/g)].map(m => m[1]);
        // Cada DANFSe: valor bruto (BC ISSQN), ISS retido?, retenções e líquido
        const nfs = [];
        nfP.forEach(f => {
          const lin = rot => { const k = f.indexOf(rot); return k < 0 ? '' : f.slice(k, k + 400).split('\n').slice(1, 3).join(' '); };
          const iss = lin('BC ISSQN');
          const rt = vals(lin('Total das Reten'));
          const nf = { bruto: vals(iss)[0], retido: /Retido/i.test(iss) && !/N[ãa]o Retido/i.test(iss), ret: rt[0], liq: rt[1] };
          if (nf.bruto && !nfs.some(x => x.bruto === nf.bruto && x.liq === nf.liq)) nfs.push(nf);
        });
        const usados = new Set();
        let casou = true;
        const partes = o.reqs.map(r => {
          const i = nfs.findIndex((x, k) => !usados.has(k) && Math.abs(num(x.bruto) - num(r.valor)) <= TOL);
          if (i < 0) { casou = false; return Object.assign({}, r); }
          usados.add(i);
          return Object.assign({}, r, { nf: nfs[i] });
        });
        if (casou) {
          if (partes.some(p => p.nf.retido)) return skip('ISS retido sem DAR (várias requisições)');
          if (partes.some(p => !p.nf.liq)) return skip('não consegui ler o líquido de alguma NF');
          partes.forEach(p => { p.obValor = p.nf.liq; });
          const soma = somar(partes, p => num(p.obValor));
          if (Math.abs(soma - totOB) > TOL)
            return skip(`soma dos líquidos das NFs (${fmt(soma)}) ≠ OB (${o.obValor})`);
        } else {
          if (Math.abs(diffM) > TOL)
            return skip(`NFs não casam com as requisições e há retenção de ${fmt(diffM)} – não dá para dividir a OB`);
          partes.forEach(p => { p.obValor = p.valor; });
        }
        o.partes = partes.map(p => ({ req: p.req, reqAno: p.reqAno, valor: p.valor, obValor: p.obValor, porNF: !!p.nf, feito: false }));
        o.caso = Math.abs(diffM) <= TOL ? 'SIMPLES' : 'DARF';
        o.st = 'OK';
        return o;
      }

      const diff = Math.round((num(o.valor) - num(o.obValor)) * 100) / 100;

      if (Math.abs(diff) <= TOL) {
        o.caso = 'SIMPLES';
        o.st = 'OK';
        return o;
      }

      if (!nfP.length)
        return skip('NF fora do padrão DANFSe – diferença ' + diff);

      const f = nfP[0];
      const bIss = f.includes('BC ISSQN')
        ? f.slice(f.indexOf('BC ISSQN'), f.indexOf('BC ISSQN') + 350)
            .split('\n').slice(0, 3).join(' ')
        : '';

      if (/Retido/i.test(bIss) && !/N[ãa]o Retido/i.test(bIss))
        return skip('ISS retido sem DAR');

      const extrairNums = rotulo => {
        const idx = f.indexOf(rotulo);
        if (idx < 0) return [];
        const trecho = f.slice(idx, idx + 400).split('\n').slice(1, 4).join(' ');
        return [
          ...trecho.matchAll(/(?:R\$\s*)?(\d{1,3}(?:\.\d{3})*,\d{2})|(?:^|\s)-(?=\s|$)/g)
        ].map(m => m[1] || '0,00');
      };

      const rets = extrairNums('Total das Retenções');
      const retFed = rets[0];
      const irrfLinha = extrairNums('IRRF');
      const cp = irrfLinha[1];

      if (retFed && Math.abs(diff - num(retFed)) <= TOL) {
        o.caso = num(cp) > 0 ? 'INSS' : 'DARF';
        o.st = 'OK';
        return o;
      }

      if (retFed && Math.abs(diff - num(retFed) - num(cp || 0)) <= TOL) {
        o.caso = 'INSS';
        o.st = 'OK';
        return o;
      }

      const todosValoresNF = [
        ...f.matchAll(/(\d{1,3}(?:\.\d{3})*,\d{2})/g)
      ].map(m => num(m[1]));

      if (todosValoresNF.some(v => Math.abs(v - diff) <= TOL)) {
        o.caso = num(cp) > 0 && Math.abs(num(cp) - diff) <= TOL
          ? 'INSS'
          : 'DARF';
        o.st = 'OK';
        return o;
      }

      return skip(`diferença ${diff} não explicada (retenções ${retFed || 'não lida'})`);
    }

    // ================= 1. ANALISAR ESTA PÁGINA =================
    let ocupado = false;

    // Lê um campo do tooltip/linha da Mesa ("Assunto Detalhado:", "Urgente:")
    const lerCampo = (tr, rotulo) => {
      const alvo = norm(rotulo);
      for (const th of tr.querySelectorAll('th'))
        if (norm(th.innerText || th.textContent).startsWith(alvo) && th.nextElementSibling)
          return th.nextElementSibling.innerText || th.nextElementSibling.textContent || '';
      for (const el of tr.querySelectorAll('[title],[aria-label],[data-original-title]')) {
        const v = ['title', 'aria-label', 'data-original-title'].map(k => el.getAttribute(k)).find(v => norm(v).startsWith(alvo));
        if (v) return v;
      }
      for (const el of tr.querySelectorAll('*')) {
        if (el.children.length) continue;
        if (!norm(el.innerText || el.textContent).startsWith(alvo)) continue;
        const pai = el.parentElement;
        if (!pai) continue;
        const tp = pai.innerText || pai.textContent || '';
        if (norm(tp) !== alvo) return tp;
        if (pai.nextElementSibling) return pai.nextElementSibling.innerText || pai.nextElementSibling.textContent || '';
      }
      return '';
    };

    async function triarUm(id) {
      prog(`Lendo o PDF de ${id}…`);
      let o;
      try { o = await triar(id); }
      catch (e) { o = { st: 'PULADO', mot: 'erro ao ler o PDF: ' + String(e).slice(0, 80) }; }
      const base = Object.assign({}, o);
      delete base.st; delete base.mot;
      const ant = rec(id);
      if (o.st === 'OK' && base.partes && ant && ant.partes) {
        base.partes.forEach(p => { const q = ant.partes.find(a => a.req === p.req && a.feito); if (q) { p.feito = true; if (q.externo) p.externo = true; } });
      }
      if (o.st === 'OK') {
        salvar(id, Object.assign(base, { st: 'PRONTO', motivo: '' }));
        LOG(`✔ ${id} ${o.caso}${o.dar ? ' [DAR ' + o.dar + ' R$ ' + o.darValor + ', sobra ' + o.sobra + ']' : ''}${o.semReq ? ' [sem req., NE ' + o.ne + ' – ' + o.neFonte + ']' : ''} R$ ${o.valor} OB ${o.ob} → ${destino(o)}`);
      } else {
        salvar(id, Object.assign(base, { st: 'PENDENTE', motivo: o.mot }));
        LOG(`⚠ ${id}: ${o.mot}`);
      }
    }

    $id('b-analisar').onclick = () => analisarPagina();
    async function analisarPagina() {
      if (!variasRodando) pararAnalise = false;
      if (!naMesa()) return alert('Abra a Mesa Virtual na pasta 07 - PAGOS.');
      if (ocupado) return;
      if (!pdfjs) return alert('pdf.js não carregou. Recarregue a página.');
      const links = linksMesa();
      if (!links.length) return alert('Não encontrei processos na página. Espere a Mesa carregar.');

      ocupado = true;
      const pag = paginaAtual();
      const fila = [];
      const c = { novos: 0, ja: 0, urg: 0, mult: 0, ano: 0, nl: 0 };
      const P2 = todos();

      links.forEach(a => {
        const x = idDoLink(a);
        if (!x) return;
        const r = P2[x.id];
        const velho = r && r.st === 'PENDENTE' &&
          /requisições – detalhar manualmente|tem DAR \(ISS\) – fazer manualmente|detalhamento \d+\/\d+ \(req \d+\): conferência falhou: já liquidado|campo ausente: txtValor|contentDocument|interrompido|formulário não abriu|já liquidado = 0/.test(r.motivo || '') &&
          !/já gravado/.test(r.motivo || '') ||
          // v0.16: corrigidos a trava das OBs (várias requisições) e o nome do favorecido com " - ME"
          r && r.st === 'PENDENTE' && /conferência falhou: (OBs do processo|favorecido)/.test(r.motivo || '');
        if (velho) { c.rev = (c.rev || 0) + 1; salvar(x.id, { st: 'NOVO', motivo: '' }); fila.push(x.id); return; }
        if (r && r.st !== 'NOVO') { c.ja++; return; }
        const base = { num: x.num, dv: x.dv, pagina: pag };
        if (x.ano !== ANO) { c.ano++; salvar(x.id, Object.assign(base, { st: 'IGNORADO', motivo: 'processo de outro ano' })); return; }
        const tr = a.closest('tr');
        const assunto = norm(tr ? lerCampo(tr, 'Assunto Detalhado:') : '');
        const urg = norm(tr ? lerCampo(tr, 'Urgente:') : '');
        if (!urg) { c.nl++; salvar(x.id, Object.assign(base, { st: 'PENDENTE', motivo: 'não consegui ler "Urgente" na Mesa' })); return; }
        if (urg !== 'NAO') { c.urg++; salvar(x.id, Object.assign(base, { st: 'IGNORADO', motivo: 'processo URGENTE' })); return; }
        const rq = assunto.match(/TOTAL\s+DE\s+REQUISICOES\s*:\s*(\d+)/);
        if (rq && +rq[1] > 1) c.mult++;
        if (!rq && !/SOLICITACAO DE PAGAMENTO/.test(assunto)) { c.nl++; salvar(x.id, Object.assign(base, { st: 'PENDENTE', motivo: 'assunto da Mesa fora do padrão – verificar' })); return; }
        salvar(x.id, Object.assign(base, { st: 'NOVO', motivo: '' }));
        fila.push(x.id);
        c.novos++;
      });

      LOG(`Página ${pag}: ${fila.length} para ler o PDF (${c.rev || 0} pendências antigas reprocessadas) · já analisados ${c.ja} · urgentes ${c.urg} · com 2+ requisições ${c.mult} (vão para o PDF) · outro ano ${c.ano} · não lidos ${c.nl}`);
      try {
        for (let i = 0; i < fila.length; i++) {
          if (pararAnalise) break;
          prog(`${variasRodando ? 'Página ' + (numPagina() || '?') + ' · ' : ''}Analisando ${i + 1}/${fila.length}…`, i / fila.length);
          await triarUm(fila[i]);
        }
      } finally {
        ocupado = false;
        const P3 = todos();
        const res = fila.map(id => P3[id]);
        prog(fila.length
          ? `Página analisada: ${res.filter(r => r.st === 'PRONTO').length} pronto(s), ${res.filter(r => r.st === 'PENDENTE').length} pendência(s).`
          : 'Nada novo nesta página.');
        render();
      }
    }

    // ================= 2. DETALHAR NO IFRAME =================
    let atual = null, parar = false;
    const tentativas = {};
    const D = () => F.contentDocument;
    const W = () => F.contentWindow;
    const T = () => D().body.innerText;
    const fx = s => D().querySelector('[id$=":' + s + '"]');
    const ev = (e, t) => e.dispatchEvent(new (W().Event)(t, { bubbles: true }));
    const key = e => ['keydown', 'keypress', 'keyup'].forEach(k =>
      e.dispatchEvent(new (W().KeyboardEvent)(k, { bubbles: true, key: '0' })));
    const nav = act => new Promise(r => {
      let ok = 0;
      F.onload = () => { ok = 1; r(1); };
      act();
      setTimeout(() => { if (!ok) r(0); }, 15000);
    });
    const until = async (fn, ms = 10000) => {
      for (let i = 0; i < ms / 300; i++) {
        try { if (fn()) return true; } catch (e) {}
        await S(300);
      }
      return false;
    };
    const g = re => (T().match(re) || [])[1];

    function abrirIframe() {
      if (F) return;
      F = document.createElement('iframe');
      const lp = larguraPainel();
      F.style.cssText = 'position:fixed;left:8px;top:56px;width:calc(100% - ' +
        (lp ? lp + 25 : 16) + 'px);height:calc(100% - 66px);' +
        'z-index:99998;background:#fff;border:3px solid #1e4f8f;border-radius:8px';
      document.body.appendChild(F);
    }
    function fecharIframe() { if (F) { F.remove(); F = null; } }

    // ================= DETALHAMENTO AUTOMÁTICO =================
    // Liga só nesta página (começa desligado ao recarregar). Grava quando CONFERE após uma contagem;
    // divergência → pendência e segue; comprovante/relatório que não bate ou sessão expirada → PARA.
    const AUTO = { on: false, timer: null, feitos: 0, ini: 0 };
    const AUTO_SEG = 4;
    function pararAuto(motivo) {
      if (AUTO.timer) { clearInterval(AUTO.timer); AUTO.timer = null; }
      if (!AUTO.on) return;
      AUTO.on = false;
      $id('sdl-auto').checked = false;
      $id('sdl-auto').closest('label').classList.remove('on');
      if (motivo) { LOG('🤖 Detalhamento automático desligado: ' + motivo); toast('🤖 Automático desligado: ' + motivo); }
      $id('sdl-auto-n').textContent = AUTO.feitos ? AUTO.feitos + ' gravado(s) no automático' : '';
    }
    $id('sdl-auto').onchange = e => {
      if (!e.target.checked) return pararAuto('desligado por você');
      const n = lista(r => r.st === 'PRONTO').length;
      if (!confirm(`Ligar o detalhamento automático?\n\n• Cada processo que der CONFERE é gravado sozinho após ${AUTO_SEG} s (dá para pausar).\n` +
        `• Divergência vira pendência e o painel segue para o próximo.\n• Comprovante ou Relatório que não bate, ou sessão expirada: PARA tudo.\n` +
        `• Vale só enquanto esta página estiver aberta.\n\n${n} processo(s) pronto(s) agora.`)) { e.target.checked = false; return; }
      AUTO.on = true; AUTO.feitos = 0; AUTO.ini = Date.now();
      e.target.closest('label').classList.add('on');
      LOG(`🤖 Detalhamento automático ligado (${n} pronto(s)).`);
      if (atual && !$id('b-gravar').disabled) agendarAuto();
      else if (!atual && n && !ocupado) { parar = false; preparar(); }
    };
    function agendarAuto() {
      if (!AUTO.on || !atual) return;
      if (AUTO.timer) clearInterval(AUTO.timer);
      let falta = AUTO_SEG;
      const base = $id('sdl-exec-txt').textContent.replace(/\n🤖.*$/s, '');
      const mostrar = () => { $id('sdl-exec-txt').textContent = base + `\n🤖 Gravando sozinho em ${falta} s… (Pular ou Parar cancelam)`; };
      mostrar();
      const alvo = atual;
      AUTO.timer = setInterval(() => {
        falta--;
        if (!AUTO.on || atual !== alvo || $id('b-gravar').disabled) { clearInterval(AUTO.timer); AUTO.timer = null; return; }
        if (falta > 0) return mostrar();
        clearInterval(AUTO.timer); AUTO.timer = null;
        gravarAtual(true);
      }, 1000);
    }
    // Sessão do SIPAC caiu (tela de login no iframe)?
    const sessaoCaiu = () => { try { return /sso-server|autenticacao\.ufrn/.test(W().location.href) || /AUTENTICAÇÃO INTEGRADA/i.test(T()); } catch (e) { return false; } };

    const execBox = (txt, comBotoes) => {
      $id('sdl-exec').hidden = !txt;
      $id('sdl-exec-txt').textContent = txt || '';
      $id('b-gravar').disabled = !comBotoes;
      $id('sdl-exec').classList.toggle('acao', !!comBotoes);
      const eraAcao = EST.acao;
      EST.acao = !!comBotoes;
      EST.trab = !!txt;
      if (EST.acao && !eraAcao && !AUTO.on) avisarPronto(txt);
      if (comBotoes && AUTO.on) setTimeout(agendarAuto, 50);
      if (!EST.acao && document.title !== titulo0) document.title = titulo0;
      atualizarPill();
    };

    async function preparar() {
      atual = lista(r => r.st === 'PRONTO')[0] || null;
      if (!atual || parar) {
        LOG(parar ? 'Detalhamento parado.' : 'Todos os prontos foram detalhados.');
        if (AUTO.on) {
          const min = Math.max(1, Math.round((Date.now() - AUTO.ini) / 60000));
          pararAuto(`fila concluída: ${AUTO.feitos} gravado(s) em ${min} min`);
          if (UI.som) bip();
        }
        prog(parar ? 'Parado.' : 'Fila de prontos concluída.');
        fecharIframe(); execBox(''); atual = null; parar = false;
        render();
        return;
      }
      let x = atual;
      let jaLiqEsperado = 0, rotParte = '';
      if (atual.multi && atual.partes) {
        const i = atual.partes.findIndex(p => !p.feito);
        if (i < 0) { salvar(atual.id, { st: 'GRAVADO', motivo: '' }); return preparar(); }
        const p = atual.partes[i];
        jaLiqEsperado = somar(atual.partes.filter(q => q.feito), q => num(q.valor));
        rotParte = `detalhamento ${i + 1}/${atual.partes.length} (req ${p.req})`;
        x = Object.assign({}, atual, { req: p.req, reqAno: p.reqAno, valor: p.valor, obValor: p.obValor, parteIdx: i, rotParte });
        atual = x;
      }
      const reqAno = x.reqAno || ANO;
      const neAno = x.neAno || ANO;
      abrirIframe();
      execBox(`Preparando ${x.num}/${ANO}-${x.dv}${rotParte ? ' · ' + rotParte : ''}…`, false);

      // Mensagem de erro que o próprio SIPAC mostrou na tela (se houver)
      const msgSipac = () => {
        try {
          const m = [...D().querySelectorAll('.erros li, ul.erros, .rich-messages li, .info li, .alerta')]
            .map(e => e.textContent.replace(/\s+/g, ' ').trim()).filter(Boolean);
          return [...new Set(m)].join(' | ').slice(0, 200);
        } catch (e) { return ''; }
      };
      // Requisição desta parte já está 100% liquidada no SIPAC (detalhada antes, à mão ou por outra rodada):
      // marca a parte como feita e segue para o PRÓXIMO detalhamento do mesmo processo.
      const parteJaLiquidada = onde => {
        if (x.parteIdx == null) {
          LOG(`⚠ ${x.id}: requisição ${x.req} já totalmente liquidada no SIPAC (${onde}) – já detalhado?`);
          salvar(x.id, { st: 'PENDENTE', motivo: `requisição ${x.req} já totalmente liquidada no SIPAC – parece já detalhado; confira no Relatório de Detalhamento e mande para o destino` });
          return preparar();
        }
        const partes = rec(x.id).partes.map((q, k) => k === x.parteIdx ? Object.assign({}, q, { feito: true, externo: true }) : q);
        const tudo = partes.every(q => q.feito);
        salvar(x.id, Object.assign({ partes }, tudo
          ? { st: 'GRAVADO', motivo: 'todas as requisições já estavam liquidadas no SIPAC – confira as OBs no Relatório de Detalhamento', gravadoEm: new Date().toLocaleString('pt-BR') }
          : {}));
        LOG(`↷ ${x.id} ${rotParte}: requisição já liquidada no SIPAC (${onde}) – marcada como feita` +
          (tudo ? ` · todas feitas → ${destino(x)}` : ' · indo para o próximo detalhamento'));
        return preparar();
      };
      // Mensagens do SIPAC sobre o EMPENHO (depois de "Pesquisar")
      const msgEmpenho = () => { const sp = msgSipac(); return /empenho/i.test(sp) && /não cadastrado|não existe|totalmente liquidado/i.test(sp) ? sp : ''; };
      const pulaEmpenho = sp => pula(textoErroEmpenho(x.ne, neAno, sp, x.neFonte));
      const pula = m0 => {
        if (!F || parar) { LOG(`${x.id}: interrompido (Parar)`); return preparar(); }
        if (sessaoCaiu()) {
          parar = true; pararAuto('a sessão do SIPAC expirou');
          LOG(`⚠ Sessão do SIPAC expirou durante ${x.id} – nada foi marcado como pendência. Entre de novo e clique em "2. Detalhar prontos".`);
          execBox('⚠ A sessão do SIPAC expirou. Entre de novo no SIPAC e clique em "2. Detalhar prontos" para continuar de onde parou.', false);
          atual = null;
          return;
        }
        const sip = msgSipac();
        const m = m0 + (sip && !m0.includes(sip) ? ` – SIPAC: "${sip}"` : '');
        // falha passageira (tela não abriu) sem mensagem do SIPAC: tenta mais uma vez
        const chave = x.id + '#' + (x.parteIdx == null ? '' : x.parteIdx);
        if (!sip && /não abriu|não encontrad/.test(m0) && !tentativas[chave]) {
          tentativas[chave] = 1;
          LOG(`${x.id}: ${m0} – tentando de novo`);
          return preparar();
        }
        const feitos = x.partes ? x.partes.filter(q => q.feito).length : 0;
        const mot = (rotParte ? rotParte + ': ' : '') + m + (feitos ? ` – ATENÇÃO: ${feitos} detalhamento(s) já gravado(s)` : '');
        LOG(`⚠ ${x.id}: ${mot}`);
        salvar(x.id, { st: 'PENDENTE', motivo: mot, tentado: true, tentEtapa: etapa, tentEm: new Date().toLocaleString('pt-BR') });
        return preparar();
      };

      let etapa = 'abrir formulário';
      const campo = k => {
        const e = fx(k);
        if (!e) throw new Error('campo ausente: ' + k);
        return e;
      };

      try {
        await nav(() => { F.src = URL_FORM; });

        etapa = x.semReq ? 'tela Outros / empenho' : 'consulta da requisição';
        if (x.semReq) {
          const lkO = [...D().querySelectorAll('a')].find(a => /^\s*Outros/.test(a.textContent));
          if (!lkO) return pula('link "Outros" não encontrado');
          await nav(() => lkO.click());
          await S(800);
          const vis = el => el && el.offsetParent !== null;
          const txts = () => [...D().querySelectorAll('input[type=text]')].filter(vis);
          if (!await until(() => txts().length > 0)) return pula('tela do empenho (Outros) não abriu');
          const campos = txts();
          const ids = campos.map(e => e.id || e.name).join(', ');
          const cNum = campos.find(e => /documento|empenho|numero/i.test(e.id) && !/ano/i.test(e.id)) || campos[0];
          const cAno = campos.find(e => e !== cNum && /ano/i.test(e.id));
          cNum.value = x.ne; key(cNum);
          if (cAno) { cAno.value = neAno; key(cAno); }
          const btn = [...D().querySelectorAll('input[type=submit],input[type=button],button')].filter(vis)
            .find(b => /Pesquisar|Consultar|Buscar|Continuar|Pr[óo]ximo/i.test(b.value || b.textContent));
          if (!btn) return pula('botão de pesquisa do empenho não encontrado | campos: ' + ids);
          await nav(() => btn.click());
          if (!await until(() => fx('comboTipoLancamento') || msgEmpenho(), 12000))
            return pula('formulário não abriu após o empenho | campos: ' + ids);
          if (!fx('comboTipoLancamento') && msgEmpenho()) return pulaEmpenho(msgEmpenho());
        } else {
          const lk = [...D().querySelectorAll('a')].find(a => /Vinculado a Requisi/.test(a.textContent));
          if (lk) await nav(() => lk.click());
          if (!await until(() => D().getElementById('empenhoForm:tipo'))) return pula('não abriu a consulta de requisição');
          const tp = D().getElementById('empenhoForm:tipo');
          tp.value = '24'; ev(tp, 'change');
          await S(1500);
          D().getElementById('empenhoForm:numeroRequisicao').value = x.req;
          D().getElementById('empenhoForm:anoRequisicao').value = reqAno;
          await nav(() => D().getElementById('empenhoForm:bntBuscar').click());
          if (!await until(() => D().getElementById('empenhoForm:txtDocumento') || msgSipac() || /totalmente liquidado/i.test(T())))
            return pula('requisição não encontrada no SIPAC');
          if (/já teve seu valor totalmente liquidado/i.test(T())) return parteJaLiquidada('consulta da requisição');
          if (!D().getElementById('empenhoForm:txtDocumento')) return pula('o SIPAC recusou a requisição ' + x.req);
          const rv = g(/Valor:\s*R\$\s*([\d.,]+)/);
          const rn = g(new RegExp('Número/Ano:\\s*(\\d+)/' + reqAno));
          if (Math.abs(num(rv) - num(x.valor)) > TOL || rn != x.req)
            return pula(`requisição ${rn}/${reqAno} R$ ${rv} ≠ R$ ${x.valor}`);
          D().getElementById('empenhoForm:txtDocumento').value = x.ne;
          await nav(() => D().getElementById('empenhoForm:btnPesquisar').click());
          if (!await until(() => fx('comboTipoLancamento') || msgEmpenho())) return pula('formulário não abriu');
          if (!fx('comboTipoLancamento') && msgEmpenho()) return pulaEmpenho(msgEmpenho());
          const jl = num(g(/J[áa] Liquidado:\s*([\d.,]+)/) || 0);
          if (jl > TOL) {
            if (Math.abs(jl - num(x.valor)) <= TOL) return parteJaLiquidada('Já Liquidado R$ ' + x.valor);
            return pula(`requisição ${x.req} parcialmente liquidada (Já Liquidado R$ ${jl.toFixed(2).replace('.', ',')} de R$ ${x.valor}) – fazer manual`);
          }
        }

        etapa = 'tipo de lançamento';
        const tl = campo('comboTipoLancamento');
        const opcao = [...tl.options].find(o => /Processo/i.test(o.text));
        if (!opcao) return pula('tipo de lançamento Processo não encontrado');
        tl.value = opcao.value; ev(tl, 'change');
        await S(1800);
        const rd = [...D().querySelectorAll('input[type=radio][value=false]')][0];
        if (rd && !rd.checked) { rd.click(); await S(1800); }

        etapa = 'número do processo';
        for (const [k, v] of [['txtRadicalProcesso', '23077'], ['txtNumeroProcesso', x.num], ['txtAnoProcesso', ANO], ['txtDvProcesso', x.dv]]) {
          const e = campo(k); e.value = v; key(e); await S(900);
        }

        etapa = 'natureza da despesa';
        const cat = campo('cboCategoriaDespesa');
        const co = [...cat.options].find(o => o.text.includes(x.nat));
        if (co) { cat.value = co.value; ev(cat, 'change'); }
        await S(800);

        etapa = 'data, valor e observação';
        const txtModal = (T().match(/Modalidade:\s*(Ordin[áa]rio|Estimativo|Global)/) || [])[1] || '';
        const valorFixo = !fx('txtValor') && fx('txtValorOrdinario');
        if (valorFixo) {
          const vf = valorFixo.textContent.trim();
          if (Math.abs(num(vf) - num(x.valor)) > TOL)
            return pula(`empenho ${txtModal.toUpperCase() || 'ORDINÁRIO'}: o SIPAC fixa o valor do detalhamento em R$ ${vf} (saldo do empenho), mas o processo é de R$ ${x.valor} – fazer manual`);
        }
        campo('data').value = x.data;
        if (!valorFixo) campo('txtValor').value = x.valor;
        const ob = campo('txtaObservacoes');
        ob.value = x.obs; key(ob);
        await S(500);

        etapa = 'ordem bancária';
        const lkOB = [...D().querySelectorAll('a')].find(a => /Adicionar Ordem Banc/i.test(a.textContent));
        if (lkOB) { lkOB.click(); await S(1500); }
        campo('txtNumeroOBSelecionada').value = x.ob;
        campo('txtAnoOBSelecionada').value = ANO;
        campo('dataOrdemBancaria').value = x.obData;
        campo('valorTxt').value = x.obValor;
        const btnOB = [...D().querySelectorAll('input[type=button]')].find(b => /Adicionar Ordem/i.test(b.value));
        if (!btnOB) return pula('botão Adicionar Ordem não encontrado');
        btnOB.click();
        await S(2500);

        // Tributos Vinculados ao Detalhamento: a linha do DAR (tipo, nº/ano, data, valor)
        const secaoTrib = t => {
          const i = t.indexOf('Tributos Vinculados ao Detalhamento');
          if (i < 0) return '';
          const j = t.slice(i + 20).search(/Guias? de Recolhimento|Tributos Vinculados ao Processo|Favorecido|Detalhar Despesas/);
          return t.slice(i, j < 0 ? i + 600 : i + 20 + j).replace(/\s+/g, ' ');
        };
        const tribOk = t => {
          const s = secaoTrib(t);
          return /\bDAR\b/.test(s) && new RegExp('\\b' + x.dar + '\\s*/\\s*' + ANO).test(s) &&
            s.includes(x.darData) && s.includes(x.darValor);
        };
        if (x.dar) {
          etapa = 'tributo (DAR)';
          const mt = k => D().getElementById('cadastroTributosModalForm:' + k);
          const visT = () => mt('numeroTributo') && mt('numeroTributo').getClientRects().length > 0;
          if (!tribOk(T())) {
            const lkT = [...D().querySelectorAll('a')].find(a => /^\s*Adicionar Tributo\s*$/i.test(a.textContent));
            if (!lkT) return pula('link "Adicionar Tributo" não encontrado');
            lkT.click();
            if (!await until(visT, 8000)) return pula('janela "Cadastro de Novo Tributo" não abriu');
            const tpT = mt('tipoTributo');
            const oDar = [...tpT.options].find(o => o.text.trim().toUpperCase() === 'DAR');
            if (!oDar) return pula('tipo de tributo DAR não encontrado');
            tpT.value = oDar.value; ev(tpT, 'change');
            await S(400);
            mt('numeroTributo').value = x.dar;
            mt('anoTributo').value = ANO;
            mt('dataTributo').value = x.darData;
            mt('txtValorTributo').value = x.darValor;
            const btT = [...D().querySelectorAll('[id^="cadastroTributosModalForm:"]')]
              .find(b => b.type === 'button' && b.value === 'Adicionar Tributo');
            if (!btT) return pula('botão "Adicionar Tributo" da janela não encontrado');
            btT.click();
            if (!await until(() => tribOk(T()), 8000)) return pula(`tributo DAR ${x.dar}/${ANO} não apareceu em "Tributos Vinculados"`);
            await S(800);
            if (visT()) { const fe = mt('fecharModalCadastrarTributo'); if (fe) { fe.click(); await S(800); } }
          }
        }

        etapa = 'favorecido (CNPJ)';
        // Usa o próprio componente de sugestão do SIPAC (RichFaces): buscar pelo CNPJ e selecionar a linha.
        // A seleção só vale se disparar a chamada que registra o credor no servidor (suggestionCredor:j_id…).
        const nc = campo('nomeC');
        const A4J = W().A4J && W().A4J.AJAX;
        const subOrig = A4J && A4J.Submit;
        let credorRegistrado = false, nomeFav = '';
        if (subOrig) A4J.Submit = function (fm, e, opt) {
          if (opt && opt.parameters && Object.keys(opt.parameters).some(k => /suggestionCredor:j_id/.test(k))) credorRegistrado = true;
          return subOrig.apply(this, arguments);
        };
        try {
          await S(1000); // deixa terminar o recarregamento parcial da tela
          let linhas = [], idx = -1, comp = null, vistos = [];
          // Tentativas: CNPJ só dígitos (2x), CNPJ formatado e raiz do CNPJ (8 dígitos) – sempre exigindo o CNPJ completo na linha
          const buscas = [cn(x.cnpj), cn(x.cnpj), x.cnpj, cn(x.cnpj).slice(0, 8)];
          for (let tent = 0; tent < buscas.length && idx < 0; tent++) {
            const caixa = D().querySelector('[id$=":suggestionCredor"]');
            comp = caixa && caixa.component;
            const campoAtual = fx('nomeC') || nc;
            campoAtual.focus();
            campoAtual.value = buscas[tent];
            if (comp && comp.callSuggestion) { comp.hasFocus = true; comp.changed = true; comp.oldValue = ''; comp.callSuggestion(true); }
            else key(campoAtual);
            for (let i = 0; i < 10 && idx < 0; i++) {
              await S(500);
              const area = (comp && comp.update) || D();
              linhas = [...area.querySelectorAll('tr.richfaces_suggestionEntry')];
              idx = linhas.findIndex(t => t.getClientRects().length && t.innerText.includes(x.cnpj));
              linhas.filter(t => t.getClientRects().length).forEach(t => { const v = t.innerText.replace(/\s+/g, ' ').trim(); if (!vistos.includes(v)) vistos.push(v); });
            }
          }
          if (idx < 0) return pula(vistos.length
            ? `favorecido: o SIPAC sugeriu outros credores, não o CNPJ ${x.cnpj} (ex.: ${vistos.slice(0, 2).join(' | ')}) – conferir o CNPJ do processo`
            : `favorecido: o CNPJ ${x.cnpj} não aparece como credor no SIPAC (nenhuma sugestão) – cadastrar o credor ou fazer manual`);
          // Nome = tudo antes do " - CNPJ" final (o nome pode ter " - ME", " - EPP"…)
          nomeFav = linhas[idx].innerText.replace(/\s+/g, ' ').trim()
            .replace(/\s*-\s*\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}\s*$/, '').trim();
          if (comp && comp.selectEntry) { comp.index = idx; comp.selectEntry(new (W().MouseEvent)('click', { bubbles: true })); }
          else ['mouseover', 'mousedown', 'click', 'mouseup'].forEach(k => linhas[idx].dispatchEvent(new (W().MouseEvent)(k, { bubbles: true })));
          for (let i = 0; i < 15 && !credorRegistrado; i++) await S(300);
          await S(1500);
        } finally { if (subOrig) A4J.Submit = subOrig; }
        if (!credorRegistrado) return pula(`favorecido: a seleção do CNPJ ${x.cnpj} não foi registrada no SIPAC`);

        etapa = 'conferência final';
        const t = T();
        const oi = t.indexOf('Ordens Bancárias Vinculadas ao Detalhamento');
        const pi = t.indexOf('Ordens Bancárias Vinculadas ao Processo', oi);
        const fimTrib = t.indexOf('Tributos', oi);
        const fimDet = pi > oi ? pi : fimTrib;
        const ol = oi >= 0 && fimDet > oi ? t.slice(oi, fimDet).split('\n').filter(l => /^\d+\/2026/.test(l)) : [];
        // OBs que o processo já tem de detalhamentos anteriores (ex.: 1º de várias requisições)
        const obProcLinhas = pi >= 0 ? t.slice(pi, t.indexOf('Tributos', pi)).split('\n').filter(l => /^\d+\/\s*2026/.test(l)) : [];
        const obProcSoma = somar(obProcLinhas, l => num((l.match(/(\d{1,3}(?:\.\d{3})*,\d{2})\s*$/) || [])[1] || 0));
        const obJaFeita = x.partes ? somar(x.partes.filter(q => q.feito), q => num(q.obValor)) : 0;
        const temExterno = !!(x.partes && x.partes.some(q => q.feito && q.externo));
        // O SIPAC lista a OB UMA vez por processo, com o valor do ÚLTIMO detalhamento (o Relatório de Detalhamento
        // guarda o valor de cada um). Então: o processo só pode ter a MESMA OB, com o valor de uma parte já gravada.
        const mesmaOB = obProcLinhas.length > 0 && obProcLinhas.every(l => new RegExp('^' + x.ob + '\\/\\s*' + ANO).test(l));
        const valOB = l => num((l.match(/(\d{1,3}(?:\.\d{3})*,\d{2})\s*$/) || [])[1] || 0);
        const feitas = x.partes ? x.partes.filter(q => q.feito) : [];
        const obsDoProcOk = temExterno ? mesmaOB
          : mesmaOB && obProcLinhas.every(l => feitas.some(q => Math.abs(num(q.obValor) - valOB(l)) <= TOL));
        void obProcSoma; void obJaFeita;
        const ck = {
          'valor da requisição': !!x.semReq || Math.abs(num(g(/Valor da Requisi[çc][ãa]o:\s*R\$\s*([\d.,]+)/)) - num(x.valor)) <= TOL,
          'empenho': g(new RegExp('Empenho:\\s*(\\d+)/' + neAno)) == String(x.ne),
          // "Já Liquidado" só existe na tela com requisição; no "Outros" vale a trava de OB abaixo
          // "Já Liquidado" é da REQUISIÇÃO: tem de ser 0 (não existe na tela "Outros")
          'já liquidado da requisição = 0': x.semReq && g(/J[áa] Liquidado:\s*([\d.,]+)/) == null ? true
            : num(g(/J[áa] Liquidado:\s*([\d.,]+)/)) === 0,
          // trava contra duplicidade: o processo só pode ter as OBs dos detalhamentos já gravados por nós
          [jaLiqEsperado > 0 ? 'processo só com a OB ' + x.ob + (temExterno ? '' : ' (valor de uma parte já gravada)') : 'processo ainda sem OB vinculada']: jaLiqEsperado > 0
            ? obsDoProcOk
            : /O processo associado não possui Ordens Bancárias associadas/.test(t),
          'saldo do empenho': num(g(/Saldo do Empenho:\s*R\$\s*([\d.,]+)/)) >= num(x.valor),
          'saldo da unidade': g(/Saldo Total da Unidade \(R\$\):\s*([\d.,]+)/) == null && x.semReq ? true
            : num(g(/Saldo Total da Unidade \(R\$\):\s*([\d.,]+)/)) >= num(x.valor),
          'processo': fx('txtNumeroProcesso').value === x.num && fx('txtDvProcesso').value === x.dv,
          'natureza': !!co,
          'data': fx('data').value === x.data,
          'valor': fx('txtValor') ? fx('txtValor').value === x.valor
            : !!fx('txtValorOrdinario') && Math.abs(num(fx('txtValorOrdinario').textContent) - num(x.valor)) <= TOL,
          'observação': fx('txtaObservacoes').value === x.obs,
          ...(x.dar ? { ['tributo DAR ' + x.dar + '/' + ANO + ' R$ ' + x.darValor]: tribOk(t) } : {}),
          'OB': ol.length === 1 && ol[0].startsWith(x.ob + '/2026') && ol[0].includes(x.obData) && ol[0].includes(x.obValor),
          ['favorecido ' + x.cnpj + (nomeFav ? ' (' + nomeFav + ')' : '')]: credorRegistrado && !!nomeFav &&
            norm(fx('nomeC').value) === norm(nomeFav)
        };
        const bad = Object.keys(ck).filter(k => !ck[k]);
        if (bad.length) return pula('conferência falhou: ' + bad.join(', '));

        const bt = [...D().querySelectorAll('input[type=submit]')].find(b => b.value === 'Detalhar Despesas');
        if (!bt) return pula('botão Detalhar Despesas não encontrado');
        bt.scrollIntoView({ block: 'center' });

        execBox(
          `✔ CONFERE ${x.num}/${ANO}-${x.dv}${rotParte ? ' · ' + rotParte.toUpperCase() : ''}\n` +
          `Valor R$ ${x.valor} · OB ${x.ob} de ${x.obData} (R$ ${x.obValor})\n` +
          `Favorecido: ${nomeFav} – ${x.cnpj} ✔ registrado\n` +
          (x.dar ? `Tributo: DAR ${x.dar}/${ANO} de ${x.darData} (R$ ${x.darValor}) ✔ vinculado` +
            (num(x.sobra) > TOL ? ` · sobra NF − OB − DAR R$ ${x.sobra}` : '') + '\n' : '') +
          `${x.caso}${x.semReq ? ' · sem requisição (NE ' + x.ne + ')' : ' · req ' + x.req} → ${destino(x)}\n` +
          `Confira a tela à esquerda e clique em Gravar.`, true);
        prog(`Restam ${lista(r => r.st === 'PRONTO').length} pronto(s).`);
      } catch (e) {
        if (!F || parar) { LOG(`${x.id}: interrompido (Parar)`); return; }
        return pula(`erro em "${etapa}": ${String(e && e.message || e).slice(0, 120)}`);
      }
    }

    $id('b-detalhar').onclick = () => {
      if (ocupado) return alert('Espere a análise da página terminar.');
      if (atual) return alert('Já há um processo preparado. Grave, pule ou pare.');
      if (!lista(r => r.st === 'PRONTO').length) return alert('Nenhum processo pronto. Use "1. Analisar esta página".');
      parar = false;
      preparar();
    };
    $id('b-parar').onclick = () => {
      pararAuto('Parar');
      parar = true;
      if (!atual) { fecharIframe(); execBox(''); }
      else { atual = null; preparar(); }
    };
    $id('b-pular').onclick = () => {
      if (!atual) return;
      if (AUTO.timer) { clearInterval(AUTO.timer); AUTO.timer = null; }
      LOG(`Pulado por você: ${atual.id}`);
      salvar(atual.id, { st: 'PENDENTE', motivo: 'pulado por você no detalhamento' + (atual.rotParte ? ' (' + atual.rotParte + ')' : ''), tentado: true, tentEtapa: 'conferido, não gravado', tentEm: new Date().toLocaleString('pt-BR') });
      preparar();
    };
    // ================= CONFERÊNCIA NO RELATÓRIO (depois de gravar) =================
    // Orçamento → "Relatório de Detalhamento de Despesas por Processo" (empenho + processo).
    // Mostra cada lançamento: data, valor, requisição e as OBs com o valor daquele detalhamento.
    function lerRelatorio(t) {
      const fav = (t.match(/Favorecido:\s*([^\n]+?)\s+-\s+(\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2})/) || []);
      const ini = t.indexOf('Lançamentos');
      const corpo = ini < 0 ? '' : t.slice(ini);
      const partes = corpo.split(/\n(?=\d{2}\/\d{2}\/\d{4}\t)/).slice(1);
      const lanc = partes.map(b => ({
        data: (b.match(/^(\d{2}\/\d{2}\/\d{4})/) || [])[1],
        valor: (b.match(/^[^\n]*R\$\s*([\d.,]+)/) || [])[1],
        req: (b.match(/\n(\d+)\/\s*\d{4}\s*-/) || [])[1] || '',
        obs: [...b.matchAll(/\n(\d+)\t(\d{2}\/\d{2}\/\d{4})\tR\$\s*([\d.,]+)/g)].map(m => ({ ob: m[1], data: m[2], valor: m[3] }))
      }));
      return { favNome: (fav[1] || '').trim(), favCnpj: fav[2] || '', lanc };
    }
    async function conferirRelatorio(x) {
      try {
        await nav(() => { F.src = '/sipac/orcamento/index.jsf'; });
        const lk = D().getElementById('menuForm:cmdRelLiqEmp');
        if (!lk) return { ok: false, msg: 'menu do relatório não encontrado' };
        await nav(() => lk.click());
        const f = k => D().getElementById('liquidacaoForm:' + k);
        if (!await until(() => f('txtEmpenho'), 8000)) return { ok: false, msg: 'tela do relatório não abriu' };
        f('txtEmpenho').value = x.ne; f('txtAnoEmpenho').value = x.neAno || ANO;
        f('txtNumProcesso').value = x.num; f('txtAnoProcesso').value = ANO; f('txtDvProcesso').value = x.dv;
        await nav(() => f('btnBuscar').click());
        if (!await until(() => /Lançamentos/.test(T()), 8000)) return { ok: false, msg: 'relatório sem lançamentos' };
        const R = lerRelatorio(T());
        const m = R.lanc.filter(l => Math.abs(num(l.valor) - num(x.valor)) <= TOL && (x.semReq || l.req === String(x.req)));
        const erros = [];
        if (cn(R.favCnpj) !== cn(x.cnpj)) erros.push(`favorecido ${R.favCnpj || '?'} ≠ ${x.cnpj}`);
        if (!m.length) erros.push(`lançamento de R$ ${x.valor}${x.semReq ? '' : ' (req ' + x.req + ')'} não encontrado`);
        else if (!m.some(l => l.obs.some(o => o.ob === String(x.ob) && o.data === x.obData && Math.abs(num(o.valor) - num(x.obValor)) <= TOL)))
          erros.push(`OB ${x.ob} de R$ ${x.obValor} não está vinculada ao lançamento`);
        if (m.length > 1) erros.push(`${m.length} lançamentos iguais (R$ ${x.valor}${x.semReq ? '' : ', req ' + x.req}) – possível duplicidade`);
        return erros.length ? { ok: false, msg: erros.join('; '), duro: true }
          : { ok: true, msg: `${R.lanc.length} lançamento(s) no relatório; este com OB ${x.ob} R$ ${x.obValor} e favorecido certo` };
      } catch (e) { return { ok: false, msg: 'erro ao ler o relatório: ' + String(e.message || e).slice(0, 80) }; }
    }

    $id('b-gravar').onclick = () => gravarAtual(false);
    async function gravarAtual(auto) {
      if (!atual || !F) return;
      if (AUTO.timer) { clearInterval(AUTO.timer); AUTO.timer = null; }
      const x = atual;
      const bt = [...D().querySelectorAll('input[type=submit]')].find(b => b.value === 'Detalhar Despesas');
      if (!bt) { if (auto) pararAuto('botão Detalhar Despesas não encontrado'); return alert('Botão "Detalhar Despesas" não encontrado.'); }
      if (auto && sessaoCaiu()) { pararAuto('a sessão do SIPAC expirou'); return; }
      if (!auto && !confirm(`Gravar o detalhamento de 23077.${x.num}/${ANO}-${x.dv}${x.rotParte ? '\n' + x.rotParte : ''}\nR$ ${x.valor} – OB ${x.ob}/${ANO} (R$ ${x.obValor})${x.dar ? `\nDAR ${x.dar}/${ANO} (R$ ${x.darValor})` : ''}?`)) return;
      $id('b-gravar').disabled = true;
      await nav(() => bt.click());
      await until(() => /comprovante/.test(W().location.pathname), 10000);
      const t = T();
      const tz = t.replace(/\s+/g, ' ');
      const darOk = !x.dar || (new RegExp('DAR\\s*' + x.dar + '\\s*/\\s*' + ANO).test(tz) && tz.includes(x.darValor));
      if (/Operação realizada com sucesso/.test(t) && t.includes('23077.' + x.num + '/2026-' + x.dv) && t.includes('R$ ' + x.valor) && darOk) {
        if (x.parteIdx != null) {
          const partes = rec(x.id).partes.map((q, k) => k === x.parteIdx ? Object.assign({}, q, { feito: true }) : q);
          const tudo = partes.every(q => q.feito);
          salvar(x.id, Object.assign({ partes }, tudo ? { st: 'GRAVADO', motivo: '', tentado: false, gravadoEm: new Date().toLocaleString('pt-BR') } : {}));
          LOG(`GRAVADO ${x.id} ${x.rotParte}${tudo ? ` – todos gravados → ${destino(x)}` : ''}`);
        } else {
          salvar(x.id, { st: 'GRAVADO', motivo: '', tentado: false, gravadoEm: new Date().toLocaleString('pt-BR') });
          LOG(`GRAVADO ${x.id} [${nomeTipo(x)}${x.dar ? ' · DAR ' + x.dar : ''}] → ${destino(x)}`);
        }
        salvar(x.id, { gravadoTs: Date.now(), gravadoAuto: !!auto });
        if (auto) { AUTO.feitos++; $id('sdl-auto-n').textContent = AUTO.feitos + ' gravado(s) no automático'; }
        execBox(`Gravado ${x.id}. Conferindo no Relatório de Detalhamento…`, false);
        const rc = await conferirRelatorio(x);
        const rot = (x.rotParte ? x.rotParte + ': ' : '');
        salvar(x.id, { relConf: rc.ok ? 'ok' : rot + rc.msg, relEm: new Date().toLocaleString('pt-BR') });
        if (rc.ok) LOG(`🔎 ${x.id} ${rot}conferido no relatório ✔`);
        else {
          LOG(`⚠ ${x.id} ${rot}relatório: ${rc.msg}`);
          if (rc.duro) {
            parar = true; pararAuto('o Relatório de Detalhamento não bateu');
            execBox(`⚠ ${x.id}: o Relatório de Detalhamento não bateu com o que foi gravado:\n${rc.msg}\n\nA execução parou. Confira o relatório na tela à esquerda.`, false);
            atual = null;
            return;
          }
        }
        preparar();
      } else {
        parar = true;
        salvar(x.id, { st: 'PENDENTE', motivo: (x.rotParte ? x.rotParte + ': ' : '') + 'comprovante não conferiu após gravar' + (x.dar && !darOk ? ' (DAR não visto no comprovante)' : '') + ' – VERIFICAR se foi gravado', tentado: true, tentEtapa: 'gravação', tentEm: new Date().toLocaleString('pt-BR') });
        LOG(`⚠ COMPROVANTE NÃO CONFERE em ${x.id}. Execução parada.`);
        pararAuto('o comprovante não conferiu');
        execBox(`⚠ Comprovante de ${x.id} não conferiu. Verifique a tela à esquerda.`, false);
        atual = null;
      }
    };

    // ================= 3. ARQUIVAR SIMPLES / MOVER DARF =================
    // Marca na Mesa só os processos alvo. Recusa se houver outro processo marcado.
    async function marcarSo(alvos) {
      const alvoIds = new Set(alvos.map(r => r.id));
      const intrusos = [];
      for (const a of linksMesa()) {
        const x = idDoLink(a);
        const cb = a.closest('tr') && a.closest('tr').querySelector('input[type=checkbox]');
        if (cb && cb.checked && !(x && alvoIds.has(x.id))) intrusos.push(x ? x.id : '?');
      }
      if (intrusos.length) return { erro: `Desmarque antes: ${intrusos.join(', ')} (não fazem parte deste grupo).` };
      const marcados = [];
      for (const a of linksMesa()) {
        const x = idDoLink(a);
        if (!x || !alvoIds.has(x.id)) continue;
        const cb = a.closest('tr').querySelector('input[type=checkbox]');
        if (!cb) continue;
        if (!cb.checked) { cb.click(); await S(350); }
        marcados.push(x.id);
      }
      await S(800);
      return { marcados };
    }

    const destacar = el => { if (el) { el.classList.add('sdl-alvo'); el.scrollIntoView({ block: 'center' }); } };
    const txtDe = el => el ? (el.innerText || el.textContent || '') : '';
    const opcao = (sel, fn) => [...sel.options].find(o => fn(norm(o.text)));

    async function arquivarMes(chave) {
      try { await arquivarMes2(chave); }
      catch (e) { LOG('⚠ Erro ao preparar o arquivamento: ' + e.message); execBox('⚠ Erro ao preparar o arquivamento: ' + e.message, false); }
    }
    async function arquivarMes2(chave) {
      if (!naMesa()) return;
      const naPag = new Set(idsDaPagina());
      const alvos = lista(r => r.st === 'GRAVADO' && tipo(r) === 'SIMPLES' && chaveMes(r) === chave && naPag.has(r.id));
      if (!alvos.length) return alert('Nenhum SIMPLES deste mês nesta página.');
      const m = await marcarSo(alvos);
      if (m.erro) return alert(m.erro);
      ST.set('acao', { tipo: 'arquivar', chave, ids: m.marcados, t: Date.now() });
      LOG(`Arquivar ${nomeMes(chave)}: ${m.marcados.length} marcado(s) – abrindo tela de arquivamento.`);
      const b = $id('menuForm:b_opcao_arquivar_procs') ||
        [...document.querySelectorAll('a')].find(a => /Arquivar Processos Selecionados/.test(a.textContent));
      if (!b) return alert('Não achei "Arquivar Processos Selecionados" na Mesa.');
      b.click();
      setTimeout(prepararArquivamento, 2500);
    }

    // Na tela de arquivamento: gaveta 2026 + pasta do mês, confere a lista e destaca o Confirmar
    async function prepararArquivamento() {
      const ac = ST.get('acao', null);
      const gav = $id('arquivamentoForm:gavetas');
      if (!ac || ac.tipo !== 'arquivar' || !gav || !gav.offsetParent) return;
      if (Date.now() - ac.t > 15 * 60000) { ST.del('acao'); return; }
      if (ac.preparado) return;

      const [mm, aa] = ac.chave.split('/');
      const form = $id('arquivamentoForm');
      const listados = [...new Set([...(txtDe(form).matchAll(/23077\.(\d+)\/2026-(\d+)/g))].map(m => m[1] + '-' + m[2]))];
      const esperado = new Set(ac.ids);
      const difere = listados.length !== esperado.size || listados.some(id => !esperado.has(id));

      const og = opcao(gav, t => t === aa);
      if (!og) { execBox(`⚠ Não achei a gaveta "${aa}" no arquivamento. Escolha manualmente.`, false); return; }
      gav.value = og.value; gav.dispatchEvent(new Event('change', { bubbles: true }));

      let pastas = null, op = null;
      for (let i = 0; i < 30 && !op; i++) {
        await S(400);
        pastas = $id('arquivamentoForm:pastas');
        if (pastas) op = opcao(pastas, t => t.startsWith(mm + ' - PAGAMENTOS'));
      }
      if (!op) { execBox(`⚠ Não achei a pasta "${mm} - PAGAMENTOS …" na gaveta ${aa}. Escolha manualmente.`, false); return; }
      pastas.value = op.value; pastas.dispatchEvent(new Event('change', { bubbles: true }));

      ac.preparado = true; ac.pasta = op.text.trim();
      ST.set('acao', ac);

      const conf = $id('arquivamentoForm:b_arquivar_processo');
      if (difere) {
        execBox(`⚠ A lista da tela (${listados.join(', ')}) não bate com os SIMPLES de ${nomeMes(ac.chave)} (${ac.ids.join(', ')}). NÃO confirme: volte e confira a seleção.`, false);
        return;
      }
      execBox(`Arquivamento pronto para conferir:\n${ac.ids.length} processo(s) → gaveta ${aa} / pasta ${ac.pasta}\n${ac.ids.join(', ')}\nConfira e clique em "Confirmar" (destacado em vermelho).`, false);
      if (conf) {
        destacar(conf);
        conf.addEventListener('click', () => { const a2 = ST.get('acao', {}); a2.confirmado = true; ST.set('acao', a2); }, { once: true });
      }
    }

    // ================= NAVEGAÇÃO NA MESA (07 - PAGOS) =================
    const infoPag = () => {
      const m = (document.body.innerText || '').match(/(\d+)\s*-\s*(\d+)\s+de\s+(\d+)\s+Processos/i);
      return m ? { ini: +m[1], fim: +m[2], total: +m[3] } : null;
    };
    const porPagina = () => { const sl = $id('menuForm:atualizarPaginacao'); return sl ? (+sl.value || 25) : 25; };
    const numPagina = () => { const i = infoPag(); return i ? Math.floor((i.ini - 1) / porPagina()) + 1 : null; };
    const totalPaginas = () => { const i = infoPag(); return i ? Math.max(1, Math.ceil(i.total / porPagina())) : null; };
    const pasta07Ativa = () => [...document.querySelectorAll('.bg-pastas .active')].some(e => /07 - PAGOS/.test(e.textContent || ''));
    const idPasta07 = () => {
      const el = [...document.querySelectorAll('[onclick*="atualizarPasta"]')].find(e => /07 - PAGOS/.test(e.textContent || ''));
      const m = el && el.getAttribute('onclick').match(/atualizarPasta\((\d+)\)/);
      return m ? +m[1] : null;
    };
    async function cemPorPagina() {
      const sl = $id('menuForm:atualizarPaginacao');
      if (!sl || sl.value === '100' || ![...sl.options].some(o => o.value === '100' || o.text.trim() === '100')) return;
      const op = [...sl.options].find(o => o.value === '100' || o.text.trim() === '100');
      sl.value = op.value; sl.dispatchEvent(new Event('change', { bubbles: true }));
      await until0(() => { const i = infoPag(); return i && (i.fim - i.ini + 1 > 25 || i.fim === i.total); }, 40000);
      await S(800);
    }
    // Abre a 07 - PAGOS na página pedida. Fora da Mesa: navega (o painel retoma ao carregar) e devolve false.
    async function irPara07(pagina) {
      if (!naMesa()) { location.href = '/sipac/protocolo/mesa_virtual/lista.jsf'; return false; }
      await until0(() => infoPag() || idPasta07() != null, 10000);
      // a Mesa pode abrir em outra categoria/gaveta: PROCESSOS NA UNIDADE + VIRTUAL (senão aparecem os de 2025)
      const ajustaSel = async (idSel, re, rotulo) => {
        // a Mesa redesenha os selects por AJAX: espera a opção aparecer (até 12 s)
        let sl = null, op = null;
        await until0(() => { sl = $id(idSel); op = sl && [...sl.options].find(o => re.test(norm(o.text))); return op; }, 12000);
        if (!sl) return;
        if (!op) {
          if (idPasta07() != null) return; // a 07 já está na lista de pastas: segue sem trocar
          throw new Error(`não achei "${rotulo}" na Mesa (opções: ${[...sl.options].map(o => o.text.trim()).join(' / ') || 'nenhuma'})`);
        }
        if (sl.value === op.value) return;
        sl.value = op.value; sl.dispatchEvent(new Event('change', { bubbles: true }));
        await S(1500);
        await until0(() => !document.querySelector('[id*="statusAtualizacao"][style*="block"]'), 10000);
      };
      if (idPasta07() == null || !pasta07Ativa()) {
        await ajustaSel('menuForm:selecaoCategorias', /^PROCESSOS NA UNIDADE$/, 'PROCESSOS NA UNIDADE');
        await until0(() => $id('menuForm:combo_gavetas'), 8000);
        await ajustaSel('menuForm:combo_gavetas', /^VIRTUAL$/, 'gaveta VIRTUAL');
        await until0(() => idPasta07() != null, 10000);
      }
      if (!pasta07Ativa()) {
        const id = idPasta07();
        if (id == null) throw new Error('não achei a pasta 07 - PAGOS na Mesa (confira: PROCESSOS NA UNIDADE / VIRTUAL)');
        window.atualizarPasta(id);
        if (!await until0(() => pasta07Ativa() && infoPag(), 40000)) throw new Error('a pasta 07 - PAGOS não abriu');
        await S(800);
      }
      const tp = totalPaginas();
      const alvo = Math.min(pagina || 1, tp || 1);
      if (numPagina() !== alvo) {
        let abriu = false;
        for (let t = 0; t < 2 && !abriu; t++) {
          window.mudarPagina(alvo - 1);
          abriu = await until0(() => numPagina() === alvo && linksMesa().length, 40000);
        }
        if (!abriu) throw new Error('não consegui abrir a página ' + alvo + ' (a Mesa não respondeu em 80 s)');
        await S(800);
      }
      return alvo;
    }

    // ================= DESTINO AUTOMÁTICO (arquivar por mês + mover p/ 08) =================
    // Fila guardada no navegador: sobrevive aos recarregamentos do SIPAC. Depois de cada grupo,
    // volta sozinho para a 07 na mesma página e segue para o próximo.
    function gruposDestinoDaPagina() {
      const naPag = new Set(naMesa() ? idsDaPagina() : []);
      const g = [], meses = {};
      lista(r => r.st === 'GRAVADO' && tipo(r) === 'SIMPLES' && naPag.has(r.id))
        .forEach(r => { const k = chaveMes(r) || '?'; (meses[k] = meses[k] || []).push(r.id); });
      Object.keys(meses).sort().forEach(k => g.push({ tipo: 'arquivar', chave: k, ids: meses[k] }));
      const d = lista(r => r.st === 'GRAVADO' && tipo(r) === 'DARF' && naPag.has(r.id)).map(r => r.id);
      if (d.length) g.push({ tipo: 'mover', ids: d });
      return g;
    }
    const descGrupo = g => g.tipo === 'arquivar'
      ? `Arquivar ${g.ids.length} em ${nomeMes(g.chave)} (gaveta ${String(g.chave).split('/')[1]})`
      : `Mover ${g.ids.length} para 08 - AGUARD. DARF E GPS`;
    // Todos os detalhados, em qualquer página: percorre a 07 (100 por página) do início ao fim
    function iniciarDestinoTodos() {
      if (!naMesa()) return alert('Abra a Mesa Virtual (07 - PAGOS).');
      if (ST.get('filaDest', null)) return alert('Já há um destino automático em andamento: use Continuar ou Cancelar.');
      if (atual || ocupado) return alert('Espere a análise/detalhamento terminar.');
      const gs = lista(r => r.st === 'GRAVADO');
      if (!gs.length) return alert('Nenhum processo detalhado aguardando destino.');
      const semMes = gs.filter(r => tipo(r) === 'SIMPLES' && !chaveMes(r));
      if (semMes.length) return alert('Há SIMPLES sem o mês da OB – reanalise antes: ' + semMes.map(r => r.id).join(', '));
      const meses = {};
      gs.filter(r => tipo(r) === 'SIMPLES').forEach(r => { const k = chaveMes(r); meses[k] = (meses[k] || 0) + 1; });
      const nD = gs.filter(r => tipo(r) === 'DARF').length;
      if (!confirm(`Destinar TODOS os ${gs.length} detalhados, em qualquer página da 07:\n\n` +
        Object.keys(meses).sort().map(k => `• Arquivar ${meses[k]} em ${nomeMes(k)}`).join('\n') + (nD ? `\n• Mover ${nD} para 08 - AGUARD. DARF E GPS` : '') +
        `\n\nO painel põe a Mesa em 100 por página, percorre a 07 do começo ao fim e, em cada página, arquiva por mês e move para a 08 ` +
        `(confere a lista antes de cada confirmação). Se algo não bater, ele PARA. Continuar?`)) return;
      ST.set('filaDest', { modo: 'todas', grupos: [], i: 0, etapa: 'marcar', pagina: 1, t: Date.now(), feitos: [], vistos: [], total: gs.length });
      LOG(`▶ Destinar todos: ${gs.length} detalhado(s) – ` + Object.keys(meses).sort().map(k => `${meses[k]} em ${nomeMes(k)}`).join(', ') + (nD ? `, ${nD} para a 08` : ''));
      passoDestino();
    }
    function iniciarDestino(grupos) {
      if (!naMesa()) return alert('Abra a Mesa Virtual (07 - PAGOS) na página dos processos.');
      if (ST.get('filaDest', null)) return alert('Já há um destino automático em andamento: use Continuar ou Cancelar.');
      if (atual || ocupado) return alert('Espere a análise/detalhamento terminar.');
      if (!grupos.length) return alert('Nada para dar destino nesta página.');
      if (grupos.some(g => g.tipo === 'arquivar' && g.chave === '?')) return alert('Há SIMPLES sem o mês da OB – reanalise antes.');
      const pg = numPagina();
      if (!confirm(`Destino automático – página ${pg} da 07:\n\n` + grupos.map(g => '• ' + descGrupo(g) + '\n   ' + g.ids.join(', ')).join('\n') +
        `\n\nO painel marca, confirma, volta para a página ${pg} e segue para o próximo grupo sozinho. Continuar?`)) return;
      ST.set('filaDest', { grupos, i: 0, etapa: 'marcar', pagina: pg, t: Date.now(), feitos: [] });
      LOG(`▶ Destino automático na página ${pg}: ${grupos.map(descGrupo).join(' · ')}`);
      passoDestino();
    }
    let destRodando = false;
    // Só UMA aba pode tocar o destino (o SIPAC usa uma sessão só): id da aba guardado no sessionStorage
    const TAB_ID = (() => { try { let v = sessionStorage.getItem('sdl-tab'); if (!v) { v = Math.random().toString(36).slice(2); sessionStorage.setItem('sdl-tab', v); } return v; } catch (e) { return 'x'; } })();
    const travaDest = () => {
      const lk = ST.get('destLock', null);
      if (lk && lk.id !== TAB_ID && Date.now() - lk.t < 90000) return false;
      ST.set('destLock', { id: TAB_ID, t: Date.now() });
      return true;
    };
    async function passoDestino() {
      if (destRodando) return;
      if (!travaDest()) { execBox('O destino automático está rodando em OUTRA aba do SIPAC. Feche as abas extras e use só uma.', false); return; }
      destRodando = true;
      try { await passoDestino2(); }
      catch (e) {
        LOG('⚠ Destino automático: ' + e.message);
        execBox('⚠ Destino automático parou: ' + e.message + '\nUse "Continuar" (seção 3) para tentar de novo ou "Cancelar".', false);
      } finally { destRodando = false; render(); }
    }
    const marcarSoEstes = async ids => {
      const alvo = new Set(ids);
      for (const a of linksMesa()) {
        const x = idDoLink(a), cb = a.closest('tr') && a.closest('tr').querySelector('input[type=checkbox]');
        if (!cb) continue;
        const quero = !!(x && alvo.has(x.id));
        if (cb.checked !== quero) { cb.click(); await S(250); }
      }
      await S(600);
      const n = +(((document.body.innerText || '').match(/(\d+)\s+Itens?\s+Selecionados?/i) || [])[1] || -1);
      return n === -1 || n === ids.length;
    };
    async function passoDestino2() {
      for (let volta = 0; volta < 300; volta++) {
        const q = ST.get('filaDest', null);
        if (!q) return;
        if (Date.now() - q.t > 20 * 60000) { ST.del('filaDest'); LOG('Destino automático expirado (parado há mais de 20 min).'); return; }
        q.t = Date.now(); ST.set('filaDest', q);
        ST.set('destLock', { id: TAB_ID, t: Date.now() });

        // 1) tela de arquivamento aberta (modal ou página nova)
        const gav = $id('arquivamentoForm:gavetas');
        if (q.etapa === 'tela' && gav && gav.offsetParent) { await arquivarNaTela(q); continue; }

        // 2) acabou de confirmar: conferir na Mesa
        if (q.etapa === 'confirmado') {
          if (/sucesso/i.test((document.body.innerText || '').replace(P.innerText, ''))) { q.sucessoVisto = true; ST.set('filaDest', q); }
          const pg = await irPara07(q.pagina);
          if (pg === false) return;
          const g = q.grupos[q.i];
          const naPag = new Set(idsDaPagina());
          const ainda = g.idsAgora.filter(id => naPag.has(id));
          const agora = contador07();
          const caiu = q.antes07 != null && agora != null && q.antes07 - agora >= g.idsAgora.length;
          if (!ainda.length && (caiu || q.sucessoVisto)) {
            g.idsAgora.forEach(id => salvar(id, g.tipo === 'arquivar'
              ? { st: 'ARQUIVADO', motivo: 'arquivado em ' + (g.pasta || nomeMes(g.chave)), destinoEm: new Date().toLocaleString('pt-BR'), destinoTs: Date.now() }
              : { st: 'MOVIDO', motivo: 'movido para a 08', destinoEm: new Date().toLocaleString('pt-BR'), destinoTs: Date.now() }));
            LOG(`✔ ${descGrupo({ ...g, ids: g.idsAgora })}: ${g.idsAgora.join(', ')} (07: ${q.antes07} → ${agora})`);
            q.feitos.push(descGrupo({ ...g, ids: g.idsAgora }));
            q.i++; q.etapa = 'marcar'; delete q.sucessoVisto; delete q.tentConf; delete q.refeito; ST.set('filaDest', q);
            continue;
          }
          // o SIPAC às vezes demora a atualizar a lista: recarrega a Mesa e confere de novo (até 4 vezes)
          q.tentConf = (q.tentConf || 0) + 1;
          if (q.tentConf <= 4) {
            ST.set('filaDest', q);
            execBox(`Conferindo "${descGrupo({ ...g, ids: g.idsAgora })}": a Mesa ainda não atualizou – tentativa ${q.tentConf}/4…`, false);
            LOG(`Destino: lista ainda não atualizada após "${descGrupo({ ...g, ids: g.idsAgora })}" – recarregando a Mesa (${q.tentConf}/4)`);
            await S(6000 + 3000 * q.tentConf);
            location.href = '/sipac/protocolo/mesa_virtual/lista.jsf';
            return;
          }
          // continuam todos na 07 e o contador não mudou: o SIPAC não fez → refaz o grupo UMA vez
          if (ainda.length === g.idsAgora.length && !caiu && !q.refeito) {
            LOG(`⚠ Destino: "${descGrupo({ ...g, ids: g.idsAgora })}" não foi feito pelo SIPAC – refazendo uma vez.`);
            q.refeito = true; q.tentConf = 0; q.etapa = 'marcar'; delete q.sucessoVisto; ST.set('filaDest', q);
            continue;
          }
          throw new Error(`não confirmei "${descGrupo(g)}" – ainda na página: ${ainda.join(', ') || 'nenhum'}; 07: ${q.antes07} → ${agora}. Confira na Mesa.`);
        }

        // 3) fim da fila (no modo "todas": examina de novo a página e depois avança)
        if (q.i >= q.grupos.length) {
          if (q.modo !== 'todas') return concluirDestino(q);
          if (porPagina() !== 100) { const ok = await irPara07(1); if (ok === false) return; await cemPorPagina(); }
          const pgT = await irPara07(q.pagina);
          if (pgT === false) return;
          q.pagina = pgT;
          const vis = new Set(q.vistos || []); idsDaPagina().forEach(id => vis.add(id)); q.vistos = [...vis];
          const gp = gruposDestinoDaPagina();
          if (gp.length) {
            q.grupos = gp; q.i = 0; q.etapa = 'marcar'; ST.set('filaDest', q);
            LOG(`Destinar todos – página ${pgT}/${totalPaginas()}: ${gp.map(descGrupo).join(' · ')}`);
            continue;
          }
          if (pgT < (totalPaginas() || 1)) { q.pagina = pgT + 1; q.grupos = []; q.i = 0; ST.set('filaDest', q); continue; }
          return concluirDestino(q);
        }

        // 4) marcar o próximo grupo na página certa
        const pg = await irPara07(q.pagina);
        if (pg === false) return;
        const g = q.grupos[q.i];
        const naPag = new Set(idsDaPagina());
        g.idsAgora = g.ids.filter(id => naPag.has(id) && (rec(id) || {}).st === 'GRAVADO');
        if (!g.idsAgora.length) {
          LOG(`Destino: "${descGrupo(g)}" – nenhum processo na página ${pg}, pulando.`);
          q.i++; ST.set('filaDest', q); continue;
        }
        execBox(`Destino automático ${q.i + 1}/${q.grupos.length}: ${descGrupo({ ...g, ids: g.idsAgora })}…`, false);
        if (!await marcarSoEstes(g.idsAgora)) throw new Error('a contagem de "Itens Selecionados" não bateu');
        q.antes07 = contador07();
        if (g.tipo === 'arquivar') {
          q.etapa = 'tela'; ST.set('filaDest', q);
          const b = $id('menuForm:b_opcao_arquivar_procs') || [...document.querySelectorAll('a')].find(a => /Arquivar Processos Selecionados/.test(a.textContent));
          if (!b) throw new Error('não achei "Arquivar Processos Selecionados"');
          b.click();
          // se a tela abrir aqui mesmo (modal), segue; se a página navegar, o painel retoma ao carregar
          if (await until0(() => { const gv = $id('arquivamentoForm:gavetas'); return gv && gv.offsetParent; }, 10000)) continue;
          return;
        }
        await moverNaJanela(q, g);
        return; // a página recarrega
      }
    }
    async function arquivarNaTela(q) {
      const g = q.grupos[q.i];
      const [mm, aa] = String(g.chave).split('/');
      const gav = $id('arquivamentoForm:gavetas');
      const og = opcao(gav, t => t === aa);
      if (!og) throw new Error(`não achei a gaveta "${aa}" no arquivamento`);
      gav.value = og.value; gav.dispatchEvent(new Event('change', { bubbles: true }));
      let pastas = null, op = null;
      for (let i = 0; i < 30 && !op; i++) {
        await S(400);
        pastas = $id('arquivamentoForm:pastas');
        if (pastas) op = opcao(pastas, t => t.startsWith(mm + ' - PAGAMENTOS'));
      }
      if (!op) throw new Error(`não achei a pasta "${mm} - PAGAMENTOS…" na gaveta ${aa}`);
      pastas.value = op.value; pastas.dispatchEvent(new Event('change', { bubbles: true }));
      await S(700);
      const form = $id('arquivamentoForm');
      const listados = [...new Set([...(txtDe(form).matchAll(/23077\.(\d+)\/2026-(\d+)/g))].map(m => m[1] + '-' + m[2]))];
      const esp = new Set(g.idsAgora);
      if (listados.length !== esp.size || listados.some(id => !esp.has(id)))
        throw new Error(`a tela de arquivamento lista ${listados.join(', ') || 'nada'}, esperado ${g.idsAgora.join(', ')} – NÃO confirmei`);
      const conf = $id('arquivamentoForm:b_arquivar_processo');
      if (!conf) throw new Error('botão Confirmar do arquivamento não encontrado');
      g.pasta = op.text.trim();
      q.etapa = 'confirmado'; ST.set('filaDest', q);
      execBox(`Arquivando ${g.idsAgora.length} em ${aa} / ${g.pasta}…`, false);
      conf.click();
      // O SIPAC pode levar bastante tempo para arquivar muitos processos: NÃO sair da tela enquanto ele trabalha.
      // Se depois de 90 s a tela continuar aqui, lê a mensagem: erro → para; sucesso/sem mensagem → vai conferir na Mesa.
      for (let i = 0; i < 90; i++) {
        await S(1000);
        if (!ST.get('filaDest', null)) return;
        if (i % 10 === 9) execBox(`Arquivando ${g.idsAgora.length} em ${aa} / ${g.pasta}… o SIPAC ainda está processando (${i + 1} s)`, false);
      }
      const msg = [...document.querySelectorAll('.erros li, ul.erros, .rich-messages li, .info li, .alerta')].map(e => e.textContent.replace(/\s+/g, ' ').trim()).filter(Boolean).join(' | ');
      if (msg && !/sucesso/i.test(msg)) throw new Error('o SIPAC não arquivou: "' + msg.slice(0, 200) + '"');
      location.href = '/sipac/protocolo/mesa_virtual/lista.jsf';
    }
    async function moverNaJanela(q, g) {
      const b = [...document.querySelectorAll('a,input,button')].find(e => /Mover Processos Selecionados/.test(e.value || e.textContent));
      if (!b) throw new Error('não achei "Mover Processos Selecionados..."');
      b.click();
      let gav = null, pas = null, op = null;
      if (!await until0(() => (gav = $id('formMoverItensPasta:gavetas')) && gav.offsetParent, 8000)) throw new Error('a janela de mover não abriu');
      const ov = opcao(gav, t => t === 'VIRTUAL');
      if (ov) { gav.value = ov.value; gav.dispatchEvent(new Event('change', { bubbles: true })); }
      for (let i = 0; i < 25 && !op; i++) {
        await S(400);
        pas = $id('formMoverItensPasta:pastas');
        if (pas) op = opcao(pas, t => /^08 - AGUARD/.test(t));
      }
      if (!op) throw new Error('não achei a pasta "08 - AGUARD. DARF E GPS"');
      pas.value = op.value; pas.dispatchEvent(new Event('change', { bubbles: true }));
      await S(600);
      const form = $id('formMoverItensPasta');
      if (!/Pasta origem:\s*07 - PAGOS/.test(txtDe(form).replace(/\s+/g, ' '))) throw new Error('a origem do mover não é 07 - PAGOS – não movi');
      const btMover = [...form.querySelectorAll('input,button,a')].find(e => /^\s*Mover Processos\s*$/.test(e.value || e.textContent));
      if (!btMover) throw new Error('botão "Mover Processos" não encontrado');
      q.etapa = 'confirmado'; ST.set('filaDest', q);
      execBox(`Movendo ${g.idsAgora.length} para a 08…`, false);
      btMover.click();
      // espera o SIPAC terminar (janela fecha, aparece mensagem ou o contador cai) antes de recarregar – máx. 60 s
      await S(3000);
      await until0(() => {
        const c = contador07(), gv = $id('formMoverItensPasta:gavetas');
        return (c != null && q.antes07 != null && c < q.antes07) || !(gv && gv.offsetParent) ||
          /sucesso/i.test((document.body.innerText || '').replace(P.innerText, ''));
      }, 60000);
      await S(2000);
      location.href = '/sipac/protocolo/mesa_virtual/lista.jsf';
    }
    async function concluirDestino(q) {
      ST.del('filaDest'); ST.del('destLock');
      salvarNaPasta('fim do destino'); tirarCopia(true);
      if (q.modo === 'todas') {
        const vis = new Set(q.vistos || []);
        const fora = lista(r => r.st === 'GRAVADO' && !vis.has(r.id)).map(r => r.id);
        ST.set('fora07', fora);
        LOG(`✔ Destinar todos concluído: ${q.feitos.join(' · ') || 'nada'}` + (fora.length ? ` · ${fora.length} detalhado(s) NÃO estão na 07: ${fora.join(', ')}` : ''));
        execBox('');
        prog(`✔ Destinar todos concluído (${q.feitos.length} grupo(s)).` + (fora.length ? ` ⚠ ${fora.length} detalhado(s) não estão mais na 07 – veja a seção 3.` : ''));
        if (UI.som) bip();
        render();
        return;
      }
      LOG(`✔ Destino automático concluído na página ${q.pagina}: ${q.feitos.join(' · ') || 'nada'}`);
      execBox('');
      prog(`✔ Destino concluído (${q.feitos.join(' · ') || 'nada'}). A página ${q.pagina} andou: analisando de novo…`);
      render();
      await S(800);
      if (naMesa() && !ocupado) analisarPagina();
    }

    // ================= ANALISAR VÁRIAS PÁGINAS =================
    let pararAnalise = false, variasRodando = false;
    async function analisarVarias(de, ate) {
      variasRodando = true; pararAnalise = false;
      $id('b-varias').textContent = '■ Parar';
      const tot = { pags: 0 };
      try {
        for (let p = de; p <= ate && !pararAnalise; p++) {
          const tp = totalPaginas();
          if (tp && p > tp) break;
          prog(`Abrindo a página ${p} de ${ate}…`, (p - de) / (ate - de + 1));
          const ok = await irPara07(p);
          if (ok === false) return;
          await analisarPagina();
          tot.pags++;
        }
      } catch (e) { LOG('⚠ Analisar várias: ' + e.message); alert('Analisar várias parou: ' + e.message); }
      finally {
        variasRodando = false;
        $id('b-varias').textContent = '▶ Analisar várias';
        const all = lista();
        prog(`${pararAnalise ? 'Parado' : 'Concluído'}: ${tot.pags} página(s) analisada(s) · ${all.filter(r => r.st === 'PRONTO').length} pronto(s) · ${all.filter(r => r.st === 'PENDENTE').length} pendência(s).`);
        LOG(`Analisar várias: ${tot.pags} página(s) (${de} a ${ate})${pararAnalise ? ' – parado por você' : ''}.`);
        render();
      }
    }
    $id('b-varias').onclick = () => {
      if (variasRodando) { pararAnalise = true; $id('b-varias').textContent = 'Parando…'; return; }
      if (!naMesa()) return alert('Abra a Mesa Virtual na 07 - PAGOS.');
      if (ocupado || atual || ST.get('filaDest', null)) return alert('Espere o que está em andamento terminar.');
      const de = Math.max(1, +$id('sdl-pde').value || 1);
      const ate = Math.max(de, +$id('sdl-pate').value || totalPaginas() || de);
      if (ate - de >= 4 && !confirm(`Analisar ${ate - de + 1} páginas (${de} a ${ate})? Leva uns minutos (só leitura). Dá para parar no meio.`)) return;
      analisarVarias(de, ate);
    };

    // Quantidade mostrada ao lado da pasta "07 - PAGOS" no menu da Mesa
    const contador07 = () => {
      const id = idPasta07();
      if (id != null) {
        const n = [...document.querySelectorAll('[onclick*="atualizarPasta(' + id + ')"]')]
          .map(e => (e.textContent || '').trim()).find(t => /^\d+$/.test(t));
        if (n != null) return +n;
      }
      const l = txtDe(document.body).split('\n').map(x => x.trim());
      const i = l.findIndex(x => /^07 - PAGOS$/.test(x));
      if (i < 0) return null;
      const n = l.slice(i + 1, i + 3).find(x => /^\d+$/.test(x));
      return n == null ? null : +n;
    };

    async function moverDarf() {
      try { await moverDarf2(); }
      catch (e) { LOG('⚠ Erro ao preparar o mover: ' + e.message); execBox('⚠ Erro ao preparar o mover para a 08: ' + e.message + '. Mova manualmente.', false); }
    }
    async function moverDarf2() {
      if (!naMesa()) return;
      execBox('Abrindo a janela de mover…', false);
      const naPag = new Set(idsDaPagina());
      const alvos = lista(r => r.st === 'GRAVADO' && tipo(r) === 'DARF' && naPag.has(r.id));
      if (!alvos.length) return alert('Nenhum DARF/INSS detalhado nesta página.');
      const m = await marcarSo(alvos);
      if (m.erro) return alert(m.erro);
      const b = [...document.querySelectorAll('a,input,button')].find(e => /Mover Processos Selecionados/.test(e.value || e.textContent));
      if (!b) return alert('Não achei "Mover Processos Selecionados..." na Mesa.');
      b.click();

      let gav = null, pas = null, op = null;
      if (!await until(() => (gav = $id('formMoverItensPasta:gavetas')) && gav.offsetParent, 8000))
        return execBox('⚠ A janela de mover não abriu. Mova manualmente.', false);
      const ov = opcao(gav, t => t === 'VIRTUAL');
      if (ov) { gav.value = ov.value; gav.dispatchEvent(new Event('change', { bubbles: true })); }
      for (let i = 0; i < 25 && !op; i++) {
        await S(400);
        pas = $id('formMoverItensPasta:pastas');
        if (pas) op = opcao(pas, t => /^08 - AGUARD/.test(t));
      }
      if (!op) return execBox('⚠ Não achei a pasta "08 - AGUARD. DARF E GPS". Escolha manualmente.', false);
      pas.value = op.value; pas.dispatchEvent(new Event('change', { bubbles: true }));
      await S(600);

      const form = $id('formMoverItensPasta');
      const origemOk = /Pasta origem:\s*07 - PAGOS/.test(txtDe(form).replace(/\s+/g, ' '));
      const btMover = form && [...form.querySelectorAll('input,button,a')].find(e => /^\s*Mover Processos\s*$/.test(e.value || e.textContent));
      execBox(`Mover para a 08 pronto para conferir:\n${m.marcados.length} processo(s): ${m.marcados.join(', ')}\n` +
        (origemOk ? 'Origem: 07 - PAGOS ✔' : '⚠ Não confirmei a pasta de origem (07 - PAGOS) – confira!') +
        '\nClique em "Mover Processos" (destacado).', false);
      if (btMover) {
        destacar(btMover);
        const antes = contador07();
        btMover.addEventListener('click', async () => {
          // a lista só atualiza depois de recarregar: guarda o pedido e confere o contador da 07 na volta
          ST.set('acao', { tipo: 'mover', ids: m.marcados, antes07: antes, t: Date.now() });
          execBox('Movendo… a página vai recarregar para conferir.', false);
          await S(9000);
          location.reload();
        }, { once: true });
      } else execBox('⚠ Não achei o botão "Mover Processos". Mova manualmente.', false);
    }

    // Depois de confirmar o arquivamento, a página recarrega: registra o resultado
    function conferirAcaoPendente() {
      const ac = ST.get('acao', null);
      if (!ac) return;
      const gav = $id('arquivamentoForm:gavetas');
      if (gav && gav.offsetParent) { prepararArquivamento(); return; }
      if (ac.tipo === 'mover') {
        const agora = contador07();
        if (ac.antes07 != null && agora != null && ac.antes07 - agora >= ac.ids.length) {
          ac.ids.forEach(id => salvar(id, { st: 'MOVIDO', motivo: 'movido para a 08' }));
          LOG(`Movidos para a 08: ${ac.ids.join(', ')} (07: ${ac.antes07} → ${agora})`);
          prog(`✔ ${ac.ids.length} movido(s) para a 08. A Mesa voltou à 1ª página: volte para a página em que estava.`);
        } else LOG(`⚠ Não confirmei a movimentação para a 08 (07: ${ac.antes07} → ${agora}). Confira na Mesa.`);
        ST.del('acao');
        return;
      }
      if (ac.tipo === 'arquivar' && ac.confirmado) {
        if (/sucesso/i.test(txtDe(document.body))) {
          ac.ids.forEach(id => salvar(id, { st: 'ARQUIVADO', motivo: 'arquivado em ' + (ac.pasta || nomeMes(ac.chave)) }));
          LOG(`Arquivados em ${ac.pasta}: ${ac.ids.join(', ')}`);
          prog(`✔ ${ac.ids.length} arquivado(s) em ${ac.pasta}. A lista andou: analise a mesma página de novo.`);
        } else LOG('⚠ Não vi a mensagem de sucesso do arquivamento. Confira na Mesa.');
        ST.del('acao');
      } else if (Date.now() - ac.t > 15 * 60000) ST.del('acao');
    }

    // ================= AÇÕES DAS LINHAS / DESTINOS =================
    // ================= ANOTAÇÃO NO PROCESSO =================
    // Texto padrão: NS só em lista → frase usada pelo setor; demais pendências → o motivo.
    const textoNotaPadrao = r => /LISTA do SIAFI/i.test(r.motivo || '')
      ? 'Nota do sistema sem informações cadastrar nova nota'
      : ('Pendência no detalhamento: ' + String(r.motivo || '').replace(/\s+/g, ' ')).slice(0, 200);

    function pedirNota(id) {
      const r = rec(id);
      if (!r) return;
      const proc = `23077.${r.num}/${ANO}-${r.dv}`;
      let txt = prompt(`Anotação PÚBLICA no processo ${proc} (até 200 caracteres).\nEdite se quiser:`, textoNotaPadrao(r));
      if (txt == null) return;
      txt = txt.replace(/\s+/g, ' ').trim().slice(0, 200);
      if (!txt) return;
      if (naProcesso() && idProcessoAberto() === id) return cadastrarNotaAqui(id, txt, true);
      if (!naMesa() || !linkDe(id)) return alert(`Abra a Mesa Virtual na página onde está o ${proc} (ou abra o processo) e clique em Anotar de novo.`);
      ST.set('nota', { id, texto: txt, t: Date.now() });
      LOG(`📝 ${id}: abrindo o processo em nova aba para anotar.`);
      toast('Abrindo o processo em nova aba para anotar…');
      abrirProcesso(id);
    }

    // Na tela do processo: abre "Cadastrar/Visualizar Anotações", preenche, marca Pública e cadastra
    async function cadastrarNotaAqui(id, texto, jaConfirmado) {
      const proc = id.replace('-', '/' + ANO + '-');
      try {
        const lk = $id('menuForm:visualizarNotasProcesso');
        if (!lk) throw new Error('link "Cadastrar/Visualizar Anotações" não encontrado');
        const ta = () => $id('formVisualizaNotasProcesso:textoNota');
        const cont = () => $id('panelVisualizaNotasProcessoContainer');
        if (!(ta() && ta().getClientRects().length)) lk.click();
        if (!await until0(() => ta() && ta().getClientRects().length, 10000)) throw new Error('a janela de anotações não abriu');
        await S(400);
        const jaTem = () => norm(cont() ? cont().innerText : '').includes(norm(texto));
        if (jaTem()) {
          salvar(id, { notaEm: new Date().toLocaleString('pt-BR'), nota: texto });
          LOG(`📝 ${id}: o processo já tinha essa anotação – nada a cadastrar.`);
          toast('Esse processo já tem essa anotação.');
          return;
        }
        ta().value = texto;
        ta().dispatchEvent(new KeyboardEvent('keyup', { bubbles: true }));
        const pub = $id('formVisualizaNotasProcesso:restricaoNotaProcesso:0');
        if (pub && !pub.checked) pub.click();
        const bt = $id('b_mover');
        if (!bt || !/Cadastrar/i.test(bt.value)) throw new Error('botão Cadastrar não encontrado');
        bt.classList.add('sdl-alvo');
        if (!jaConfirmado && !confirm(`Cadastrar anotação PÚBLICA no processo 23077.${proc}?\n\n“${texto}”`)) {
          LOG(`📝 ${id}: anotação preenchida, não cadastrada (cancelado).`);
          return;
        }
        bt.classList.remove('sdl-alvo');
        bt.click();
        const suc = () => { const m = $id('panelMensagemSucessoContainer'); return m && m.getClientRects().length; };
        if (!await until0(() => suc() || jaTem(), 10000)) throw new Error('não vi a anotação na lista depois de cadastrar – confira');
        salvar(id, { notaEm: new Date().toLocaleString('pt-BR'), nota: texto });
        LOG(`📝 ${id}: anotação pública cadastrada – “${texto}”`);
        toast('✔ Anotação cadastrada');
      } catch (e) {
        LOG(`⚠ ${id}: anotação – ${e.message}`);
        alert('Anotação: ' + e.message);
      } finally {
        ST.del('nota');
        agendarRender();
      }
    }
    async function until0(fn, ms) {
      for (let i = 0; i < ms / 300; i++) { try { if (fn()) return true; } catch (e) {} await S(300); }
      return false;
    }
    // Aba aberta pelo botão Anotar: cadastra assim que o processo carregar
    function conferirNotaPendente() {
      const n = ST.get('nota', null);
      if (!n || !naProcesso()) return;
      if (Date.now() - n.t > 5 * 60000) { ST.del('nota'); return; }
      const ab = idProcessoAberto();
      if (ab !== n.id) { LOG(`⚠ anotação: a aba abriu ${ab || '?'} em vez de ${n.id} – não cadastrei.`); ST.del('nota'); return; }
      cadastrarNotaAqui(n.id, n.texto, true);
    }

    function abrirProcesso(id) {
      const a = naMesa() && linkDe(id);
      const form = $id('menuForm');
      if (a && form) {
        const antes = form.target;
        form.target = '_blank';
        try { a.click(); } finally { setTimeout(() => { form.target = antes; }, 800); }
      } else {
        window.open(urlPDF(id.split('-')[0]), '_blank');
      }
    }

    P.addEventListener('change', e => {
      const sel = e.target.closest('select[data-rev]');
      if (!sel) return;
      const id = sel.dataset.rev, v = sel.value;
      salvar(id, { rev: v, revEm: new Date().toLocaleString('pt-BR') });
      LOG(`🗂 ${id}: revisão → ${REV[v]}`);
      toast(v === 'resolvido' ? 'Resolvido → foi para o Histórico' : v === 'aver' ? 'Voltou para Pendências' : `${REV[v]} → está na aba Em revisão`);
    });
    P.addEventListener('toggle', e => {
      const d = e.target;
      if (!d.matches || !d.matches('details[data-grp]')) return;
      try {
        const o = JSON.parse(localStorage.getItem('sdl-grp') || '{}');
        o[d.dataset.grp] = d.open;
        localStorage.setItem('sdl-grp', JSON.stringify(o));
      } catch (er) {}
    }, true);
    P.addEventListener('click', async e => {
      const sc = e.target.closest('[data-sub]');
      if (sc) { subRev = sc.dataset.sub; render(); return; }
      const cp = e.target.closest('[data-copia]');
      if (cp) {
        const v = cp.dataset.copia;
        try { await navigator.clipboard.writeText(v); toast('Copiado: ' + v); }
        catch (er) { prompt('Copie o número:', v); }
        return;
      }
      const b = e.target.closest('button[data-a]');
      if (!b) return;
      const id = b.dataset.id;
      const a = b.dataset.a;
      if (a === 'abrir') abrirProcesso(id);
      else if (a === 'pdf') window.open(urlPDF(id.split('-')[0]), '_blank');
      else if (a === 'ignorar') { salvar(id, { st: 'IGNORADO', motivo: 'ignorado por você · ' + (rec(id).motivo || '') }); }
      else if (a === 'reanalisar') {
        if (ocupado || atual) return alert('Espere a análise/detalhamento atual terminar.');
        ocupado = true;
        try { await triarUm(id); } finally { ocupado = false; render(); }
        const r = rec(id);
        prog(r.st === 'PRONTO' ? `✔ ${id} agora está pronto para detalhar.` : `⚠ ${id} continua com pendência: ${r.motivo}`);
      }
      else if (a === 'arquivar') iniciarDestino(gruposDestinoDaPagina().filter(g => g.tipo === 'arquivar' && g.chave === b.dataset.mes));
      else if (a === 'dest-tudo') iniciarDestino(gruposDestinoDaPagina());
      else if (a === 'dest-todos') iniciarDestinoTodos();
      else if (a === 'fora-ver') { filtro = 'card:FORA'; marcarAba(); render(); }
      else if (a === 'fora-ok') {
        const ids = ST.get('fora07', []).filter(i => (rec(i) || {}).st === 'GRAVADO');
        if (!ids.length || !confirm(`Marcar ${ids.length} processo(s) como já destinados (eles não estão mais na 07)?\n${ids.join(', ')}\n\nSIMPLES/ISS ficam como Arquivado e DARF/INSS como Na 08, com o aviso "conferir".`)) return;
        ids.forEach(i => { const r = rec(i); salvar(i, tipo(r) === 'SIMPLES'
          ? { st: 'ARQUIVADO', motivo: 'não está mais na 07 – arquivamento feito fora do painel (conferir)', destinoEm: new Date().toLocaleString('pt-BR'), destinoTs: Date.now() }
          : { st: 'MOVIDO', motivo: 'não está mais na 07 – movido fora do painel (conferir)', destinoEm: new Date().toLocaleString('pt-BR'), destinoTs: Date.now() }); });
        ST.set('fora07', []);
        LOG(`Marcados como já destinados (fora da 07): ${ids.join(', ')}`);
      }
      else if (a === 'resumo') {
        const t = textoResumoDia(lista());
        try { await navigator.clipboard.writeText(t); toast('Resumo copiado – é só colar no WhatsApp/e-mail'); }
        catch (er) { prompt('Copie o resumo:', t); }
      }
      else if (a === 'bk-agora') baixarBackup('');
      else if (a === 'bk-pasta') escolherPasta();
      else if (a === 'bk-permitir') permitirPasta();
      else if (a === 'dest-cont') { const q = ST.get('filaDest', null); if (q) { q.tentConf = 0; q.t = Date.now(); ST.set('filaDest', q); } ST.del('destLock'); passoDestino(); }
      else if (a === 'dest-canc') { if (confirm('Cancelar o destino automático? (o que já foi feito continua feito)')) { ST.del('filaDest'); ST.del('destLock'); LOG('Destino automático cancelado.'); execBox(''); render(); } }
      else if (a === 'mover') iniciarDestino(gruposDestinoDaPagina().filter(g => g.tipo === 'mover'));
      else if (a === 'anotar') pedirNota(id);
      else if (a === 'minha') {
        const r = rec(id);
        const t = prompt(`Sua nota sobre 23077.${r.num}/${ANO}-${r.dv} (fica só no painel e no backup).\nDeixe vazio para apagar:`, r.revNota || '');
        if (t == null) return;
        const v = t.trim();
        salvar(id, Object.assign({ revNota: v, revEm: new Date().toLocaleString('pt-BR') }, v && revDe(r) === 'aver' ? { rev: 'vendo' } : {}));
        if (v && revDe(r) === 'aver') toast('Nota salva → está na aba Em revisão');
      }
    });

    // ================= RELATÓRIO / LIMPAR =================
    $id('b-csv').onclick = () => {
      const cols = ['processo', 'situacao', 'tipo', 'destino', 'motivo', 'valor', 'caso', 'req', 'ne', 'ob', 'obData', 'obValor', 'dar', 'darData', 'darValor', 'sobra', 'data', 'pagina', 'gravadoEm', 'nota', 'notaEm', 'naoTerminado', 'paradaEm', 'tentEm', 'categoria', 'revisao', 'minhaNota', 'detalhamentos'];
      const linhas = lista().map(r => ({
        processo: `23077.${r.num}/${ANO}-${r.dv}`, situacao: (ROT[r.st] || [r.st])[0],
        tipo: nomeTipo(r),
        destino: ['GRAVADO', 'PRONTO'].includes(r.st) ? destino(r) : '',
        motivo: r.motivo, valor: r.valor, caso: r.caso, req: r.req, ne: r.ne, ob: r.ob,
        obData: r.obData, obValor: r.obValor, dar: r.dar, darData: r.darData, darValor: r.darValor, sobra: r.sobra, data: r.data, pagina: r.pagina, gravadoEm: r.gravadoEm, nota: r.nota, notaEm: r.notaEm, naoTerminado: naoTerminado(r) ? 'sim' : '', paradaEm: r.tentEtapa, tentEm: r.tentEm, categoria: r.st === 'PENDENTE' ? categoria(r) : '', revisao: r.rev ? REV[r.rev] : (r.st === 'PENDENTE' ? REV.aver : ''), minhaNota: r.revNota,
        detalhamentos: r.partes ? r.partes.map(q => `${q.feito ? (q.externo ? 'JA-LIQ' : 'OK') : '--'} req ${q.req} R$ ${q.valor} OB R$ ${q.obValor}`).join(' | ') : ''
      }));
      const csv = [cols.join(';')].concat(linhas.map(r => cols.map(c => String(r[c] == null ? '' : r[c]).replace(/[;\n]/g, ',')).join(';'))).join('\n');
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob(['\ufeff' + csv], { type: 'text/csv' }));
      a.download = 'detalhar-despesas-' + new Date().toISOString().slice(0, 10) + '.csv';
      a.click();
    };
    // ---- backup (arquivo .json no computador) ----
    const lerBk = () => { try { return JSON.parse(localStorage.getItem('sdl-backup') || 'null'); } catch (e) { return null; } };
    function indicadorBackup(all) {
      const el = $id('sdl-bk');
      if (!el) return;
      const b = lerBk();
      const mudou = all.filter(r => (r.atualizado || 0) > (b ? b.t : 0)).length;
      const dias = b ? (Date.now() - b.t) / 864e5 : Infinity;
      const pend = all.filter(r => r.st === 'PENDENTE' || r.revNota).length;
      const quando = b ? new Date(b.t).toLocaleString('pt-BR').replace(/:\d{2}$/, '') : '';
      if (BK.dir && BK.ok && !BK.erro) {
        el.innerHTML = esc(`💾 Backup automático em 📁 ${BK.dir.name}` + (b ? ` · último: ${quando}` : '') + (mudou ? ` · ${mudou} alteração(ões) a salvar` : ' ✔'));
        el.classList.remove('alerta');
        return;
      }
      if (BK.dir) {
        el.innerHTML = esc(BK.erro && BK.ok ? `⚠ Backup na pasta ${BK.dir.name} falhou: ${BK.erro}` : `⚠ Backup automático pausado: o Chrome pede permissão para a pasta ${BK.dir.name}`) +
          ' <button class="mini" data-a="bk-permitir" style="margin-left:4px">Permitir</button>';
        el.classList.add('alerta');
        return;
      }
      const alerta = !!pend && !!mudou && (dias > 1 || !b || pendenteDeOntem(all, b));
      el.innerHTML = esc((b ? `💾 Último backup: ${quando}` : '💾 Nenhum backup feito ainda') +
        (mudou ? ` · ${mudou} alteração(ões) depois dele` : ' · em dia')) +
        ' <button class="mini" data-a="bk-pasta" style="margin-left:4px">📁 Ativar backup automático</button>' +
        (alerta ? ' <button class="mini" data-a="bk-agora">Baixar agora</button>' : '');
      el.classList.toggle('alerta', alerta);
    }
    // Trabalho de um dia anterior que ficou sem backup
    function pendenteDeOntem(all, b) {
      const hoje0 = new Date(); hoje0.setHours(0, 0, 0, 0);
      return all.some(r => (r.atualizado || 0) > (b ? b.t : 0) && (r.atualizado || 0) < hoje0.getTime());
    }
    function lembrarBackupAoAbrir() {
      if (BK.dir) { if (!BK.ok) toast('💾 Clique em "Permitir" (rodapé do painel) para o backup automático voltar a salvar na pasta.'); return; }
      const all = lista(), b = lerBk();
      if (!all.length || !pendenteDeOntem(all, b)) return;
      let jaAvisou = '';
      try { jaAvisou = localStorage.getItem('sdl-bk-aviso') || ''; } catch (e) {}
      const hoje = new Date().toLocaleDateString('pt-BR');
      if (jaAvisou === hoje) return;
      try { localStorage.setItem('sdl-bk-aviso', hoje); } catch (e) {}
      if (UI.mini) definirMini(false);
      if (confirm('O trabalho do último dia ficou sem backup.\nBaixar o arquivo de backup agora?')) baixarBackup('');
    }
    const dadosBackup = () => ({ app: 'sipac-detalhar-lote', versao: VERSAO, geradoEm: new Date().toISOString(),
      proc: todos(), log: ST.get('log', []), ui: UI });
    const marcarBackup = onde => { try { localStorage.setItem('sdl-backup', JSON.stringify({ t: Date.now(), onde })); } catch (e) {} };
    function baixarBackup(sufixo) {
      const dados = dadosBackup();
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([JSON.stringify(dados, null, 1)], { type: 'application/json' }));
      const d = new Date(), z = n => String(n).padStart(2, '0');
      a.download = `sipac-detalhar-backup-${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}_${z(d.getHours())}h${z(d.getMinutes())}${sufixo || ''}.json`;
      document.body.appendChild(a); a.click(); a.remove();
      marcarBackup('download');
      LOG(`💾 Backup baixado (${Object.keys(dados.proc).length} processos).`);
      render();
    }
    // ================= BACKUP AUTOMÁTICO (pasta) + CÓPIAS INTERNAS (IndexedDB) =================
    const IDB = (() => {
      let p = null;
      const abrir = () => p || (p = new Promise((ok, er) => {
        const r = indexedDB.open('sdl-backup', 1);
        r.onupgradeneeded = () => r.result.createObjectStore('kv');
        r.onsuccess = () => ok(r.result); r.onerror = () => er(r.error);
      }));
      const tx = async (modo, fn) => { const db = await abrir(); return new Promise((ok, er) => { const t = db.transaction('kv', modo); const st = t.objectStore('kv'); const rq = fn(st); t.oncomplete = () => ok(rq && rq.result); t.onerror = () => er(t.error); }); };
      return {
        get: k => tx('readonly', st => st.get(k)),
        set: (k, v) => tx('readwrite', st => st.put(v, k)),
        del: k => tx('readwrite', st => st.delete(k)),
        keys: () => tx('readonly', st => st.getAllKeys())
      };
    })();
    const BK = { dir: null, ok: false, erro: '', snaps: [] };
    const hojeISO = () => { const d = new Date(), z = n => String(n).padStart(2, '0'); return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}`; };
    const mudouDesde = t => lista().some(r => (r.atualizado || 0) > (t || 0));

    async function carregarPasta() {
      try {
        BK.dir = await IDB.get('dir') || null;
        BK.ok = !!(BK.dir && (await BK.dir.queryPermission({ mode: 'readwrite' })) === 'granted');
      } catch (e) { BK.ok = false; }
      render();
    }
    async function escolherPasta() {
      if (!window.showDirectoryPicker) return alert('Este navegador não deixa escolher pasta. Use o Chrome atualizado (ou "Baixar arquivo").');
      try {
        const h = await window.showDirectoryPicker({ id: 'sipac-backup', mode: 'readwrite', startIn: 'documents' });
        await IDB.set('dir', h);
        BK.dir = h; BK.ok = true; BK.erro = '';
        LOG(`📁 Pasta de backup: ${h.name}`);
        await salvarNaPasta('pasta escolhida');
      } catch (e) { if (e && e.name !== 'AbortError') alert('Não consegui usar essa pasta: ' + e.message); }
      render();
    }
    async function permitirPasta() {
      if (!BK.dir) return escolherPasta();
      try { BK.ok = (await BK.dir.requestPermission({ mode: 'readwrite' })) === 'granted'; } catch (e) { BK.ok = false; }
      if (BK.ok) { BK.erro = ''; await salvarNaPasta('permissão concedida'); }
      render();
    }
    let salvando = false;
    async function salvarNaPasta(motivo) {
      if (!BK.dir || !BK.ok || salvando) return false;
      salvando = true;
      try {
        const fh = await BK.dir.getFileHandle(`sipac-backup-${hojeISO()}.json`, { create: true });
        const w = await fh.createWritable();
        await w.write(JSON.stringify(dadosBackup(), null, 1));
        await w.close();
        marcarBackup('pasta');
        BK.erro = '';
        if (motivo && motivo !== 'auto') LOG(`💾 Backup salvo em ${BK.dir.name} (${motivo}).`);
        return true;
      } catch (e) {
        BK.erro = e.message || String(e);
        if (/permission|NotAllowed/i.test(BK.erro)) BK.ok = false;
        LOG('⚠ Backup na pasta falhou: ' + BK.erro);
        return false;
      } finally { salvando = false; render(); }
    }
    async function salvarBackupAgora() {
      if (BK.dir && !BK.ok) await permitirPasta();
      if (BK.dir && BK.ok) { if (await salvarNaPasta('manual')) toast('💾 Backup salvo em ' + BK.dir.name); }
      else baixarBackup('');
      await tirarCopia(true);
    }

    // Cópias internas: uma por dia (atualizada a cada 10 min se houve mudança), guarda os 7 dias mais recentes
    async function tirarCopia(forcar) {
      try {
        const k = 'snap:' + hojeISO();
        const ult = +(localStorage.getItem('sdl-snapT') || 0);
        if (!forcar && (!mudouDesde(ult) || Date.now() - ult < 10 * 60000)) return;
        await IDB.set(k, { t: Date.now(), dados: JSON.stringify(dadosBackup()) });
        try { localStorage.setItem('sdl-snapT', String(Date.now())); } catch (e) {}
        const ks = (await IDB.keys()).filter(x => /^snap:\d{4}-\d{2}-\d{2}$/.test(x)).sort().reverse();
        for (const velho of ks.slice(7)) await IDB.del(velho);
        await listarCopias();
      } catch (e) { /* IndexedDB indisponível: segue sem cópia */ }
    }
    async function listarCopias() {
      try {
        const ks = (await IDB.keys()).filter(x => /^snap:/.test(x)).sort().reverse();
        const itens = [];
        for (const k of ks) { const v = await IDB.get(k); if (v) itens.push({ k, t: v.t, n: (() => { try { return Object.keys(JSON.parse(v.dados).proc).length; } catch (e) { return '?'; } })() }); }
        BK.snaps = itens;
        const sel = $id('sdl-snaps');
        if (sel) sel.innerHTML = itens.length ? itens.map(i => `<option value="${esc(i.k)}">${i.k === 'snap:antes-restaurar' ? 'Antes da última restauração' : i.k.slice(5).split('-').reverse().join('/')} · ${new Date(i.t).toLocaleTimeString('pt-BR').slice(0, 5)} · ${i.n} processos</option>`).join('')
          : '<option value="">(nenhuma cópia ainda)</option>';
      } catch (e) {}
    }
    async function restaurarCopia() {
      const k = $id('sdl-snaps').value;
      if (!k) return;
      const v = await IDB.get(k);
      if (!v) return alert('Cópia não encontrada.');
      const d = JSON.parse(v.dados);
      if (!confirm(`Voltar o painel para a cópia de ${new Date(v.t).toLocaleString('pt-BR')} (${Object.keys(d.proc).length} processos)?\n\n` +
        `O estado atual é guardado antes em "Antes da última restauração" – dá para desfazer.`)) return;
      await IDB.set('snap:antes-restaurar', { t: Date.now(), dados: JSON.stringify(dadosBackup()) });
      ST.set('proc', d.proc);
      if (Array.isArray(d.log)) ST.set('log', d.log);
      LOG(`🕘 Painel restaurado da cópia de ${new Date(v.t).toLocaleString('pt-BR')}.`);
      $id('sdl-log').textContent = ST.get('log', []).join('\n');
      await listarCopias();
      render();
    }

    // Gatilhos automáticos
    setInterval(() => {
      const b = lerBk();
      if (BK.ok && mudouDesde(b && b.t) && Date.now() - ((b && b.t) || 0) > 30 * 60000) salvarNaPasta('auto');
      tirarCopia(false);
    }, 60000);
    const aoSair = () => { const b = lerBk(); if (BK.ok && mudouDesde(b && b.t)) salvarNaPasta('auto'); };
    addEventListener('pagehide', aoSair);
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') aoSair(); });

    $id('b-backup').onclick = () => salvarBackupAgora();
    $id('b-baixar').onclick = () => baixarBackup('');
    $id('b-pasta').onclick = () => escolherPasta();
    $id('b-snap').onclick = () => restaurarCopia();
    $id('sdl-bkcfg').addEventListener('toggle', () => { if ($id('sdl-bkcfg').open) listarCopias(); });
    $id('b-restaurar').onclick = () => $id('sdl-arq').click();
    $id('sdl-arq').onchange = async e => {
      const f = e.target.files && e.target.files[0];
      e.target.value = '';
      if (!f) return;
      let d;
      try { d = JSON.parse(await f.text()); } catch (er) { return alert('Arquivo inválido: ' + er.message); }
      if (!d || d.app !== 'sipac-detalhar-lote' || typeof d.proc !== 'object') return alert('Esse arquivo não é um backup do painel.');
      const P0 = todos();
      let novos = 0, atualizados = 0, notas = 0;
      Object.keys(d.proc).forEach(id => {
        const b = d.proc[id], a = P0[id];
        if (!a) { P0[id] = b; novos++; return; }
        // fica o registro mais recente; notas e revisão do backup entram se aqui não houver
        if ((b.atualizado || 0) > (a.atualizado || 0)) { P0[id] = Object.assign({}, a, b); atualizados++; }
        ['rev', 'revNota', 'revEm', 'nota', 'notaEm'].forEach(k => { if (b[k] && !P0[id][k]) { P0[id][k] = b[k]; notas++; } });
      });
      if (!confirm(`Backup de ${d.geradoEm ? new Date(d.geradoEm).toLocaleString('pt-BR') : '?'} com ${Object.keys(d.proc).length} processos.\n` +
        `Vai juntar: ${novos} novo(s), ${atualizados} mais recente(s) no backup, ${notas} nota(s)/revisão(ões) recuperada(s).\nNada que está aqui será apagado. Continuar?`)) return;
      ST.set('proc', P0);
      if (Array.isArray(d.log)) ST.set('log', ST.get('log', []).concat(d.log.filter(l => !ST.get('log', []).includes(l))).slice(0, 300));
      LOG(`⤒ Backup restaurado: ${novos} novo(s), ${atualizados} atualizado(s), ${notas} nota(s).`);
      $id('sdl-log').textContent = ST.get('log', []).join('\n');
      render();
    };

    // ---- limpar: por padrão mantém o caderno de pendências e as suas notas ----
    $id('b-limpar').onclick = () => {
      const r = prompt('Limpar dados do painel neste navegador.\n\n' +
        '1 = limpar a ANÁLISE, mantendo pendências abertas, notas e revisões (recomendado)\n' +
        '2 = limpar também o Histórico (concluídos)\n' +
        'APAGAR = apagar TUDO\n\nUm backup é baixado antes. Digite 1, 2 ou APAGAR:', '1');
      if (r == null) return;
      const op = r.trim().toUpperCase();
      if (!['1', '2', 'APAGAR'].includes(op)) return alert('Nada foi apagado.');
      baixarBackup('_antes-de-limpar');
      if (op === 'APAGAR') ['proc', 'log', 'acao'].forEach(ST.del);
      else {
        const P0 = todos(), fica = {};
        Object.keys(P0).forEach(id => {
          const x = P0[id];
          const caderno = x.st === 'PENDENTE' || x.revNota || x.rev;
          const hist = noHist(x);
          if (caderno || (op === '1' && hist)) fica[id] = x;
        });
        ST.set('proc', fica);
        ST.del('acao');
      }
      $id('sdl-log').textContent = ST.get('log', []).join('\n');
      prog('Dados limpos.');
      render();
    };

    // v0.17: pendências antigas de empenho ganham o texto novo (com o nº do empenho)
    (() => {
      const P0 = todos(); let n = 0;
      Object.keys(P0).forEach(id => {
        const r = P0[id], m = String(r.motivo || '');
        if (r.st !== 'PENDENTE' || /^EMPENHO (NÃO CADASTRADO|JÁ LIQUIDADO)/.test(m)) return;
        const sp = (m.match(/SIPAC: "([^"]*(Empenho não cadastrado|empenho já foi totalmente liquidado)[^"]*)"/i) || [])[1];
        if (!sp) return;
        r.motivo = textoErroEmpenho(r.ne, r.neAno, sp, r.neFonte); n++;
      });
      if (n) { ST.set('proc', P0); LOG(`Pendências de empenho atualizadas para o texto novo: ${n}.`); }
    })();

    // ================= INÍCIO =================
    aplicarLayout();
    render();
    setTimeout(conferirAcaoPendente, 1500);
    setTimeout(conferirNotaPendente, 1800);
    setTimeout(() => { if (ST.get('filaDest', null)) passoDestino(); }, 1500);
    carregarPasta().then(() => {
      tirarCopia(false);
      setTimeout(() => { if (!ST.get('filaDest', null) && !ST.get('nota', null)) lembrarBackupAoAbrir(); }, 2000);
    });
    setTimeout(() => { const tp = naMesa() && totalPaginas(); if (tp && !$id('sdl-pate').value) $id('sdl-pate').value = Math.min(tp, 5); }, 1200);
  }

  if (document.readyState === 'complete' || document.readyState === 'interactive') iniciarPainel();
  else window.addEventListener('DOMContentLoaded', iniciarPainel);
})();