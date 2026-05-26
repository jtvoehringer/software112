import { createSupabaseServerClient } from '@/lib/supabase/server'
import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import WeingartenForm from '@/components/weingarten/WeingartenForm'
import { updateWeingarten } from '../actions'

export const metadata: Metadata = { title: 'Weingarten bearbeiten – software:112' }

interface Props {
  params: Promise<{ id: string }>
}

export default async function WeingartenEditPage({ params }: Props) {
  const { id } = await params
  const supabase = await createSupabaseServerClient()

  const { data: weingarten } = await supabase
    .from('weingarten')
    .select('*')
    .eq('id', id)
    .single()

  if (!weingarten) notFound()

  const action = updateWeingarten.bind(null, id)

  return (
    <div className="max-w-2xl">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-sm text-s112-muted mb-6">
        <Link href="/weingarten" className="hover:text-s112-teal transition-colors">Weingarten</Link>
        <span>/</span>
        <span className="text-gray-700 font-medium">{weingarten.name}</span>
      </div>

      <div className="flex items-start justify-between mb-6">
        <h1 className="text-2xl font-bold text-gray-900">{weingarten.name}</h1>
        {!weingarten.aktiv && (
          <span className="bg-gray-100 text-gray-500 text-xs px-2 py-1 rounded-full font-medium">
            Inaktiv
          </span>
        )}
      </div>

      <WeingartenForm weingarten={weingarten} action={action} />
    </div>
  )
}
