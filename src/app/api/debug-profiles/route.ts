import { createSupabaseServerClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

export async function GET() {
  const supabase = await createSupabaseServerClient()
  const { data, error } = await (supabase.from('profiles') as any).select('*').limit(10)
  return NextResponse.json({ data, error, count: data?.length })
}
