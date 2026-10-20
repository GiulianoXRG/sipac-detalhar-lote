# Histórico de versões

## 0.19.1 — 20/10/2026
- Repositório público: aviso de uso no README; exemplos e testes sem dados reais.

## 0.19.0 — 20/10/2026
- Backup automático numa pasta escolhida uma vez ("📁 Ativar backup automático"): salva sozinho a cada 30 min com mudanças, ao terminar um destino e ao sair da página; 1 arquivo por dia (`sipac-backup-AAAA-MM-DD.json`). Se o Chrome pedir permissão de novo, o rodapé mostra "Permitir".
- Cópias internas (IndexedDB) dos últimos 7 dias, com "Restaurar" e "Antes da última restauração" para desfazer.
- "💾 Salvar backup" salva na pasta (ou baixa, se não houver pasta); "⬇ Baixar arquivo" continua disponível.

## 0.18.1 — 20/10/2026
- Destino não "trava" mais com o SIPAC lento: depois de Confirmar o arquivamento o painel espera o SIPAC terminar (antes saía da tela em 12 s e podia cortar o arquivamento).
- Conferência paciente: se a lista da Mesa ainda não atualizou, recarrega e confere de novo (até 4 vezes); se o SIPAC não fez nada, refaz o grupo uma vez.
- Troca de página com 100 por página: espera até 40 s e tenta de novo.
- Só uma aba por vez toca o destino (trava entre abas).

## 0.18.0 — 20/10/2026
- "▶ Destinar todos": destina TODOS os detalhados de qualquer página. Põe a Mesa em 100 por página, percorre a 07 do começo ao fim, arquiva por mês e move para a 08 em cada página, reexaminando a página depois de cada grupo (a lista anda).
- Detalhados que não estão mais na 07 (destino feito à mão ou interrompido) aparecem na seção 3 com "Ver" e "Marcar como já destinados".
- Corrigido "não achei a gaveta VIRTUAL": depois de arquivar a Mesa volta em TODOS e o select da gaveta demora a ser redesenhado; agora o painel espera a opção aparecer.

## 0.17.1 — 20/10/2026
- Nº do empenho aparece em todas as linhas da lista ("Empenho 210/2026 · …") e entra na busca.

## 0.17.0 — 20/10/2026
- 🤖 Detalhamento automático (interruptor abaixo dos botões 1 e 2): grava sozinho quando CONFERE, após 4 s; Pular/Parar cancelam. Divergência vira pendência e segue; comprovante/relatório que não bate ou sessão expirada param tudo. Vale só enquanto a página estiver aberta.
- Pendência "EMPENHO NÃO CADASTRADO" com o nº do empenho (e aviso quando é empenho de ano anterior) e "EMPENHO JÁ LIQUIDADO"; novo grupo nas Pendências. Pendências antigas com essa mensagem do SIPAC são convertidas sozinhas.
- Sessão do SIPAC expirada durante o detalhamento: para sem marcar pendência.

## 0.16.0 — 20/10/2026
- Destino automático: arquiva por mês e move para a 08 em fila, com uma confirmação, voltando sozinho para a 07 e a página (resolve a Mesa "voltar para TODOS" depois de arquivar).
- Conferência no Relatório de Detalhamento depois de cada gravação.
- Favorecido com " - ME" no nome; buscas alternativas e diagnóstico quando o CNPJ não aparece.
- Trava das OBs em processos com várias requisições corrigida (o formulário mostra só o valor do último detalhamento).
- Analisar várias páginas; resumo do dia para copiar; produtividade dos últimos 7 dias; lembrete de backup no dia seguinte.
- Atualização automática pelo GitHub (`@updateURL`).

## 0.15.0
- Aba "Em revisão" separada das Pendências.

## 0.14.0
- Caderno de pendências (situação, nota pessoal, grupos por tipo), aba Histórico, backup/restaurar, Limpar seguro.

## 0.13.0 / 0.12.0
- Abas "Mover → 08" e "Não terminados".

## 0.11.0
- Requisição já liquidada no SIPAC: marca a parte como feita e segue para a próxima.

## 0.10.0
- Botão 📝 Anotar (anotação pública no processo).

## 0.9.x
- Interface: pílula minimizada arrastável, Alt+S, aviso sonoro/notificação, busca, cartões como filtro, aba Prontos.

## 0.8.0
- ISS com DAR: cadastro do tributo (DAR) no detalhamento.
