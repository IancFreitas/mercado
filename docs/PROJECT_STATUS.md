# Status do projeto — checkpoint

> Atualizado: 2026-11-06 · Branch: `claude/dazzling-edison-3zl5du` · Fase atual: **2 (compras e despensa) — leitura do QR Code concluída**

## Concluído
- **Fase 0:** arquitetura, ADRs (001–012), modelo de dados, ameaças/LGPD, pesquisa NFC-e SP e iOS/Siri/iCloud.
- **PWA** React/TS/Vite: instalável (manifest, ícones, service worker), offline, modo claro/escuro, CSP.
- **Banco local** Dexie v2 (v1 → v2 testado), todas as 11 entidades sincronizáveis definidas.
- **Sincronização**: HLC, merge LWW por campo, conflitos preservados, outbox, pull paginado,
  rejeição por operação (`rejectedOps`), sync por Casa, relógio compartilhado entre abas.
- **Casas**: modo individual local; compartilhamento via Supabase; login OTP; convites (80 bits,
  48 h, 1 uso, hash); remover/sair/apagar Casa; transferência de posse (RPC).
- **Lista compartilhada**: adicionar/editar/marcar/remover/restaurar, dedupe, união de duplicados,
  autor, prioridade, deep link `#/lista?add=` com confirmação.
- **Backup**: JSON v1 com SHA-256, validação por registro, merge idempotente, replay p/ servidor.
- **Publicado** em https://iancfreitas.github.io/mercado/ (GitHub Pages, repo público, deploy a cada push na `main`).
- **Supabase real**: projeto `smart-pantry` (sa-east-1, Free) criado; 3 migrações aplicadas.
- **Revisão QA/Segurança independente**: 21 achados; 17 corrigidos, 3 parciais, 1 documentado (`docs/QA_REVIEW.md` §6).

## Fase 2 (em andamento)
- ✅ Leitura do QR Code / chave de acesso: câmera, foto ou digitação; decodificação local; validação do DV;
  aviso de nota de homologação e de NF-e (modelo 55); registro como compra pendente sem duplicar
  (id = hash de Casa + chave, converge entre aparelhos offline); botão para abrir a consulta na SEFAZ
  (só domínios *.gov.br). Tela `#/notas`, carregada sob demanda (jsQR em chunk separado).
- ⬜ Próximo: importar itens e preços (colar/compartilhar o conteúdo da página da SEFAZ → parser local;
  depois OCR da foto do cupom).
- Testes: +25 unitários (`nfce-qr.test.ts`) e +3 E2E (`nfce.spec.ts`).

## Em andamento / bloqueado
| Item | Bloqueio |
|---|---|
| Login OTP real | Template de e-mail do Supabase precisa de `{{ .Token }}` (passo manual no painel — SETUP_SUPABASE §4) |
| Validação em 2 iPhones | Execução manual do roteiro `TEST_PLAN.md §3` |

## PRs
- [IancFreitas/mercado#1](https://github.com/IancFreitas/mercado/pull/1) — **merged** na `main` em 2026-11-03 (aprovado para publicação; validação física ainda pendente).

## Testes executados (2026-11-03)
| Suíte | Resultado |
|---|---|
| `npm test` (unit + SQL/RLS em PGlite + QA adversarial + NFC-e) | **125 passaram, 1 falha esperada (QA-13, documentada)** — 2026-11-06 |
| `npm run test:e2e` (Playwright, Chromium emulando iPhone 13) | **8/8** — 2026-11-06 |
| `tsc --noEmit` / `vite build` | OK |
| CI GitHub Actions (2 execuções) | **success** |
| Banco Supabase real — isolamento via SQL (3 usuários simulados, ROLLBACK) | membro lê; não-membro não lê/grava; convite não reutilizável |
| API Supabase real com publishable key, sem login | 401 em tabelas e RPCs |
| App compilado → Supabase real (CSP) | conexão 200, sem erros de console |
| Site publicado (Chromium emulando iPhone 13): manifest/ícones 200, criar Casa, item, SW ativo, reabrir offline com dados, login configurado, 0 erros de console | **OK** |
| **iPhone real (2026-11-08, relatado pelo Ian)** | Login por código, compartilhamento Ian ↔ Fernanda e leitura do QR da NFC-e pela câmera **funcionaram**. Roteiro completo (offline, simultâneo, isolamento) ainda não relatado |

## Problemas encontrados
Ver `KNOWN_ISSUES.md` (principais: KI-01 sem iPhone, KI-04 template de e-mail, KI-28 clickjacking).

## Próxima ação recomendada
1. Você: ajustar o template de e-mail e o Site URL no Supabase (SETUP_SUPABASE §4–5).
2. Executar o roteiro de 2 iPhones (TEST_PLAN §3).
3. Testar a leitura do QR com a câmera no iPhone (cupom real) e seguir para a importação dos itens.
