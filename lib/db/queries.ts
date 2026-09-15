import { createServerClient } from '@/lib/supabase/server';
import { memberSchema, levelSchema } from './schema';

export async function getMemberById(id: string) {
  const supabase = await createServerClient();

  const { data, error } = await supabase
    .from('members')
    .select('id, email, display_name, membership_status, created_at, updated_at')
    .eq('id', id)
    .single();

  if (error) return null;

  return memberSchema.safeParse(data);
}

export async function getMemberByEmail(email: string) {
  const supabase = await createServerClient();

  const { data, error } = await supabase
    .from('members')
    .select('id, email, display_name, membership_status, created_at, updated_at')
    .eq('email', email)
    .single();

  if (error) return null;

  return memberSchema.safeParse(data);
}

// Phase 1C approved-email login.
// RLS on `members` only allows reading your own row through a Supabase Auth
// session, which this login model deliberately does not use. These two calls
// go through narrow SECURITY DEFINER functions instead — see
// supabase/migrations/20260914000001_member_login_lookup.sql
export async function lookupMemberIdByEmail(email: string) {
  const supabase = await createServerClient();

  const { data, error } = await supabase.rpc('lookup_member_id_by_email', {
    candidate_email: email,
  });

  if (error || !data) return null;

  return data as string;
}

export async function getMemberProfile(memberId: string) {
  const supabase = await createServerClient();

  const { data, error } = await supabase.rpc('get_member_profile', {
    member_id: memberId,
  });

  if (error || !data || data.length === 0) return null;

  return memberSchema.safeParse(data[0]);
}

export async function getAllLevels() {
  const supabase = await createServerClient();

  const { data, error } = await supabase
    .from('levels')
    .select('id, title, xp_required, sort_order')
    .order('sort_order', { ascending: true });

  if (error) return null;

  const levels = data.map((level) => levelSchema.safeParse(level));
  const validLevels = levels.filter((level) => level.success);

  return validLevels.map((level) => level.data);
}

export async function getMemberXP(user_id: string) {
  const supabase = await createServerClient();

  const { data, error } = await supabase
    .from('xp_ledger')
    .select('xp_amount')
    .eq('user_id', user_id);

  if (error) return 0;

  return (data ?? []).reduce((total, entry) => total + entry.xp_amount, 0);
}