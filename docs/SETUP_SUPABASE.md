# Configurar o Supabase (necessário apenas para compartilhar entre aparelhos)

> ⚠️ Criar o projeto é uma ação externa que requer a sua aprovação/conta.
> O plano gratuito não tem custo, mas projetos inativos por ~7 dias são pausados.

1. Crie um projeto em https://supabase.com (região recomendada: `sa-east-1` São Paulo).
2. **SQL Editor** → execute, em ordem, os arquivos de `supabase/migrations/`.
   (Alternativa: `supabase db push` com a CLI.)
3. **Authentication › Providers › Email**: habilitado (o código OTP já confirma o e-mail).
4. **Authentication › Email Templates › Magic Link**: inclua o código, ex.:
   `Seu código do Smart Pantry: <h2>{{ .Token }}</h2>` (o app usa o código, não o link).
5. **Authentication › URL Configuration**: Site URL = URL do app (GitHub Pages).
6. (Recomendado para uso real) **SMTP próprio** — o SMTP padrão tem limite
   baixo de envios por hora.
7. **Project Settings › API**: copie a *Project URL* e a *anon/publishable key*.
   - Para o build: `.env.local` com `VITE_SUPABASE_URL` e `VITE_SUPABASE_ANON_KEY`
     (ou secrets do GitHub Actions `VITE_SUPABASE_URL`/`VITE_SUPABASE_ANON_KEY`).
   - Ou cole no app em **Casa › Compartilhamento** (fica salvo só no aparelho).
   - **Nunca** use a `service_role` key no app.
8. Verifique em **Database › Publications** que `supabase_realtime` inclui `sync_ops`
   (a migração 0002 faz isso se a publicação existir).

## Verificação rápida
- Rode `npm test`: a suíte executa a mesma migração em Postgres (PGlite) e valida o RLS.
- No app: entre com seu e-mail, ative o compartilhamento, gere um convite.
