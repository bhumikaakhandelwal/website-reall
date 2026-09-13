import { createServerClient } from '@/lib/supabase/server';
import { NextResponse } from 'next/server';

export async function GET() {
  try {
    const supabase = await createServerClient();
    const { data: { user }, error } = await supabase.auth.getUser();

    if (error || !user) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    // Get member profile with safe, minimal fields
    const { data: member, error: memberError } = await supabase
      .from('members')
      .select('id, email, display_name, membership_status, created_at, updated_at')
      .eq('id', user.id)
      .single();

    if (memberError || !member) {
      return NextResponse.json(
        { error: 'Member not found' },
        { status: 404 }
      );
    }

    return NextResponse.json({ user: member });
  } catch (error) {
    console.error('Error in GET /api/auth/me:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}