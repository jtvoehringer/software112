import { getCurrentUserRole, canWrite } from '@/lib/auth/roles'
import { redirect } from 'next/navigation'
import { createLage } from '../actions'
import type { Metadata } from 'next'

export const metadata: Metadata = { title: 'Neue Ried – software:112' }

export default async function NeueLagePage() {
  const role = await getCurrentUserRole()
  if (!canWrite(role, 'rieden')) redirect('/lagen')

  async function handleSubmit(formData: FormData) {
    'use server'
    await createLage(formData)
    redirect('/lagen')
  }

  return (
    <div className="max-w-lg">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-s112-text">Neue Ried</h1>
        <p className="text-sm text-s112-muted mt-0.5">Neue Ried anlegen</p>
      </div>
      <div className="card">
        <form action={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-s112-text-1 mb-1">
              Name <span className="text-s112-err">*</span>
            </label>
            <input name="name" required placeholder="z.B. Wiege, Perchtoldsdorf"
              className="w-full border border-s112-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-s112-teal/40" />
          </div>
          <div>
            <label className="block text-sm font-medium text-s112-text-1 mb-1">Gemeinde</label>
            <input name="gemeinde" placeholder="z.B. Gumpoldskirchen"
              className="w-full border border-s112-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-s112-teal/40" />
          </div>
          <div>
            <label className="block text-sm font-medium text-s112-text-1 mb-1">Weinbaugebiet</label>
            <input name="weinbaugebiet" placeholder="z.B. Thermenregion"
              className="w-full border border-s112-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-s112-teal/40" />
          </div>
          <div>
            <label className="block text-sm font-medium text-s112-text-1 mb-1">Notizen</label>
            <textarea name="notizen" rows={3}
              className="w-full border border-s112-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-s112-teal/40" />
          </div>
          <div className="flex gap-3 pt-2">
            <button type="submit"
              className="bg-s112-teal text-white px-5 py-2 rounded-xl text-sm font-semibold hover:bg-opacity-90 transition-colors">
              Speichern
            </button>
            <a href="/lagen" className="px-5 py-2 rounded-xl text-sm font-medium text-s112-text-2 hover:text-s112-text">
              Abbrechen
            </a>
          </div>
        </form>
      </div>
    </div>
  )
}
