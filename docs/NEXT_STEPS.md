# Próximos passos

## Para o responsável (ações que só você pode fazer)
1. **Hospedagem** (escolha uma):
   - (a) Tornar o repositório público → Settings › Pages › Source: *GitHub Actions* → rodar
     o workflow **Deploy GitHub Pages (manual)**. URL: `https://iancfreitas.github.io/mercado/`.
   - (b) Manter privado e usar Cloudflare Pages/Netlify (build: `npm run build`, saída `dist`,
     variáveis `VITE_SUPABASE_URL`/`VITE_SUPABASE_ANON_KEY` — valores em SETUP_SUPABASE).
2. **Supabase › Authentication › Email Templates**: incluir `{{ .Token }}` em *Magic Link* e *Confirm signup*.
3. (Uso real) SMTP próprio no Supabase.
4. Executar `TEST_PLAN.md §3` em dois iPhones e registrar resultados em `PROJECT_STATUS.md`.

## Para o próximo ciclo de desenvolvimento
1. Ao retomar: ler `PROJECT_STATUS.md`, `git log`, PRs abertos.
2. Corrigir o que o roteiro físico revelar.
3. UI de transferência de posse (RPC já existe).
4. Fase 2 — começar por funções puras e testáveis:
   - decodificador de QR/chave NFC-e (44 dígitos, DV mod 11, UF, AAMM, CNPJ, modelo 65, nº);
   - parser do HTML/texto da consulta SP (fixtures reais fornecidas por você);
   - importação transacional compra → preços → estoque → lista, com bloqueio por chave.
