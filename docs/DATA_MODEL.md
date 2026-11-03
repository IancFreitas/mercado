# Modelo de dados

Fonte da verdade dos tipos: `src/domain/types.ts`. Esquema local: `src/db/db.ts`.
Esquema do servidor: `supabase/migrations/`.

## 1. Regras gerais
- PK: UUID v4 gerado no aparelho (`id`). Permite criar offline sem colisão.
- **Isolamento:** todo registro sincronizável tem `householdId` (índice em todas
  as tabelas). Merge recusa op cujo householdId difere do registro; o servidor
  aplica RLS por Casa.
- `_v`: mapa campo → HLC (controle de versão por campo).
- `deleted`: exclusão lógica (tombstone) — necessária para sincronizar remoções.
- Valores monetários em **centavos inteiros**.
- Datas ISO-8601 (UTC).

## 2. Mapeamento das entidades pedidas

| Entidade (requisito) | Onde | Observação |
|---|---|---|
| Users | Supabase `auth.users` | Local: apenas `displayName` e `deviceId` (KV) |
| Households | local `households` + servidor `households` | Nome da Casa vive nas ops (servidor não precisa) |
| HouseholdMembers | servidor `household_members` | PK (household_id, user_id), role owner/member |
| Invitations | servidor `invitations` | só hash do código; expiração, usos, revogação |
| Stores | local `stores` (sync) | índice `cnpj` |
| Purchases | local `purchases` (sync) | índice `accessKey` → impede NFC-e duplicada (Fase 2) |
| PurchaseItems | local `purchaseItems` (sync) | FK lógica `purchaseId`, `productId` |
| Products | local `products` (sync) | `equivalenceGroup` p/ substitutos (leite integral de marcas diferentes) |
| ProductAliases | local `productAliases` (sync) | descrição da nota → produto (aprendizado das correções) |
| ProductCategories | enum `CATEGORIES` | lista fixa na v1; tabela própria se virar editável |
| PantryInventory | local `inventory` (sync) | quantidade estimada, confiança, validade |
| InventoryMovements | local `inventoryMovements` (sync) | **append-only**: trilha de auditoria (compra, consumo, ajuste, esgotado, descarte, ainda_tem) |
| ShoppingLists | local `shoppingLists` (sync) | lista padrão = menor id (determinístico) |
| ShoppingListItems | local `shoppingListItems` (sync) | `normName` p/ dedupe; createdBy/updatedBy |
| PriceHistory | local `priceHistory` (sync) | nunca sobrescrito; `normalizedCents` por kg/l/un |
| ConsumptionPredictions | *derivado* (Fase 3) | calculado localmente; não sincronizar (evita conflito de dado derivado) |
| SyncOperations | local `outbox` + servidor `sync_ops` | log append-only; `seq` total por Casa |
| BackupMetadata | local `backups` | export/import, checksum, contagem |
| (extra) Conflicts | local `conflicts` | valores perdedores de edições concorrentes |

## 3. Índices locais (Dexie v1)
Ver `DB_SCHEMA_V1` em `src/db/db.ts`.

## 4. Servidor
- `sync_ops(seq identity PK, household_id FK, op_id UNIQUE, entity CHECK, entity_id, hlc CHECK regex, device_id CHECK, user_id = auth.uid(), fields jsonb, base jsonb, created_at)`
  · índice `(household_id, seq)` · tamanho < 16 KB · `households` só com entity_id = household_id.
- FKs com `on delete cascade` a partir de `households` (exclusão LGPD).

## 5. Migrações
- Local: nova `this.version(N).stores(...)` + `.upgrade()`; nunca editar versões publicadas; teste em `tests/unit/backup-db.test.ts`.
- Servidor: novo arquivo `supabase/migrations/<timestamp>_<nome>.sql`; testado via PGlite.
- Ops antigas continuam válidas: campos novos são opcionais; entidades novas exigem atualizar o CHECK de `sync_ops.entity` **e** `SYNC_ENTITIES`.

## 6. Consistência entre nota, preço, estoque e lista (planejado — Fase 2)
Importar uma NFC-e numa única transação local: `purchases` + `purchaseItems` +
`priceHistory` (1 por item) + `inventoryMovements(kind='compra')` + atualização de
`inventory` + marcação dos itens correspondentes da lista. `accessKey` impede
reimportação. Tudo como ops → replicado de forma atômica por aparelho.
