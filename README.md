# Smart Pantry 🛒

Assistente de compras, despensa e preços para a sua Casa — **PWA local-first para
iPhone**, sem App Store, sem IA paga, funcionando offline e com compartilhamento
seguro entre moradores.

> **App:** https://iancfreitas.github.io/mercado/ (abra no Safari do iPhone › Compartilhar › Adicionar à Tela de Início)
>
> **Estado atual:** Fase 1 (fundação + sincronização). Ver [`docs/PROJECT_STATUS.md`](docs/PROJECT_STATUS.md).

## O que já funciona
- Casa individual 100% local (sem conta) ou compartilhada (Supabase, opcional).
- Lista de compras compartilhada: adicionar, quantidade/unidade/categoria/prioridade,
  marcar, remover/restaurar, detecção e união de duplicados, autor de cada item.
- Offline completo (service worker + IndexedDB) e sincronização ao reconectar.
- Edições simultâneas convergem; o valor perdedor é preservado para revisão.
- Convites de uso único (48 h), isolamento por Casa via RLS.
- Backup/restauração em JSON com verificação de integridade.
- Deep link para Atalhos: `#/lista?add=leite&qtd=2`.

## Desenvolvimento
```bash
npm ci
npm run dev        # http://localhost:5173
npm test           # unitários + SQL/RLS (PGlite)
npm run test:e2e   # Playwright (build + preview)
npm run build
```
Sincronização: ver [`docs/SETUP_SUPABASE.md`](docs/SETUP_SUPABASE.md). Sem ela, o app
funciona no modo individual.

## Documentação
[Arquitetura](docs/ARCHITECTURE.md) · [Decisões](docs/DECISIONS.md) ·
[Modelo de dados](docs/DATA_MODEL.md) · [Segurança/LGPD](docs/SECURITY.md) ·
[Roadmap](docs/ROADMAP.md) · [Plano de testes](docs/TEST_PLAN.md) ·
[Problemas conhecidos](docs/KNOWN_ISSUES.md) · [Próximos passos](docs/NEXT_STEPS.md) ·
[Pesquisa NFC-e SP](docs/research/NFCE_SP.md) · [Pesquisa iOS/Siri/iCloud](docs/research/IOS_PWA_SIRI_ICLOUD.md) ·
[Agentes](docs/AGENTS.md)
