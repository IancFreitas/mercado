# Problemas conhecidos e limitações

## Validação
- **KI-01 — Sem validação em iPhone real.** Todos os testes rodaram em Node/Chromium.
  Comportamento do Safari/WebKit (instalação, câmera, armazenamento, teclado) não verificado.
- **KI-02 — Projeto Supabase criado (`smart-pantry`, sa-east-1)** e migrações aplicadas. RLS validado no
  banco real via SQL (usuários simulados) e via API (anon → 401). **Ainda não exercitados:** login OTP
  real (exige e-mail), Realtime e sync de ponta a ponta entre dois aparelhos reais.
- **KI-04 — Template de e-mail do Supabase** ainda é o padrão (só link). É preciso incluir `{{ .Token }}`
  nos templates "Magic Link" e "Confirm signup" (ver SETUP_SUPABASE §4) — não há ferramenta para isso aqui.
- **KI-03 — E2E em Chromium**, não WebKit (o WebKit do Playwright não está instalado no ambiente).

## Plataforma (iOS/PWA)
- **KI-10 — Sem sincronização em segundo plano**: só sincroniza com o app aberto.
- **KI-11 — Siri não acessa os dados locais.** Só o deep link de adicionar item existe;
  pode abrir no Safari (armazenamento separado) em vez do PWA instalado — a verificar (TEST_PLAN §3.9).
- **KI-12 — iCloud**: sem backup automático; exportação manual via folha de compartilhamento.
- **KI-13 — Projetos Supabase gratuitos pausam** após ~7 dias sem uso.
- **KI-14 — SMTP padrão do Supabase** tem limite baixo de e-mails/hora (configurar SMTP próprio).

## Funcional
- ~~KI-20~~ UI de remover morador / sair / apagar Casa no servidor — **implementada**.
- ~~KI-21~~ Dono único não pode sair sem transferir (`transfer_ownership`) — **corrigido** (UI de transferência ainda não existe: o dono pode apagar a Casa ou pedir via SQL).
- **KI-22 — Exclusão da conta Auth** (auth.users) depende do painel do Supabase.
- **KI-23 — Edição vs exclusão concorrentes** não geram alerta de conflito (campos diferentes);
  mitigado por "Removidos recentemente" com restauração.
- **KI-24 — Log do servidor cresce indefinidamente** (sem compactação/snapshot). Ok para o volume
  esperado; planejar compactação na Fase 4.
- **KI-25 — Trocar de Casa** num mesmo aparelho só via "Apagar dados" + entrar; dados de Casas
  diferentes nunca se misturam (householdId), mas não há seletor de Casas.
- **KI-26 — Despensa, NFC-e, preços, previsões, modo compras**: não implementados (Fases 2–4);
  a UI indica isso explicitamente.

- **KI-27 — Alertas de conflito podem diferir entre aparelhos** (QA-13): o estado final converge
  sempre; apenas a lista de "conflitos para revisar" pode ter um item a mais em um aparelho.
- **KI-28 — Sem proteção contra clickjacking** (`frame-ancestors` não funciona via `<meta>`); depende de
  hospedagem com cabeçalhos HTTP próprios.
- **KI-29 — Avisos do Supabase Advisor** "SECURITY DEFINER executável por authenticated" (10 funções):
  intencionais — são as RPCs do app; cada uma valida `auth.uid()`/associação internamente.

- ~~KI-40~~ Câmera no PWA instalado do iPhone — **funcionou** em teste real (2026-11-08).
- **KI-41 — Itens da nota ainda não são importados**: a nota fica como "itens pendentes".
- **KI-42 — NF-e (modelo 55)** é aceita pela chave, mas a consulta pública dos itens exige CAPTCHA;
  itens dependerão de foto/OCR ou digitação.
- **KI-43 — Data da compra** vem da chave (mês/ano); o dia só é conhecido no QR de contingência
  offline. Será corrigida ao importar os itens.

## Dependências
- **KI-30** — 2 advisories *moderados* do npm em dependências de build do `vite-plugin-pwa`
  (workbox-build → glob/minimatch). Não entram no bundle entregue.
- **KI-31** — `.npmrc` com `legacy-peer-deps=true` por bug do npm 10 com peers opcionais do Vitest 4.

## Revisão de QA
Achados da revisão independente e status das correções: `docs/QA_REVIEW.md` §6.
