# Formato de backup — `smart-pantry-backup` v1

```json
{
  "format": "smart-pantry-backup",
  "formatVersion": 1,
  "exportedAt": "2026-11-03T19:00:00.000Z",
  "householdId": "uuid",
  "tables": {
    "households": [ { "id": "...", "householdId": "...", "name": "...", "_v": { "name": "<HLC>" } } ],
    "shoppingLists": [ ... ],
    "shoppingListItems": [ ... ],
    "...": []
  },
  "checksum": "sha256:<hex>"
}
```

- `tables`: uma chave por entidade sincronizável (`SYNC_ENTITIES` em `src/domain/types.ts`).
  Registros incluem exclusões lógicas (`deleted: true`) e o mapa de versões `_v`.
- `checksum`: SHA-256 do **JSON canônico** (chaves ordenadas recursivamente, sem
  `undefined`) de `{format, formatVersion, householdId, tables}`. `exportedAt`
  não entra no checksum.
- HLC: `"<ms 15 dígitos>:<contador 6 dígitos>:<deviceId>"`.

## Regras de restauração
1. Recusa formato desconhecido, versão futura, checksum divergente, registro de
   outra Casa, `_v` inválido, mais de 200 mil registros, arquivos > 50 MB (UI).
2. Merge campo a campo pela maior HLC → importar duas vezes ou importar backup
   antigo nunca sobrescreve dados mais novos nem duplica.
3. Registros novos/alterados geram operações de *replay* (mesma HLC, `base = hlc`)
   para chegar ao servidor quando a Casa for conectada, sem gerar falsos conflitos.
4. Cada exportação/importação é registrada em `backups` (metadados locais).

## Evolução
Nova versão do formato → incrementar `BACKUP_VERSION` e manter leitura das anteriores.
