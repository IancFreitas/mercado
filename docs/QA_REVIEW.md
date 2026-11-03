# Revisão de QA e Segurança — Smart Pantry

**Agente 7 (QA e Segurança)** · data da revisão: 2026-11-03 · branch `claude/dazzling-edison-3zl5du`

## 1. Escopo

- **Servidor:** `supabase/migrations/20261103000001_init.sql`, `20261103000002_realtime.sql`, ou seja, RLS, RPCs `SECURITY DEFINER`, convites, `push_ops`, exclusão e Realtime.
- **Sincronização:** `src/sync/{hlc,merge,engine,validate,memoryServer,supabase,transport}.ts`.
- **Persistência e backup:** `src/db/{db,repo}.ts` e `src/backup/backup.ts`.
- **Cliente:** `src/app/services.ts`, `src/ui/*.tsx`, `vite.config.ts` (CSP), `index.html`.

Ficaram fora do escopo a infraestrutura do projeto Supabase (configuração de Auth/OTP, rate limits do GoTrue, `max_rows` do PostgREST) e as dependências de terceiros.

## 2. Método

1. Li todo o código listado acima de forma adversarial, procurando quebras de isolamento, escalonamento de privilégio, perda silenciosa de dados, travamentos e entradas não confiáveis.
2. Para cada suspeita, escrevi um teste automatizado que a reproduz:
   - `tests/unit/qa-sql-rls.test.ts`: roda a **migração real** em PGlite com stub de `auth.uid()`, `anon` e `authenticated`, igual a `supabase-rls.test.ts`;
   - `tests/unit/qa-sync.test.ts`: HLC, merge, motor, outbox e cursor, com `fake-indexeddb` e `MemorySyncServer`;
   - `tests/unit/qa-backup.test.ts`: backups forjados. O checksum é recalculável por qualquer pessoa, então o arquivo é tratado como entrada não confiável.
3. Os testes que demonstram defeito usam **`it.fails(...)`** com comentário `BUG QA-xx`. Hoje eles "passam porque falham". Depois da correção passam a acusar erro, e aí devem ser trocados para `it(...)`. Confirmei que cada um falha **pelo motivo descrito**: rodei a suíte com `it.fails` → `it` e conferi as mensagens de asserção.
4. Os demais testes nesses arquivos são **regressões** de propriedades que hoje estão corretas.
5. Resultado da suíte: `npx vitest run` → 82 passam e 18 são falhas esperadas. `npx playwright test` → 5/5. `tsc --noEmit` → sem erros. Nenhum arquivo em `src/` ou `supabase/` foi alterado.

**Legenda da coluna "Evidência":** **T** significa que o defeito foi demonstrado por teste. **A** significa suspeita baseada só em análise, sem teste que a reproduza; o motivo vem indicado.

## 3. Achados

### 3.1 Tabela resumo

