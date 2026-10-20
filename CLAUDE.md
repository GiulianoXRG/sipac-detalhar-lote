# SIPAC – Detalhar Despesas em lote (contexto para o Claude Code)

Userscript do Tampermonkey (`sipac-detalhar-lote.user.js`, um arquivo só) usado no
**Setor de Execução Orçamentária do CCS/UFRN (15.31)** para detalhar despesas de processos pagos no
SIPAC, a partir da Mesa Virtual, pasta **07 - PAGOS**. Responder em português, curto: resultados e problemas.

## Regras de trabalho (obrigatórias)
- **Nunca** gravar detalhamento, arquivar, mover, anotar ou clicar em SAIR / Alterar Senha / Enviar Processo /
  Diligência no SIPAC real sem o usuário pedir e acompanhar. Testes no SIPAC real são **só leitura**
  (abrir telas, preencher sem gravar, sair por "<< Voltar"/"Cancelar").
- Nunca digitar senha. Tela de login (`autenticacao.ufrn.br/sso-server`) → parar e avisar.
- Toda mudança no script: subir `@version` (cabeçalho **e** o `<small>vX</small>` do painel **e** a constante `VERSAO` em `iniciarPainel`),
  `npm run check` (node --check) e `npm test` (Mesa simulada com Playwright). Atualizar o CHANGELOG.md.
- O Tampermonkey se atualiza pelo `@updateURL` (raw do GitHub, branch `main`). Publicar = commit + push na `main`.
- Repositório **público**: nunca registrar aqui números reais de processos, CNPJs, nomes de favorecidos, de servidores
  ou de computadores. Usar exemplos fictícios (testes usam 9001xx-xx / 1000xx-xx). Detalhes reais e locais ficam em
  `CLAUDE.local.md` (fora do git, só no computador do usuário).

## Arquitetura do script
- `@grant none` (roda no contexto da página: precisa de `window.A4J`, `atualizarPasta`, `mudarPagina`, componentes RichFaces).
  Não trocar para GM_* sem motivo forte. Não roda em iframes (`window.top !== window`).
- Estado no `localStorage` (prefixo `sdl2_`): `proc` (um registro por processo, chave `"numero-dv"`), `log`,
  `filaDest` (destino automático em andamento), `nota` (anotação pendente), `acao` (fluxo antigo).
  Preferências: `sdl-ui`, `sdl-backup` ({t, onde}), `sdl-grp`, `sdl-bk-aviso`, `sdl-snapT`.
- Backup: IndexedDB `sdl-backup`/store `kv`: `dir` (FileSystemDirectoryHandle da pasta escolhida) e `snap:AAAA-MM-DD` / `snap:antes-restaurar`
  ({t, dados}). Pasta via File System Access API (`showDirectoryPicker`); a permissão some ao reabrir o Chrome → botão "Permitir".
- Registro: `st` = NOVO | PRONTO | GRAVADO | PENDENTE | IGNORADO | ARQUIVADO | MOVIDO; `caso` = SIMPLES | DARF | INSS | ISS | ISS+DARF;
  `partes` (2+ requisições: `{req, valor, obValor, feito, externo}`); `rev` (aver/vendo/esperando/resolvido), `revNota`;
  `relConf` (conferência no relatório), `tentado/tentEtapa/tentEm`, `gravadoTs`, `destinoTs`, `nota/notaEm`.
- Prototype.js no SIPAC: todo JSON.stringify passa por `jsonSeguro()` (tira `Array.prototype.toJSON`); leitura de backup passa por `consertarBackup()`; **não usar `Array.prototype.reduce`** (usar `somar`).
- Detalhamento roda num **iframe** à esquerda (`F`); o painel fica à direita.

## Fluxo
1. **Analisar** (página atual ou "Analisar as páginas X a Y"): lê o PDF completo de cada processo
   (`/sipac/gerarPDFProcessoServlet`, `numeroProcesso` + `anoProcesso`, um por vez, `credentials:'include'`) com pdf.js e classifica.
