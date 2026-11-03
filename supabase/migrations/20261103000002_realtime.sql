-- Habilita notificações Realtime para sync_ops (o Realtime respeita RLS).
-- O cliente usa a notificação apenas como "gatilho" para executar um pull;
-- a fonte de verdade continua sendo o pull ordenado por seq.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.sync_ops;
  end if;
end $$;