| ID | Sev. | Arquivo:linha | Descrição | Evidência |
|----|------|---------------|-----------|-----------|
| QA-10 | **Alta** | `src/sync/hlc.ts:78-82` | `receive()` não limita o contador: um carimbo remoto `…:999999:x` produz um HLC de 7 dígitos, inválido, que é persistido; ao reabrir, o app não inicia mais | T: `qa-sync` "BUG QA-10" (2 testes) |
| QA-06 | **Alta** | `src/sync/hlc.ts:75`, `src/sync/engine.ts:114,127,228-235`, `src/backup/backup.ts:149` | Op remota (ou de backup) com HLC > agora + 24 h é aplicada, mas o relógio não a adota. Edições locais seguintes desse campo são **descartadas em silêncio** | T: `qa-sync` "BUG QA-06", `qa-backup` "BUG QA-06 (via backup)" |
| QA-02 | **Alta** | `init.sql:153` (create_invitation), `init.sql:202-212` (remove_member) | Qualquer membro gera convites, e eles sobrevivem à remoção do autor. O membro removido volta para a Casa usando o próprio código | T: `qa-sql-rls` "BUG QA-02" + efeito |
| QA-08 | **Alta** | `src/sync/engine.ts:189-193`, `158-159` | Basta uma op não aceita pelo servidor para `pushAll` lançar exceção antes do pull. A outbox fica travada e o aparelho **nunca mais recebe** alterações | T: `qa-sync` "BUG QA-08"; `qa-sql-rls` "QA-08 (servidor)" |
| QA-12 | **Média** | `src/backup/backup.ts:89-97, 105-122, 159-161` | `verifyBackup` não valida `households.id === householdId`, nomes de campo, chaves de `_v` nem tamanho. `replayOps` enfileira ops **sem `validateOp`**, e isso trava a sync (QA-08) | T: `qa-backup` "BUG QA-12" (3 testes) |
| QA-01 | **Média** | `init.sql:202-212` | O dono pode remover a si mesmo e a Casa fica sem dono: ninguém mais administra, revoga convites ou executa `delete_household`. Se o último membro sai, os dados ficam órfãos no servidor (LGPD) | T: `qa-sql-rls` "BUG QA-01" + efeito |
| QA-04 | **Média** | `init.sql:114-116, 123` | `INSERT` direto em `sync_ops` continua concedido a `authenticated` e contorna o `pg_advisory_xact_lock` de `push_ops`. Um commit fora de ordem de `seq` faz quem estiver puxando **pular** ops | T (o caminho está aberto) + A (a corrida exige 2 conexões, o PGlite tem uma só) |
| QA-05 | **Média** | `init.sql:55`, `217-251` | O servidor aceita HLC arbitrariamente no futuro (ex.: `999999999999999:…`), o que alimenta QA-06 em todos os aparelhos | T: `qa-sql-rls` "BUG QA-05" |
| QA-09 | **Média** | `init.sql:61` vs `src/sync/transport.ts:30`, `validate.ts:43` | Limites de tamanho divergentes: o cliente mede o texto JSON (16 KiB) e o servidor mede `pg_column_size(jsonb)`, até ~6× maior com arrays numéricos. Op aceita no cliente derruba o lote inteiro no servidor (QA-08) | T: `qa-sql-rls` "BUG QA-09" |
| QA-11 | **Média** | `src/sync/engine.ts:41,64-68,114`, `merge.ts:58` | Cada aba tem seu próprio `HlcClock` sobre o mesmo IndexedDB e `deviceId`: duas abas geram o **mesmo HLC**, e a segunda edição é tratada como "eco" e descartada, com divergência entre aparelhos | T: `qa-sync` "BUG QA-11" |
| QA-07 | Baixa | `init.sql:49, 242-249` | `op_id` é único globalmente. Se já existe em outra Casa, `push_ops` não insere, não devolve o id e não dá erro, o que trava a outbox (QA-08). Explorar exige conhecer o `op_id` de antemão | T: `qa-sql-rls` "BUG QA-07" + efeito |
| QA-03 | Baixa | `init.sql:183-186` | Aceitar um convite sendo já membro consome um uso (`uses+1` antes do `on conflict do nothing`) | T: `qa-sql-rls` "BUG QA-03" |
| QA-13 | Baixa | `src/sync/merge.ts:64-70` | O conjunto de conflitos depende da ordem de chegada: o mesmo log gera 1 conflito no autor e 2 nos outros (falso conflito com perdedor já substituído pelo próprio autor) | T: `qa-sync` "BUG QA-13" |
| QA-14 | Baixa | `src/sync/engine.ts:141-147` | `sync(h2)` com `sync(h1)` em andamento devolve a promessa de h1, e a outbox de h2 não é enviada | T: `qa-sync` "BUG QA-14" |
| QA-15 | Baixa | `src/ui/App.tsx:29-30`, `src/ui/ListScreen.tsx:43-50` | O deep link `#/lista?add=` adiciona o item **sem confirmação**: qualquer página ou mensagem pode injetar itens na lista compartilhada. Além disso, só o primeiro deep link por montagem é tratado (`handledLink`) | A (comportamento de UI, coberto parcialmente pelo e2e existente) |
| QA-16 | Baixa | `src/ui/Onboarding.tsx:69` | A restauração no onboarding não limita o tamanho do arquivo (a de `HouseScreen.tsx:378` limita a 50 MB) | A |
| QA-17 | Baixa | `vite.config.ts:12`, `src/sync/supabase.ts:17-27` | A CSP só permite `*.supabase.co`, mas `validateConfig` aceita qualquer URL https (Supabase self-hosted ou domínio próprio quebra em silêncio). CSP via `<meta>` não suporta `frame-ancestors`, então não há proteção contra clickjacking no GitHub Pages | A |
| QA-18 | Baixa | `init.sql:154-157`, `130-143` | Um membro esgota o limite de 10 convites/h da Casa e o dono fica sem conseguir convidar. `create_household` permite criar Casas ilimitadas e reservar ids | A |
| QA-19 | Baixa | `src/sync/validate.ts:27-28`, `merge.ts:65,70` | O nó do HLC não é amarrado a `deviceId` nem a `user_id`. Um membro malicioso suprime alertas de conflito usando `base === hlc` (marcador de replay) ou o nó de outro aparelho | A |
| QA-20 | Baixa | `src/ui/HouseScreen.tsx:52-56`, `src/sync/supabase.ts:118-127` | Não há UI para `leave`/`delete_household`. "Apagar dados deste aparelho" não remove nada do servidor, e a exclusão LGPD não é acessível ao usuário | A |
| QA-21 | Baixa | `src/ui/HouseScreen.tsx:320` | "Usar outra" num conflito de `name` não atualiza `normName`, o que deixa a detecção de duplicados inconsistente | A |

