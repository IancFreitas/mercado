# Registro de decisões técnicas (ADRs)

## ADR-001 — PWA React + TypeScript + Vite
**Status:** aceita. **Contexto:** distribuir para iPhone sem App Store nem Apple
Developer Program. **Decisão:** PWA instalável pela Tela de Início (Safari).
**Consequências:** sem sincronização em segundo plano, sem acesso da Siri aos
dados locais, armazenamento separado do Safari (ver `docs/research/IOS_PWA_SIRI_ICLOUD.md`).

## ADR-002 — IndexedDB via Dexie 4, local-first
**Decisão:** estado completo no aparelho; servidor opcional. Esquema versionado
(`this.version(N)`) e nunca editado após publicado. `navigator.storage.persist()`
solicitado no boot.

## ADR-003 — Sincronização por log de operações + HLC + LWW por campo
**Alternativas avaliadas:**
| Opção | Prós | Contras |
|---|---|---|
| Supabase tabelas espelhadas + "updated_at" | simples | perda silenciosa em edições concorrentes; relógio do aparelho |
| CRDT completo (Yjs/Automerge) | merge rico | payload e complexidade altos; dados tabulares não precisam |
| PowerSync/ElectricSQL | prontos | serviço extra/custo, menos controle, dependência |
| iCloud/CloudKit | nativo | **não acessível por PWA** |
| Firebase Firestore | offline nativo | lock-in, regras menos expressivas que RLS SQL, LWW por documento |
| **Log de ops + HLC + LWW por campo (escolhida)** | convergência provada por testes, conflitos visíveis, backend trocável, barato | mais código próprio |

**Consequência:** o servidor é um relay com RLS; a lógica é testável sem rede.

## ADR-004 — Supabase (plano gratuito) como backend opcional
**Motivo:** Postgres + RLS (isolamento verificável em SQL), Auth com OTP,
Realtime, plano gratuito suficiente para algumas Casas. Sem servidor próprio.
**Riscos:** projetos gratuitos são pausados após ~1 semana sem uso (reativação
manual); limites de e-mail do SMTP padrão (configurar SMTP próprio para uso
real). **Projeto criado em 2026-11-03** com autorização (`smart-pantry`, sa-east-1, Free).

## ADR-005 — Login por código OTP de e-mail (não magic link)
Magic link abre no Safari, cuja sessão/armazenamento é separado do PWA instalado.
O código de 6 dígitos é digitado dentro do PWA. Exige template de e-mail com `{{ .Token }}`.

## ADR-006 — GitHub Pages para hospedagem
Estático, HTTPS, gratuito. Sem cabeçalhos HTTP próprios → CSP via `<meta>`
(aplicada só no build). Workflow de deploy é **manual** (`workflow_dispatch`) e
só deve ser usado após aprovação (publicação pública).

## ADR-007 — Exclusão lógica e conflitos visíveis
Para cumprir “nenhuma perda silenciosa”: deletes são `deleted: true` (reversíveis)
e valores perdedores de edições concorrentes vão para `conflicts`.

## ADR-008 — NFC-e: estratégia em camadas, sem burlar controles
Pesquisa (`docs/research/NFCE_SP.md`): nenhum endpoint da SEFAZ envia CORS; a
consulta manual por chave tem CAPTCHA; a URL do QR (homologação) não tem.
Decisão para a Fase 2: (1) decodificar QR/chave localmente; (2) abrir a página
da SEFAZ no Safari e o usuário colar/compartilhar o conteúdo para parsing local;
(3) OCR local; (4) manual. Proxy serverless fica como experimento opcional,
desligado por padrão, sem automação de CAPTCHA.

## ADR-009 — Preços em centavos inteiros
Evita erros de ponto flutuante; normalização por unidade (R$/kg, R$/l, R$/un)
será calculada e guardada em `priceHistory.normalizedCents`.

## ADR-010 — Vite 7 + Vitest 4 + `legacy-peer-deps`
Vitest 3 dependia de `tinypool` com advisory crítico; Vitest 4 resolve. O npm 10
falha ao resolver peers opcionais do Vitest 4 (`edgesOut` null) → `.npmrc` com
`legacy-peer-deps=true`. Restam 2 advisories moderados em dependências de build
do `vite-plugin-pwa` (workbox-build), sem impacto no código entregue ao usuário.

## ADR-011 — Rejeição por operação no push (após QA)
`push_ops` deixou de ser tudo-ou-nada: ops inválidas são simplesmente não aceitas
e o cliente as move para `rejectedOps` (visível ao usuário). Escrita direta em
`sync_ops` foi revogada; `push_ops` é SECURITY DEFINER com checagem explícita de
associação e `user_id = auth.uid()`. Motivo: uma op ruim não pode travar a Casa
(QA-08) e o lock por Casa não pode ser contornado (QA-04).

## ADR-012 — Hospedagem com repositório privado
O repositório é privado; GitHub Pages em repo privado exige plano pago. Opções:
(a) tornar o repositório público (não há segredos; a publishable key é pública);
(b) Cloudflare Pages / Netlify (gratuitos, aceitam repo privado; exigem conta);
(c) GitHub Pro. **Decisão pendente do responsável.**
