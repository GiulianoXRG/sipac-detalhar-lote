# SIPAC – Detalhar Despesas em lote

Painel (userscript do Tampermonkey) usado no Setor de Execução Orçamentária do CCS/UFRN para detalhar despesas de processos pagos no SIPAC, direto da Mesa Virtual (pasta 07 - PAGOS).

## Instalar

1. Instale a extensão **Tampermonkey** no Chrome. Em `chrome://extensions`, ligue o **Modo do desenvolvedor** e, nos detalhes do Tampermonkey, **Permitir scripts de usuário**.
2. Abra o link abaixo e clique em **Instalar**:
   https://raw.githubusercontent.com/GiulianoXRG/sipac-detalhar-lote/main/sipac-detalhar-lote.user.js
3. Entre no SIPAC e abra a Mesa Virtual. O painel azul aparece à direita.

O Tampermonkey verifica sozinho se há versão nova (em *Utilitários → Verificar atualizações*, dá para forçar).

## O que faz

- Lê o PDF completo de cada processo e classifica: SIMPLES, DARF/INSS, ISS com DAR, várias requisições, sem requisição (Outros).
- Preenche o Detalhar Despesas, confere tudo e grava, com conferência posterior no Relatório de Detalhamento.
- Dá destino automático: arquiva os SIMPLES/ISS na pasta do mês da OB e move DARF/INSS para a 08, voltando sozinho para a página.
- Caderno de pendências (Pendências / Em revisão / Histórico), anotação no processo, resumo do dia, backup.

Não guarda senhas nem envia dados para fora do SIPAC: tudo fica no navegador de quem usa (o backup vai para uma pasta escolhida por você).

## ⚠ Aviso

- Ferramenta de **apoio**, feita por um usuário do setor. **Não é um sistema oficial da UFRN** nem tem relação com a STI.
- Ela age no SIPAC **com o seu login**: tudo o que grava, arquiva ou move fica registrado em seu nome. **Você é responsável** por conferir.
- O **detalhamento automático vem desligado**. Ligue só depois de acompanhar alguns processos e confira o resultado.
- Use apenas com a concordância da chefia do seu setor.
- Se o SIPAC mudar alguma tela, o painel pode parar ou se confundir: em caso de dúvida, pare e faça manualmente.

## Desenvolvimento

- `npm install` e `npx playwright install chromium` (uma vez).
- `npm run check` confere a sintaxe; `npm test` roda os testes numa Mesa Virtual **simulada** (não toca o SIPAC real).
- Contexto completo para o Claude Code em `CLAUDE.md`; histórico em `CHANGELOG.md`.