### 3.2 Detalhes: cenário de falha e correção recomendada

**QA-10 (Alta): relógio HLC inválido persistido, app não abre.**
- **Cenário:** um membro, ou um aparelho bugado, faz push de uma op com `hlc = <agora+1s>:999999:x`. O servidor aceita (regex `\d{6}`). Em cada aparelho, `applyRemote` chama `clock.receive`, que gera `counter = 1000000`, e grava `hlc:last = "…:1000000:…"`. Na próxima abertura, `SyncEngine.create` chama `parse()`, que lança exceção, e `bootstrap()` falha. O app só volta a funcionar apagando os dados locais. É um DoS persistente contra todos os membros.
- **Correção:**
  - em `receive`, se `counter > MAX_COUNTER`, fazer `ms += 1; counter = 0`, igual a `tick`;
  - em `SyncEngine.create`, tolerar um `hlc:last` inválido (descartar e usar `{ms: now}`);
  - validar opcionalmente no servidor que o contador é `< 999999`.

**QA-06 (Alta): perda silenciosa por HLC "do futuro".**
- **Cenário:** um aparelho com relógio adiantado mais de 24 h, um membro malicioso ou um backup forjado grava um campo com HLC muito à frente. `receive` ignora o carimbo (proteção contra deriva), mas `applyOp` o aplica mesmo assim. A partir daí, `mutate()` gera um HLC menor que `_v[campo]`, `applyOp` decide `opWins = false`, o valor não muda e nenhum conflito é registrado. A op vai para a outbox e é descartada também nos outros aparelhos. Para o usuário, a edição "não pega".
- **Correção:**
  - em `applyRemote` e `restoreBackup`, colocar em quarentena (ou rejeitar) ops e registros com `ms > now + MAX_DRIFT_MS`, avançando o cursor;
  - em `mutate()`, garantir `hlc > max(current._v[f])` para os campos tocados (ex.: `clock.receive(max)` sem limite de deriva antes do `tick`, ou falhar com erro visível);
  - no servidor, `check` em `push_ops`: `left(hlc,15)::bigint <= extract(epoch from now())*1000 + 86400000` (QA-05).

**QA-02 (Alta): porta dos fundos por convite.**
- **Cenário:** um membro gera convites (até 10/h, TTL de até 168 h). O dono o remove. O membro aceita o próprio código e volta com acesso de leitura a todo o log. O membro comum não consegue listar os próprios convites, e o dono só os encontra consultando a tabela.
- **Correção:**
  - restringir `create_invitation` a `is_owner`, ou registrar `created_by` e, em `remove_member`, executar `update invitations set revoked = true where household_id = p_household and created_by = p_user`;
  - em `accept_invitation`, exigir que o autor do convite ainda seja membro (`exists(select 1 from household_members where household_id = v_inv.household_id and user_id = v_inv.created_by)`).

**QA-08 (Alta): uma op rejeitada trava push e pull.**
- **Cenário:** `push_ops` descarta uma op (op_id em outra Casa, QA-07), recusa o lote (check constraint, QA-09), ou o `MemorySyncServer` lança exceção numa op inválida vinda de backup (QA-12). `pushAll` lança "Servidor não aceitou todas as operações" e `doSync` não chega ao `pullAll`. A cada ciclo a mesma op volta à cabeça da outbox, e o aparelho fica permanentemente sem receber alterações. O status mostra só "error".
- **Correção:**
  - executar o pull mesmo quando o push falha por motivo não transitório;
  - mover ops rejeitadas de forma permanente (erro 22xxx/23xxx, ou ausência no `accepted` após N tentativas) para uma "dead-letter" visível ao usuário, em vez de bloquear a fila;
  - fazer `push_ops` devolver erro por op, em vez de tudo ou nada.

