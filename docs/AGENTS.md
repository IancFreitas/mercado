# Metodologia de agentes

O trabalho é dividido por responsabilidade. Nesta sessão, alguns papéis foram
executados por **subagentes reais** (instâncias independentes, com escopo de
arquivos restrito) e os demais pelo agente coordenador.

| Agente | Papel | Execução nesta sessão | Artefatos |
|---|---|---|---|
| 1. Product Manager | requisitos, backlog, aceitação | coordenador | ROADMAP, TEST_PLAN §4, NEXT_STEPS |
| 2. Arquiteto | arquitetura, riscos, ADRs | coordenador | ARCHITECTURE, DECISIONS, DATA_MODEL |
| 3. Frontend | UI, PWA, acessibilidade | coordenador | `src/ui`, `vite.config.ts`, E2E |
| 4. Dados e Sincronização | persistência, sync, conflitos, isolamento | coordenador | `src/sync`, `src/db`, `supabase/` |
| 5. NFC-e e Processamento | pesquisa fiscal, extração | **subagente independente** | `docs/research/NFCE_SP.md`, `IOS_PWA_SIRI_ICLOUD.md` |
| 6. Algoritmos | previsões, estatística | não acionado (Fase 3) | — |
| 7. QA e Segurança | testes adversariais, vulnerabilidades | **subagente independente** (sem permissão de editar `src/`) | `docs/QA_REVIEW.md`, `tests/unit/qa-*.test.ts` |

Regras de colaboração:
- Subagentes não fazem commit/push; o coordenador revisa e versiona.
- QA não corrige o código que revisa (separação de funções); correções são
  feitas pelo agente responsável e verificadas pelos testes do QA.
- Ao retomar uma sessão: ler `PROJECT_STATUS.md`, `NEXT_STEPS.md`, `git log` e PRs abertos.
