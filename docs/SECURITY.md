# Segurança, privacidade e LGPD

> Este documento descreve controles implementados **e** suas limitações.
> O Smart Pantry **não** oferece criptografia ponta a ponta: os dados
> sincronizados ficam legíveis para quem administra o projeto Supabase.

## 1. Modelo de ameaças (resumo)

| # | Ameaça | Controle | Verificação |
|---|---|---|---|
| T1 | Usuário de outra Casa lê dados | RLS `is_member(household_id)` em `sync_ops`, `households`, `household_members` | `tests/unit/supabase-rls.test.ts` |
| T2 | Usuário escreve em Casa alheia | INSERT direto revogado; `push_ops` (SECURITY DEFINER) exige `is_member`; ops com householdId divergente não aceitas | idem + banco real |
| T3 | Forjar autoria (`user_id`) | `push_ops` grava sempre `auth.uid()` | idem |
| T4 | Alterar/apagar histórico | sem UPDATE/DELETE em `sync_ops` (grants revogados) | idem |
| T5 | Auto-inclusão numa Casa | sem INSERT direto em `household_members`; só via RPC de convite | idem |
| T6 | Adivinhar convite | 80 bits, 48 h, 1 uso, só hash SHA-256 armazenado, rate limit de criação | idem |
| T7 | Servidor malicioso/comprometido injeta dados de outra Casa | cliente valida toda op e descarta householdId divergente | `sync-engine.test.ts` |
| T8 | Op malformada / payload gigante / HLC do futuro | validação no cliente (`validate.ts`) e no servidor (`op_invalid_reason`), rejeição por op | `hlc-merge`, `qa-*` |
| T9 | Backup adulterado/de outra Casa | checksum SHA-256, verificação de householdId por registro, versão | `backup-db.test.ts` |
| T10 | XSS | React escapa conteúdo; CSP `script-src 'self'`; sem `dangerouslySetInnerHTML` | revisão + E2E da CSP |
| T11 | Vazamento de segredo | só anon key (pública por design); `.env*` no `.gitignore`; nunca service_role | revisão |
| T12 | Relógio adulterado | HLC ignora relógio remoto > 24 h no futuro | `hlc-merge.test.ts` |

Revisão independente de QA/Segurança: `docs/QA_REVIEW.md`.

## 2. Autenticação e tokens
- Supabase Auth com código OTP por e-mail; sessão (JWT + refresh) guardada pelo
  supabase-js no `localStorage` do PWA (`smart-pantry-auth`).
- Risco: um XSS poderia ler o token → mitigado pela CSP restritiva.
- Sair da conta: Casa › Compartilhamento › Sair.

## 3. Inventário de dados (o que fica onde)

| Dado | No aparelho (IndexedDB) | Transmitido | No servidor (Supabase) |
|---|---|---|---|
| Itens da lista, Casa, (futuro) compras, preços, estoque | Sim | Sim, como ops (HTTPS) | Sim, em `sync_ops` (texto claro p/ admin do projeto) |
| Nome de exibição | Sim | Sim | `household_members.display_name` e campos `createdBy/updatedBy` das ops |
| E-mail | Não | Sim (login) | `auth.users` |
| Código de convite | Exibido uma vez | Sim | Apenas SHA-256 |
| Conflitos, outbox, backups (metadados), deviceId | Sim | deviceId vai nas ops | deviceId em `sync_ops.device_id` |
| Registro original da NFC-e (Fase 2) | Planejado: só local | Não | Não |
| Modo individual (sem conta) | Sim | **Nada** | **Nada** |

## 4. LGPD — minimização e direitos
- Sem analytics, sem rastreadores, sem terceiros além do Supabase escolhido pelo usuário.
- **Exportação:** Casa › Backup › Exportar (JSON documentado em `docs/BACKUP_FORMAT.md`).
- **Exclusão local:** Casa › Privacidade › Apagar dados deste aparelho.
- **Exclusão no servidor:** RPC `delete_household` (dono) apaga Casa, membros,
  convites e ops em cascata. *UI para isso ainda não implementada* (KNOWN_ISSUES).
- Conta Auth: exclusão do usuário em `auth.users` exige painel/admin (KNOWN_ISSUES).

## 5. Backup e recuperação
- Backup manual (arquivo) — o usuário guarda em Arquivos/iCloud Drive.
- Com sync ativo, o servidor também é uma cópia do log (não é backup independente).
- Troca de aparelho: (a) entrar na conta e na Casa → pull completo; ou (b) restaurar arquivo.

## 6. Limitações conhecidas
- Sem E2EE; admin do Supabase vê os dados.
- Supabase gratuito sem backups automáticos garantidos (PITR é pago).
- `connect-src` da CSP só permite `*.supabase.co` (self-host exigiria ajuste no build).
