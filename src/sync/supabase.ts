/**
 * Integração com Supabase: autenticação por código OTP de e-mail, RPCs de Casa
 * e convites, e o transporte de sincronização.
 *
 * Usa apenas a anon/publishable key (pública por design). Toda autorização é
 * feita no banco por RLS — ver supabase/migrations.
 */
import { createClient, type RealtimeChannel, type SupabaseClient } from '@supabase/supabase-js';
import type { SyncOp } from '../domain/types';
import { ForbiddenError, NetworkError, type SyncTransport } from './transport';

export interface SupabaseConfig {
  url: string;
  anonKey: string;
}

export function validateConfig(c: Partial<SupabaseConfig>): SupabaseConfig | null {
  if (!c.url || !c.anonKey) return null;
  try {
    const u = new URL(c.url);
    const local = u.hostname === 'localhost' || u.hostname === '127.0.0.1';
    // A CSP do build só libera *.supabase.co (QA-17); outros hosts falhariam em silêncio.
    if (!local && (u.protocol !== 'https:' || !u.hostname.endsWith('.supabase.co'))) return null;
  } catch {
    return null;
  }
  if (!/^[A-Za-z0-9._-]{20,}$/.test(c.anonKey)) return null;
  return { url: c.url.replace(/\/+$/, ''), anonKey: c.anonKey };
}

interface PgError {
  code?: string;
  message?: string;
  status?: number;
}

function mapError(e: PgError | null | undefined, fallback = 'Erro no servidor'): Error {
  if (!e) return new Error(fallback);
  const msg = e.message ?? fallback;
  if (/fetch|network|Failed to fetch|Load failed/i.test(msg) || e.status === 0) return new NetworkError();
  if (e.code === '42501' || /row-level security|forbidden|permission denied/i.test(msg)) return new ForbiddenError(msg);
  if (e.code === 'PGRST301' || e.status === 401) return new ForbiddenError('Sessão expirada — entre novamente');
  return new Error(msg);
}

export class SupabaseBackend {
  readonly client: SupabaseClient;
  private channel: RealtimeChannel | null = null;

  constructor(cfg: SupabaseConfig) {
    this.client = createClient(cfg.url, cfg.anonKey, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false, storageKey: 'smart-pantry-auth' },
    });
  }

  // --- Autenticação (código de 6 dígitos — funciona dentro do PWA instalado) ---
  async sendCode(email: string): Promise<void> {
    const { error } = await this.client.auth.signInWithOtp({ email: email.trim().toLowerCase(), options: { shouldCreateUser: true } });
    if (error) throw mapError(error);
  }

  async verifyCode(email: string, token: string): Promise<string> {
    const { data, error } = await this.client.auth.verifyOtp({ email: email.trim().toLowerCase(), token: token.trim(), type: 'email' });
    if (error || !data.user) throw mapError(error, 'Código inválido');
    return data.user.id;
  }

  async currentUser(): Promise<{ id: string; email?: string } | null> {
    const { data } = await this.client.auth.getSession();
    const u = data.session?.user;
    return u ? { id: u.id, email: u.email } : null;
  }

  async signOut(): Promise<void> {
    await this.client.auth.signOut();
  }

  // --- Casas e convites ---
  async myHouseholds(): Promise<string[]> {
    const { data, error } = await this.client.from('households').select('id');
    if (error) throw mapError(error);
    return (data ?? []).map((r: { id: string }) => r.id);
  }

  async createHousehold(id: string, displayName: string): Promise<void> {
    const { error } = await this.client.rpc('create_household', { p_id: id, p_display_name: displayName });
    if (error && !/already exists/.test(error.message)) throw mapError(error);
    if (error) {
      // Já existe: só é aceitável se eu já for membro.
      const mine = await this.myHouseholds();
      if (!mine.includes(id)) throw new ForbiddenError('Esta Casa já existe no servidor e você não é membro');
    }
  }

  async createInvitation(householdId: string): Promise<string> {
    const { data, error } = await this.client.rpc('create_invitation', { p_household: householdId, p_ttl_hours: 48 });
    if (error) throw mapError(error);
    return String(data);
  }

  async acceptInvitation(code: string, displayName: string): Promise<string> {
    const { data, error } = await this.client.rpc('accept_invitation', { p_code: code, p_display_name: displayName });
    if (error) throw mapError(error, 'Convite inválido ou expirado');
    return String(data);
  }

  async members(householdId: string): Promise<{ userId: string; role: string; displayName: string }[]> {
    const { data, error } = await this.client
      .from('household_members')
      .select('user_id, role, display_name')
      .eq('household_id', householdId);
    if (error) throw mapError(error);
    return (data ?? []).map((m: { user_id: string; role: string; display_name: string }) => ({
      userId: m.user_id,
      role: m.role,
      displayName: m.display_name,
    }));
  }

  async leave(householdId: string, userId: string): Promise<void> {
    const { error } = await this.client.rpc('remove_member', { p_household: householdId, p_user: userId });
    if (error) throw mapError(error);
  }

  async deleteHousehold(householdId: string): Promise<void> {
    const { error } = await this.client.rpc('delete_household', { p_household: householdId });
    if (error) throw mapError(error);
  }

  // --- Realtime: apenas um "gatilho" para pull ---
  watch(householdId: string, onChange: () => void): () => void {
    this.channel?.unsubscribe();
    this.channel = this.client
      .channel(`ops-${householdId}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'sync_ops', filter: `household_id=eq.${householdId}` }, () => onChange())
      .subscribe();
    return () => {
      this.channel?.unsubscribe();
      this.channel = null;
    };
  }

  transport(): SyncTransport {
    return {
      push: async (householdId, ops) => {
        let res;
        try {
          res = await this.client.rpc('push_ops', { p_household: householdId, p_ops: ops });
        } catch {
          throw new NetworkError();
        }
        if (res.error) throw mapError(res.error);
        const accepted = ((res.data ?? []) as unknown[]).map((x) =>
          typeof x === 'string' ? x : String((x as Record<string, unknown>).push_ops ?? (x as Record<string, unknown>).op_id),
        );
        return { accepted };
      },
      pull: async (householdId, since, limit) => {
        let res;
        try {
          res = await this.client
            .from('sync_ops')
            .select('seq, op_id, household_id, entity, entity_id, hlc, device_id, user_id, fields, base')
            .eq('household_id', householdId)
            .gt('seq', since)
            .order('seq', { ascending: true })
            .limit(limit + 1);
        } catch {
          throw new NetworkError();
        }
        if (res.error) throw mapError(res.error);
        const rows = (res.data ?? []) as Record<string, unknown>[];
        const ops: SyncOp[] = rows.slice(0, limit).map((r) => ({
          seq: Number(r.seq),
          opId: r.op_id as string,
          householdId: r.household_id as string,
          entity: r.entity as SyncOp['entity'],
          entityId: r.entity_id as string,
          hlc: r.hlc as string,
          deviceId: r.device_id as string,
          userId: r.user_id as string,
          fields: r.fields as Record<string, unknown>,
          base: r.base as Record<string, string | null>,
        }));
        return { ops, hasMore: rows.length > limit };
      },
    };
  }
}
