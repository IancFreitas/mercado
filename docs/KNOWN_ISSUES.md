# Problemas conhecidos e limitações

## Validação
- **KI-01 — Sem validação em iPhone real.** Todos os testes rodaram em Node/Chromium.
  Comportamento do Safari/WebKit (instalação, câmera, armazenamento, teclado) não verificado.
- **KI-02 — Sem projeto Supabase hospedado.** A migração foi testada em Postgres/PGlite
  com stubs de `auth.uid()` e papéis; Auth OTP, Realtime e PostgREST reais não foram exercitados.
- **KI-03 — E2E em Chromium**, não WebKit (o WebKit do Playwright não está instalado no ambiente).

## Plataforma (iOS/PWA)
- **KI-10 — Sem sincronização em segundo plano**: só sincroniza com o app aberto.
- **KI-11 — Siri não acessa os dados locais.** Só o deep link de adicionar item existe;
  pode abrir no Safari (armazenamento separado) em vez do PWA instalado — a verificar (TEST_PLAN §3.9).
- **KI-12 — iCloud**: sem backup automático; exportação manual via folha de compartilhamento.
- **KI-13 — Projetos Supabase gratuitos pausam** após ~7 dias sem uso.
- **KI-14 — SMTP padrão do Supabase** tem limite baixo de e-mails/hora (configurar SMTP próprio).

## Funcional
- **KI-20 — UI para apagar a Casa no servidor** (`delete_household`) e para remover membros ainda não existe (RPCs prontas).
- **KI-21 — Dono que sai da Casa** pode deixá-la sem dono (RPC permite). Planejado: impedir ou transferir.
- **KI-22 — Exclusão da conta Auth** (auth.users) depende do painel do Supabase.
- **KI-23 — Edição vs exclusão concorrentes** não geram alerta de conflito (campos diferentes);
  mitigado por "Removidos recentemente" com restauração.
- **KI-24 — Log do servidor cresce indefinidamente** (sem compactação/snapshot). Ok para o volume
  esperado; planejar compactação na Fase 4.
- **KI-25 — Trocar de Casa** num mesmo aparelho só via "Apagar dados" + entrar; dados de Casas
  diferentes nunca se misturam (householdId), mas não há seletor de Casas.
- **KI-26 — Despensa, NFC-e, preços, previsões, modo compras**: não implementados (Fases 2–4);
  a UI indica isso explicitamente.

## Dependências
- **KI-30** — 2 advisories *moderados* do npm em dependências de build do `vite-plugin-pwa`
  (workbox-build → glob/minimatch). Não entram no bundle entregue.
- **KI-31** — `.npmrc` com `legacy-peer-deps=true` por bug do npm 10 com peers opcionais do Vitest 4.

## Revisão de QA
Achados da revisão independente: ver `docs/QA_REVIEW.md` (status de cada um abaixo, após correções).
