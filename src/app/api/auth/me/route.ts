import { createSupabaseServerClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { pruefeZweiFaktor } from '@/lib/api/zweiFaktor'
export const dynamic = 'force-dynamic'
export async function GET() {
  const zweiFaktor = await pruefeZweiFaktor()
  if (zweiFaktor) return zweiFaktor
  const s = await createSupabaseServerClient()
  const { data: { user } } = await s.auth.getUser()
  return NextResponse.json({ email: user?.email ?? null, id: user?.id ?? null })
}
