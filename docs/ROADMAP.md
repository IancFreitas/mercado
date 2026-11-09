# Roadmap executável

Legenda: ✅ concluído · 🟡 em andamento · ⬜ não iniciado · 🔒 depende de aprovação/iPhone

## Fase 0 — Descoberta e arquitetura ✅
- ✅ Avaliação de tecnologias e sincronização (DECISIONS ADR-001..010)
- ✅ Modelo de dados (DATA_MODEL.md)
- ✅ Viabilidade NFC-e SP (research/NFCE_SP.md) e iOS/Siri/iCloud (research/IOS_PWA_SIRI_ICLOUD.md)
- ✅ Ameaças e controles (SECURITY.md)

## Fase 1 — Fundação e sincronização 🟡
| Item | Status | Critério de aceitação |
|---|---|---|
| Estrutura do repositório, CI | ✅ | `npm test`, `npm run build`, E2E passam no CI |
| PWA instalável/offline | ✅ (Chromium) 🔒 (iPhone) | abre offline após 1ª visita; manifest + ícones; instalável no iOS |
| Banco local versionado | ✅ | migração testada; dados persistem após reabrir |
| Casas e usuários | ✅ | criar Casa local; login OTP; conectar Casa; convite 1 uso/48 h |
| Lista compartilhada | ✅ | adicionar/editar/marcar/remover/restaurar; dedupe; autor do item |
| Sync + offline + conflitos | ✅ (automatizado) 🔒 (2 iPhones) | 10 cenários da PoC (TEST_PLAN §2) |
| Isolamento entre Casas | ✅ (memória + Postgres/RLS) | não-membro não lê/escreve |
| Projeto Supabase real | 🔒 | requer sua conta/aprovação |
| Publicação no GitHub Pages | 🔒 | requer aprovação (publicação) |
| Validação física em 2 iPhones | 🔒 | roteiro TEST_PLAN §3 executado por você |

**Saída da Fase 1:** roteiro manual §3 aprovado em dois iPhones reais.

## Fase 2 — Compras e despensa 🟡
1. ✅ Decodificador local do QR/chave NFC-e (v1/v2/v3, online/offline, 44 dígitos, DV mod 11, UF, CNPJ, AAMM, nº) + testes.
2. ✅ Leitor de QR (câmera via getUserMedia + jsQR; foto; chave digitada) — ✅ câmera validada em iPhone real (2026-11-08).
   ✅ Nota registrada como compra *pendente*, id derivado da chave (sem duplicar entre aparelhos), link seguro (*.gov.br) para a SEFAZ.
3. Abrir consulta SEFAZ no Safari + colar/compartilhar texto → parser local (classes `txtTit`, `Rqtd`, `RUN`, `RvlUnit`...); fixtures reais fornecidas por você.
4. Fallback manual de compra; OCR local (Tesseract.js) com campos de baixa confiança.
5. Dicionário de normalização (marcas, unidades, abreviações: "SAB OMO LQD 3L") + aliases aprendidos.
6. Importação transacional: compra → preços → estoque → lista; bloqueio de duplicidade por chave.
7. ✅ Despensa: estoque = soma de movimentações append-only (compra idempotente da nota, consumo, ajuste, esgotado, descarte, "ainda tem"); tela com "Usei 1/Acabou/Ainda tem", histórico e "Pôr na lista". Produto com id determinístico (Casa + descrição normalizada).
8. ✅ Gastos (`#/gastos`): por mês (fuso São Paulo, comparação % só com os dois meses > 0), loja e categoria; cartões na tela Início.

## Fase 3 — Inteligência estatística 🟡
1. ✅ Previsão de consumo (`src/predict/consumption.ts`, funções puras): taxa por amostras (observação direta / consumo registrado / assumida), mediana das últimas 6, descarte de compras e períodos atípicos, mudança de padrão, "ainda tem", confiança baixa/média/alta, explicação em português. Fuso America/Sao_Paulo.
2. ✅ Sugestões de reposição (`src/predict/suggestions.ts`): adicionar (sem duplicar), adiar 7 dias (`Product.snoozedUntil`), "não sugerir mais" (`predictionEnabled`), cartão no Início, seção na Lista, previsão no detalhe da Despensa.
3. ⬜ Histórico de preços completo, correção manual da taxa, métricas de acerto da previsão.

Histórico de preços (min/máx/média/mediana/variação), normalização R$/kg-l-un,
gastos por categoria/período/loja, previsão de consumo robusta (mediana de taxas
entre compras, descarte de outliers, intervalo de confiança simples, correções do
usuário), sugestões com explicação, lista inteligente.

## Fase 4 — Experiência avançada ⬜
Modo compras (preço encontrado × histórico, total estimado, reconciliação com
NFC-e), Web Push (iOS 16.4+, só instalado), Atalhos/Siri (deep links ✅ já
existe `#/lista?add=`; consultas exigem Edge Function + token de atalho),
desempenho, guia de instalação para amigos.