**QA-12 (Média): backup forjado contorna a validação.**
- **Cenário:** o checksum é só um SHA-256 recalculável. Um backup pode conter `households` com `id ≠ householdId`, chaves de `_v` como `householdId`, valores maiores que 16 KiB ou HLCs futuros. O restore aceita, e `replayOps` enfileira essas ops sem `validateOp`. Resultado: travamento da sync (QA-08) e bloqueio de campos (QA-06).
- **Correção:**
  - em `verifyBackup`, validar cada registro como se fosse op: `FIELD_RE` para as chaves de `_v` e do registro, tipos, `id === householdId` para `households` e limite de tamanho por registro;
  - em `restoreBackup`, passar cada op de `replayOps` por `validateOp` e abortar com `BackupError` se alguma falhar;
  - descartar chaves de registro sem entrada em `_v`.

**QA-01 (Média): Casa sem dono.**
- **Correção:**
  - em `remove_member`, recusar quando `p_user` é o único `owner` (exigir transferência de posse antes, com uma RPC `transfer_ownership`);
  - quando o último membro sair, apagar a Casa (cascade), em linha com a LGPD.

**QA-04 (Média): INSERT direto contorna a serialização.**
- **Cenário (análise):** a transação T1 (`push_ops`, que segura o lock) recebe `seq=10`. A transação T2 (`INSERT` direto, sem lock) recebe `seq=11` e commita primeiro. Um pull entre os dois commits vê 11 e grava `cursor=11`, e o `seq 10` nunca mais é lido por esse aparelho. O app honesto só usa `push_ops`, mas um membro malicioso ou um cliente antigo consegue provocar o problema e fazer ops de terceiros sumirem para outros aparelhos.
- **Correção:**
  - `revoke insert on public.sync_ops from authenticated;`
  - transformar `push_ops` em `SECURITY DEFINER` com checagem explícita `is_member(p_household)`, preenchendo `user_id = auth.uid()`.

**QA-05 / QA-09 (Média): validação do servidor mais fraca que a do cliente e com limites divergentes.**
- **Correção:**
  - em `push_ops`, aplicar as mesmas regras de `validateOp`: nomes de campo `^[a-zA-Z][a-zA-Z0-9]{0,40}$`, proibir `id`/`householdId`, chaves de `base` contidas em `fields`, HLC com limite de futuro e nó do HLC igual a `device_id`;
  - unificar o limite de tamanho: medir `octet_length(fields::text)` no servidor ou usar no cliente uma margem maior (ex.: 4 KiB), e documentar.

**QA-11 (Média): múltiplas abas.**
- **Correção:** ler `hlc:last` do kv **dentro** da transação de `mutate()` e fazer `clock.receive(last)` antes do `tick` (o relógio passa a ser compartilhado via IndexedDB). Opcionalmente, usar Web Locks ou `BroadcastChannel` para eleger uma única aba sincronizadora.

**QA-07 (Baixa):** fazer `push_ops` levantar erro explícito (ex.: `23505 op_id em uso`) quando o `op_id` existe em outra Casa, para que o cliente regenere o `opId`. Alternativa: chave única `(household_id, op_id)`.

**QA-03 (Baixa):** em `accept_invitation`, se o usuário já é membro, retornar sem incrementar `uses`.

**QA-13 (Baixa):** não registrar conflito quando o valor "perdedor" atual foi escrito por um nó que tem, no mesmo campo, uma op posterior. A alternativa mais simples é ajustar o comentário e a documentação para "conflitos podem diferir entre aparelhos; o estado final converge". O estado final converge, coberto pelo teste "convergência".

**QA-14 (Baixa):** guardar `running` por `householdId` (Map) ou encadear a nova chamada após a atual.

**QA-15 (Baixa):** mostrar uma confirmação ("Adicionar 'X' à lista?") antes de gravar itens vindos de deep link, e tratar cada `hashchange` novo em vez de usar `useRef` único.

**QA-16 (Baixa):** aplicar o mesmo limite de 50 MB no onboarding, e também um limite de profundidade/tamanho antes do `JSON.parse`.

**QA-17 (Baixa):** gerar `connect-src` a partir de `VITE_SUPABASE_URL` no build, ou documentar que só `*.supabase.co` funciona e recusar outras URLs em `validateConfig`. Para clickjacking, se possível hospedar com cabeçalho `frame-ancestors 'none'`. Em último caso, usar frame-busting em JS.

**QA-18 (Baixa):** contar o limite de convites por `created_by`. Limitar o número de Casas criadas por usuário.

**QA-19 (Baixa):** no servidor, exigir que o nó do HLC seja igual a `device_id`. No cliente, só aceitar `base === hlc` (replay) quando `opId` e `deviceId` indicarem restauração local; ou eliminar esse marcador e usar uma flag explícita.

