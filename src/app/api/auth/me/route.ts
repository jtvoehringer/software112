import { createSupabaseServerClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
export const dynamic = 'force-dynamic'
export async function GET() {
  const s = await createSupabaseServerClient()
  const { data: { user } } = await s.auth.getUser()
  return NextResponse.json({ email: user?.email ?? null, id: user?.id ?? null })
}