2. **Detalhar prontos**: preenche o formulário no iframe, confere, mostra CONFERE; "Gravar este" grava, confere o comprovante
   e depois o **Relatório de Detalhamento de Despesas por Processo**.
   **Detalhamento automático** (`#sdl-auto`, estado só em memória, desliga ao recarregar): `execBox(..., true)` agenda `gravarAtual(true)` após 4 s.
   Paradas obrigatórias: comprovante divergente, relatório divergente, sessão expirada (`sessaoCaiu()`), Parar.
3. **Destino** — "Destinar todos" (`iniciarDestinoTodos`, fila `modo:'todas'`): 100 por página, varre a 07 da página 1 à última,
   reexamina a página após cada grupo; no fim, GRAVADO que não apareceu em nenhuma página vai para `sdl2_fora07`.
   **Destino**: "Dar destino a tudo" = fila (arquivar SIMPLES/ISS por mês da OB; mover DARF/INSS/ISS+DARF para
   08 - AGUARD. DARF E GPS) com uma confirmação; volta sozinho para a 07 na mesma página após cada grupo.

## Regras de negócio
- Só processos 2026. Tolerância R$ 0,01 (`TOL = 0.0101`).
- SIMPLES: OB = NF → arquivar no mês da OB (gaveta `2026`, pasta `MM - PAGAMENTOS <MÊS>`).
- DARF/INSS: NF − OB = "Total das Retenções", ISS Não Retido → detalhar só com a OB, mover para a 08.
- **ISS com DAR**: NF "Retido pelo Tomador" + 1 DAR (CONDAR) receita ISS, mesmo CNPJ, mesma NF, valor = ISSQN apurado.
  Tributo: tipo DAR, número = dígitos após `2026DR8000` (2026DR800040 → 40), ano 2026, data e valor do DAR.
  Sobra NF − OB − DAR = 0 → arquivar; sobra > 0 (federais) → mover para a 08.
- 2+ requisições: um detalhamento por requisição, casando cada req com a NF de mesmo bruto; OB com o líquido daquela NF.
  **O formulário lista a OB uma vez por processo com o valor do ÚLTIMO detalhamento** (o relatório guarda o de cada um):
  nos detalhamentos seguintes a trava exige só a mesma OB com o valor de uma parte já gravada.
  Requisição já 100% liquidada → parte marcada `externo` e segue para a próxima.
- Sem requisição → "Outros": empenho pela capa ou NE única do PDF; Ordinário com valor fixo ≠ processo → pendência.
- Pendências: urgente; requisição de outro ano; NS/OB/NE ≠ 1; ISS retido sem DAR; NF fora do DANFSe com diferença;
  CNPJ divergente; OB cita outro processo; NS só em LISTA do SIAFI; requisição recusada pelo SIPAC
  ("unidade de custo não está vinculada à gestora"); 2+ DARs; DAR fora do padrão.
- **Empenho não cadastrado**: o SIPAC responde "Empenho não cadastrado para a gestora CENTRO DE CIÊNCIAS DA SAÚDE (15.00) ou não existe."
  (visto em empenhos de 2025: a tela "Outros" não tem campo de ano e busca no orçamento 2026). Pendência com o texto
  `EMPENHO NÃO CADASTRADO: NE n/ano …` (`textoErroEmpenho`). "O empenho já foi totalmente liquidado." → `EMPENHO JÁ LIQUIDADO`.

## Mapa do SIPAC (testado em 20/10/2026)
- Mesa: `/sipac/protocolo/mesa_virtual/lista.jsf`. Categoria `menuForm:selecaoCategorias` = "PROCESSOS NA UNIDADE"
  (onchange `atualizarCategoria()`), gaveta `menuForm:combo_gavetas` = VIRTUAL. Pasta 07 = `atualizarPasta(29578)`;
  pasta ativa = `.bg-pastas .active`; contador = elemento com `onclick*="atualizarPasta(29578)"` e texto só dígitos.
  Página: `mudarPagina(n)` (0-based, AJAX). Itens por página: `menuForm:atualizarPaginacao` (25/50/100).
  Texto "1 - 25 de 417 Processos". Seleção é só no cliente (por página): "N Itens Selecionados".
  Filtros: `menuForm:mostrarFiltrosBusca` (protocolo, interessado, assunto…).