**QA-20 (Baixa):** expor na UI as opções "Sair da Casa" e "Apagar Casa no servidor" (dono), e avisar claramente que apagar os dados locais não apaga o servidor.

**QA-21 (Baixa):** ao restaurar `name`, enviar também `normName: normalizeName(valor)`.

## 4. Verificados sem problema

Cada item está coberto por teste de regressão nos arquivos `qa-*`, salvo indicação em contrário.

- **Isolamento entre Casas (RLS):** um não-membro não lê `sync_ops`, `households`, `household_members` nem `invitations` de outra Casa, e não escreve nelas por RPC nem por `INSERT`. Cobertos também os casos de lote "da minha Casa" com op interna apontando para a Casa vítima (descartada) e de `householdId` divergente dentro do lote (só as ops da Casa do lote entram).
- **Escalonamento de membro para dono:** `UPDATE`/`DELETE` em `household_members`/`invitations` são negados. `remove_member` de terceiros e `revoke_invitation`/`delete_household` por não-dono não têm efeito ou dão erro.
- **SECURITY DEFINER:** todas as funções fixam `search_path` (verificado via `pg_proc.proconfig`). Todas as referências a tabelas são qualificadas com `public.`. `pg_catalog` é sempre pesquisado primeiro, então não há sombreamento de funções/operadores (análise).
- **anon:** não executa nenhuma RPC (`is_member`, `accept_invitation`, `create_household`, `push_ops`, `delete_household`) nem lê tabelas.
- **Convites:** 16 caracteres de um alfabeto de 32, com `get_byte % 32` uniforme porque 256 é múltiplo de 32, totalizando 80 bits; enumeração inviável. Só o SHA-256 é armazenado. O `select … for update` serializa a corrida em `uses` (análise; o PGlite não permite concorrência real). Expiração e revogação são respeitadas.
- **Log imutável:** sem `UPDATE`/`DELETE`; `user_id` não pode ser forjado. A constraint `households` com `entity_id = household_id` é respeitada, e lote com mais de 200 ops é recusado.
- **Realtime (análise):** a publicação inclui só `sync_ops`. `postgres_changes` aplica a RLS de `SELECT` ao papel `authenticated`, e o cliente usa o evento só como gatilho de pull. `household_members`/`invitations` não são publicados.
- **Cliente, pull e cursor:**
  - ops inválidas, de outra Casa ou com campos proibidos são descartadas sem travar, e o cursor avança;
  - reaplicar o mesmo lote é idempotente, sem conflitos duplicados;
  - em erro de rede, a outbox fica intacta e em ordem, e é enviada ao reconectar;
  - o HLC é monotônico mesmo com o relógio de parede voltando.
- **Merge:** o estado final converge em todas as 6 permutações testadas. Os campos `id`, `householdId` e `_v` são protegidos.
- **Backup:**
  - recusa checksum adulterado, registro de outra Casa, Casa diferente da esperada, tabela desconhecida e `_v` inválido;
  - não mistura registros com ids que já pertencem a outra Casa local;
  - `__proto__` no arquivo não contamina `Object.prototype`.
- **XSS (análise):** não há `dangerouslySetInnerHTML`, `innerHTML` nem `href` dinâmico com dados do usuário. React escapa os textos, incluindo os valores de conflito exibidos via `JSON.stringify`. A CSP de build tem `script-src 'self'`, `object-src 'none'` e `base-uri 'self'` (o e2e confere que a CSP está presente).
- **Tokens (análise):** a sessão do supabase-js fica em `localStorage` (`smart-pantry-auth`), o padrão do SDK. Só a anon key é usada, e `validateConfig` exige https (exceto localhost). O risco residual depende da ausência de XSS, que é mitigada pela CSP.
- **Deep link (análise):** o nome é cortado em 80 caracteres e sanitizado em `sanitizeText`, e a quantidade é limitada por `clampQty` (`Infinity`, `NaN` e negativos viram 1; o máximo é 9999).

## 5. Lacunas de teste remanescentes

- Concorrência real no Postgres: QA-04 e a corrida de `uses` em convites exigem duas conexões. Sugestão: rodar contra `supabase start` em CI.
- Não há teste automatizado das políticas do Realtime (exige o servidor Realtime).
- Não há e2e com dois navegadores contra um Supabase real, nem de múltiplas abas (QA-11) no navegador.
- Não há teste de migração do esquema Dexie v1 → v2. O comentário em `db.ts` cita `tests/unit/db-migrations.test.ts`, que **não existe**.
