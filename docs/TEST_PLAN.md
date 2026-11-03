# Plano de testes

## 1. Automatizados (executados no CI e localmente)

| Suíte | Arquivo | Cobre |
|---|---|---|
| HLC, merge, validação | `tests/unit/hlc-merge.test.ts` | monotonicidade, deriva, comutatividade, idempotência, conflitos, campos protegidos, ops inválidas |
| Motor de sync (PoC) | `tests/unit/sync-engine.test.ts` | 2 aparelhos, offline, reconexão, concorrência, duplicados, exclusão reversível, idempotência, paginação, isolamento, membro removido, convites, modo individual |
| Backend real (SQL) | `tests/unit/supabase-rls.test.ts` | migração em Postgres (PGlite) com papéis do Supabase: RLS, forja de user_id, log imutável, convites, LGPD |
| Backup e migração | `tests/unit/backup-db.test.ts` | export/restore, checksum, duplicidade, backup antigo, outra Casa, versão, replay p/ servidor, migração Dexie, persistência |
| QA adversarial | `tests/unit/qa-*.test.ts` | achados da revisão independente (docs/QA_REVIEW.md) |
| E2E PWA | `tests/e2e/app.spec.ts` | onboarding, lista, persistência após reload, **offline via service worker**, deep link, backup entre contextos, manifest/CSP |

Comandos:
```bash
npm test            # unitários + SQL
npm run test:e2e    # build + preview + Playwright
```

**Limites honestos:** E2E roda em **Chromium emulando iPhone**, não no Safari/WebKit.
A sincronização entre aparelhos é testada com servidor em memória (mesmas regras)
e o SQL/RLS em PGlite — **não** contra um projeto Supabase hospedado (ainda não
existe). Nada disso substitui o roteiro §3.

## 2. Mapa da prova de conceito obrigatória

| # | Cenário | Automatizado | iPhone real |
|---|---|---|---|
| 1 | Instalação em dois iPhones | — (manifest/SW testados) | 🔒 §3.1 |
| 2 | Criação de uma Casa | ✅ unit + E2E | 🔒 §3.2 |
| 3 | Convite do segundo usuário | ✅ unit + SQL | 🔒 §3.3 |
| 4 | Lista compartilhada | ✅ | 🔒 §3.4 |
| 5 | Inclusão nos dois aparelhos | ✅ | 🔒 §3.4 |
| 6 | Atualização sincronizada | ✅ | 🔒 §3.4 |
| 7 | Alterações offline | ✅ unit + E2E (SW) | 🔒 §3.5 |
| 8 | Sincronização após reconexão | ✅ | 🔒 §3.5 |
| 9 | Alterações simultâneas | ✅ (conflito preservado) | 🔒 §3.6 |
| 10 | Isolamento de 2ª Casa | ✅ memória + SQL | 🔒 §3.7 |

**Status da validação física: NÃO executada** (sem acesso a iPhones nesta sessão).

## 3. Roteiro manual — dois iPhones (Ian e Fernanda) + um terceiro aparelho

Pré-requisitos: projeto Supabase configurado (`docs/SETUP_SUPABASE.md`) e app
publicado em HTTPS (GitHub Pages). Anote iOS, modelo e resultado (OK/Falha + print).

### 3.1 Instalação
1. iPhone A: Safari → URL do app → Compartilhar → **Adicionar à Tela de Início**.
2. Abrir pelo ícone. ✔ abre em tela cheia (sem barra do Safari), ícone verde.
3. Repetir no iPhone B.

### 3.2 Casa
1. A: Criar minha Casa → nome "Ian", Casa "Casa Ian & Fernanda". ✔ selo "Só neste aparelho".
2. A: adicionar "Leite" e "Pão". Fechar app (deslizar) e reabrir. ✔ itens permanecem.

### 3.3 Convite
1. A: Casa › Compartilhamento → e-mail → código recebido → Confirmar. ✔ logado.
2. A: Ativar compartilhamento. ✔ selo "Sincronizado".
3. A: Gerar código de convite → enviar a B por mensagem privada.
4. B: Entrar com um convite → e-mail/código → nome "Fernanda" + código. ✔ B vê "Leite" e "Pão".
5. B: tentar usar o mesmo código de novo em outro e-mail. ✔ "Convite inválido".

### 3.4 Lista compartilhada
1. B adiciona "Arroz". ✔ aparece em A em até ~20 s (ou ao voltar ao app), com "· Fernanda".
2. A marca "Leite". ✔ B vê em "No carrinho".
3. A altera quantidade de "Pão" para 3. ✔ B vê 3×.

### 3.5 Offline e reconexão
1. A: Modo Avião. ✔ banner "Você está offline".
2. A: adicionar "Café", remover "Arroz". ✔ selo "Offline · N pendentes".
3. Fechar e reabrir o app ainda offline. ✔ abre e mostra os dados.
4. B (online): adicionar "Açúcar".
5. A: desligar Modo Avião, abrir o app. ✔ A recebe "Açúcar"; B recebe "Café" e a remoção de "Arroz".

### 3.6 Simultâneo
1. A e B em Modo Avião. Ambos editam a quantidade de "Pão" (A=2, B=5); A marca "Café".
2. Reconectar ambos e abrir o app nos dois. ✔ mesmo valor final nos dois; "Café" marcado em ambos.
3. ✔ Banner de conflito; Casa › Conflitos mostra a outra versão; "Usar outra" restaura e propaga.
4. Ambos adicionam "Ovos" offline → reconectar. ✔ aviso "aparece 2×" com botão Unir.

### 3.7 Isolamento
1. Aparelho C (outro e-mail): Criar minha Casa → ativar compartilhamento → adicionar "Cerveja".
2. ✔ A e B não veem "Cerveja"; C não vê itens de A/B.
3. C: tentar o código antigo de A. ✔ recusado.

### 3.8 Backup e troca de aparelho
1. A: Casa › Backup › Exportar → Salvar em Arquivos › iCloud Drive.
2. Apagar dados deste aparelho → onboarding → Restaurar de um backup. ✔ dados voltam.

### 3.9 Itens extras de plataforma (ver research/IOS_PWA_SIRI_ICLOUD.md §5)
- Atalho "Abrir URL" `https://<app>/#/lista?add=leite` → ✔ abre (registrar se abre no Safari ou no PWA) e adiciona "leite".
- Modo escuro do sistema ✔ cores corretas.

## 4. Critérios para declarar a Fase 1 concluída
Todos os itens automatizados verdes **e** roteiro §3.1–3.8 executado com sucesso
em dois iPhones reais, com resultados anotados em `PROJECT_STATUS.md`.
