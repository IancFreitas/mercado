# Status do projeto — checkpoint

> Atualizado: 2026-11-03 · Branch: `claude/dazzling-edison-3zl5du` · Fase atual: **1 (fundação + sincronização)**

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
- **Supabase real**: projeto `smart-pantry` (sa-east-1, Free) criado; 3 migrações aplicadas.
- **Revisão QA/Segurança independente**: 21 achados; 17 corrigidos, 3 parciais, 1 documentado (`docs/QA_REVIEW.md` §6).

## Em andamento / bloqueado
| Item | Bloqueio |
|---|---|
| Publicar o app (HTTPS) | Repositório **privado** → GitHub Pages exige repo público ou plano pago (ADR-012). **Decisão sua.** |
| Login OTP real | Template de e-mail do Supabase precisa de `{{ .Token }}` (passo manual no painel — SETUP_SUPABASE §4) |
| Validação em 2 iPhones | Execução manual do roteiro `TEST_PLAN.md §3` |

## PRs
- Ver PR aberto da branch `claude/dazzling-edison-3zl5du` → `main` (rascunho até a validação física).

## Testes executados (2026-11-03)
| Suíte | Resultado |
|---|---|
| `npm test` (unit + SQL/RLS em PGlite + QA adversarial) | **100 passaram, 1 falha esperada (QA-13, documentada)** |
| `npm run test:e2e` (Playwright, Chromium emulando iPhone 13) | **5/5** |
| `tsc --noEmit` / `vite build` | OK |
| CI GitHub Actions (2 execuções) | **success** |
| Banco Supabase real — isolamento via SQL (3 usuários simulados, ROLLBACK) | membro lê; não-membro não lê/grava; convite não reutilizável |
| API Supabase real com publishable key, sem login | 401 em tabelas e RPCs |
| App compilado → Supabase real (CSP) | conexão 200, sem erros de console |
| **iPhone real** | **NÃO executado** |

## Problemas encontrados
Ver `KNOWN_ISSUES.md` (principais: KI-01 sem iPhone, KI-04 template de e-mail, KI-28 clickjacking).

## Próxima ação recomendada
1. Você: decidir a hospedagem (ADR-012) e ajustar o template de e-mail (SETUP_SUPABASE §4).
2. Publicar e executar o roteiro de 2 iPhones (TEST_PLAN §3).
3. Com a Fase 1 validada, iniciar a Fase 2 (decodificador da chave NFC-e + parser).