- Arquivar: `menuForm:b_opcao_arquivar_procs` navega para `/sipac/protocolo/processo/arquivo_cancelamento/processos_arquivar.jsf`;
  `arquivamentoForm:gavetas` ("2026"), `arquivamentoForm:pastas` ("09 - PAGAMENTOS SETEMBRO"), `arquivamentoForm:b_arquivar_processo` (Confirmar),
  `b_voltar`, `b_cancelar_arquivar`. **Depois de sair dessa tela a Mesa volta na pasta TODOS** → o painel reabre a 07 e a página.
- Mover: botão "Mover Processos Selecionados..." (`b_mover_procs_unidade`) → `formMoverItensPasta:gavetas`/`pastas`, texto "Pasta origem: 07 - PAGOS",
  botão "Mover Processos". O contador só atualiza ao recarregar.
- Detalhar: `/sipac/orcamento/movimentacao/empenho/liquidar/form_geral.jsf` → "Vinculado a Requisição" (`empenhoForm:tipo`=24,
  `numeroRequisicao`, `anoRequisicao`, `bntBuscar`; depois `txtDocumento` = NE + `btnPesquisar`) ou "Outros".
  Formulário: `comboTipoLancamento`, processo (`txtRadicalProcesso/Numero/Ano/Dv` com keyup A4J), `cboCategoriaDespesa`, `data`, `txtValor`
  (ou `txtValorOrdinario` fixo), `txtaObservacoes`, OB (`txtNumeroOBSelecionada`, `txtAnoOBSelecionada`, `dataOrdemBancaria`, `valorTxt`),
  tributo (modal `cadastroTributosModalForm:tipoTributo` [3=DAR], `numeroTributo`, `anoTributo`, `dataTributo`, `txtValorTributo`, botão "Adicionar Tributo").
  "Já Liquidado" (da requisição); aviso "já teve seu valor totalmente liquidado".
- Favorecido: RichFaces `...:suggestionCredor`; usar o componente (`comp.callSuggestion`, `comp.selectEntry`) e só aceitar se disparar
  `A4J.AJAX.Submit` com `suggestionCredor:j_id…`. Linha da sugestão = `NOME - CNPJ`; **o nome pode ter " - ME"/" - EPP"** (tirar só o CNPJ do fim).
- Relatório: Orçamento (`/sipac/orcamento/index.jsf`) → link `menuForm:cmdRelLiqEmp` → `liquidacaoForm:txtEmpenho/txtAnoEmpenho/txtNumProcesso/txtAnoProcesso/txtDvProcesso`, `btnBuscar`.
  Resultado: Favorecido, e por lançamento: data, valor, requisição `NNNN/ 2026 - …`, OBs `nº \t data \t R$ valor`.
- Anotações do processo (`processo.jsf`): `menuForm:visualizarNotasProcesso` → `formVisualizaNotasProcesso:textoNota`,
  `restricaoNotaProcesso:0` (Pública), botão `b_mover` ("Cadastrar", chama `cadastrarNota()`).
- O SIPAC tem "Detalhar Despesas em Lote" nativo (`menuForm:cmdLiqEmpenhoEmLote`): por empenho, vários detalhamentos com "Anexar"
  e um "Detalhar Despesas" no fim. Não poupa preenchimento; não adotado (ideia futura: gravar em grupo por empenho).

## Pendentes / ideias
- Regras novas (pedir exemplo real ao usuário): processo com 2+ OBs, NF fora do padrão DANFSe,
  NS só em lista usando a observação da OB (depende da chefia).
- Detectar fim da sessão ("Tempo de Sessão") e pausar; juntar abas num menu.
- Primeira rodada real do destino automático e da conferência no relatório ainda não acompanhada.
