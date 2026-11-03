# Arquitetura — Smart Pantry

> Última atualização: 2026-11-03 · Fase 1 (fundação e sincronização)

## 1. Visão geral

```
┌──────────────────────── iPhone (PWA na Tela de Início) ────────────────────────┐
│  React UI ──► PantryRepo (regras de domínio) ──► SyncEngine.mutate()            │
│                                                   │  (1 transação Dexie)         │
│                                                   ├─► tabela da entidade (estado)│
│                                                   └─► outbox (operações)         │
│  Service Worker (Workbox): cache do app → abre offline                          │
│  IndexedDB (Dexie): TODOS os dados da Casa ficam no aparelho                    │
└───────────────┬──────────────────────────────────────────────▲─────────────────┘
                │ push_ops (RPC, lote ≤200, idempotente)       │ pull (seq > cursor)
                ▼                                              │ + Realtime = "gatilho"
┌──────────────────────────── Supabase (plano gratuito) ─────────────────────────┐
│ Auth (código OTP por e-mail)   Postgres + RLS                                   │
│  households · household_members · invitations(hash) · sync_ops (append-only)   │
│  Toda leitura/escrita exige auth.uid() ∈ membros da Casa                        │
└────────────────────────────────────────────────────────────────────────────────┘
Hospedagem do app: GitHub Pages (estático, HTTPS) — publicação só após aprovação.
```

**Local-first**: o app funciona 100% sem servidor (modo individual). O servidor
é opcional e atua como *relay* com armazenamento do log de operações. Não há
servidor próprio para manter.

## 2. Camadas e módulos

| Camada | Arquivo(s) | Responsabilidade |
|---|---|---|
| Domínio | `src/domain/types.ts`, `text.ts` | Tipos das 11 entidades sincronizáveis, `SyncOp`, `ConflictRecord`, normalização de texto |
| Persistência | `src/db/db.ts` | Esquema Dexie versionado (v1), outbox, conflitos, metadados de backup, KV |
| Regras de domínio | `src/db/repo.ts` | Casa, lista, itens (dedupe, exclusão reversível, união de duplicados) |
| Sincronização | `src/sync/hlc.ts` | Relógio lógico híbrido — ordem total determinística |
| | `src/sync/merge.ts` | Merge LWW por campo + detecção de conflitos (função pura) |
| | `src/sync/engine.ts` | Outbox, push/pull, cursor, status, aplicação transacional |
| | `src/sync/validate.ts` | Validação de toda operação remota (dados não confiáveis) |
| | `src/sync/transport.ts` | Interface desacoplada do backend |
| | `src/sync/supabase.ts` | Auth OTP, RPCs de Casa/convite, transporte, Realtime |
| | `src/sync/memoryServer.ts` | Servidor em memória com as mesmas regras (testes) |
| Backup | `src/backup/backup.ts` | Exportação/restauração JSON versionada com SHA-256 |
| App | `src/app/*` | Bootstrap, sessão, laço de sincronização, contexto React |
| UI | `src/ui/*` | Telas: Onboarding, Início, Lista, Despensa (placeholder), Casa |
| Servidor | `supabase/migrations/*.sql` | Esquema, RLS, RPCs |

## 3. Modelo de sincronização

### 3.1 Operações
Cada alteração local gera uma `SyncOp`:
`{opId, householdId, entity, entityId, hlc, deviceId, fields, base}`.
- `fields`: campos alterados → valor.
- `base`: para cada campo, a versão (HLC) que o autor via ao editar.

### 3.2 Merge determinístico (LWW por campo)
- Cada registro guarda `_v[campo] = HLC` da última escrita aplicada.
- Uma op vence num campo se `op.hlc > _v[campo]`.
- Como o HLC é uma ordem total (inclui `deviceId` como desempate), **todos os
  aparelhos convergem para o mesmo estado** independentemente da ordem de
  chegada (testado: comutatividade e idempotência).
- Campos diferentes editados ao mesmo tempo **não conflitam** (ex.: Ian marca
  "Ovos" enquanto Fernanda muda a quantidade → ambas as mudanças permanecem).

### 3.3 Sem perda silenciosa
Se `op.base[campo] ≠ _v[campo]` (o autor não via a versão atual), a edição foi
concorrente. Se os valores diferem, o valor perdedor é gravado em
`conflicts` com id determinístico (`entityId|campo|hlcPerdedor`) — o mesmo em
todos os aparelhos. A tela **Casa › Conflitos** mostra e permite restaurar.
Exclusões são lógicas (`deleted: true`) e reversíveis (“Removidos recentemente”).
Metadados (`updatedBy`, `normName`) não geram alertas.

### 3.4 Ordem e cursor
- O servidor atribui `seq` (identity). `push_ops` usa `pg_advisory_xact_lock`
  por Casa, de modo que a ordem de `seq` dentro de uma Casa é a ordem de commit
  → um pull `seq > cursor` nunca “pula” uma operação que commitou depois.
- Push é idempotente por `opId` (`on conflict do nothing`).
- A outbox é enviada em ordem local; op só sai da outbox quando aceita.

### 3.5 Gatilhos de sincronização
Ao abrir; ao voltar para o app (`visibilitychange`/`focus`); ao reconectar
(`online`); a cada 20 s com o app visível; ~0,6 s após alteração local;
notificação Realtime de novo INSERT em `sync_ops` (apenas um gatilho — a fonte
de verdade é o pull). **Não há sincronização em segundo plano no iOS.**

## 4. Casas, usuários e convites
- **Casa** = fronteira de isolamento (`householdId` em todo registro e op).
- Modo individual: Casa criada localmente (UUID no aparelho), sem conta.
- Compartilhar: login por código OTP → `create_household(id)` registra a Casa
  com o mesmo id e a outbox acumulada é enviada.
- Convite: `create_invitation` gera código de 16 caracteres (80 bits), válido
  48 h, 1 uso; só o SHA-256 é armazenado. `accept_invitation` adiciona o membro.
- Remoção/saída: `remove_member`; exclusão total: `delete_household` (dono).

## 5. Dados: onde ficam
Ver `docs/SECURITY.md §3` (inventário de dados).

## 6. Decisões
Ver `docs/DECISIONS.md` (ADRs).
