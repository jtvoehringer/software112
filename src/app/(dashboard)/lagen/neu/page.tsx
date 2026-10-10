import { zielNachAbschluss } from '@/lib/navigation/zurueck'
import { AbbrechenKnopf, ZurueckFeld } from '@/components/navigation/Abbrechen'
import { getCurrentUserRole, canWrite } from '@/lib/auth/roles'
import { redirect } from 'next/navigation'
import { createLage } from '../actions'
import type { Metadata } from 'next'
import SendenKnopf from '@/components/ui/SendenKnopf'

export const metadata: Metadata = { title: 'Neue Ried' }

export default async function NeueLagePage() {
  const role = await getCurrentUserRole()
  if (!canWrite(role, 'rieden')) redirect('/lagen')

  async function handleSubmit(formData: FormData) {
    'use server'
    await createLage(formData)
    redirect(zielNachAbschluss(formData.get('zurueck'), '/lagen', 'angelegt'))   // KAN-224
  }

  return (
    <div className="max-w-lg">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-s112-text">Neue Ried</h1>
        <p className="text-sm text-s112-muted mt-0.5">Neue Ried anlegen</p>
      </div>
      <div className="card">
        <form action={handleSubmit} className="space-y-4">
        <ZurueckFeld standard="/lagen" />
          <div>
            <label className="block text-sm font-medium text-s112-text-1 mb-1">
              Name <span className="text-s112-err">*</span>
            </label>
            <input aria-label="Name" name="name" required placeholder="z.B. Wiege, Perchtoldsdorf"
              className="w-full border border-s112-border rounded-lg px-3 py-2 text-sm focus:outline-hidden focus:ring-2 focus:ring-s112-teal/40" />
          </div>
          <div>
            <label className="block text-sm font-medium text-s112-text-1 mb-1">Gemeinde</label>
            <input aria-label="Gemeinde" name="gemeinde" placeholder="z.B. Gumpoldskirchen"
              className="w-full border border-s112-border rounded-lg px-3 py-2 text-sm focus:outline-hidden focus:ring-2 focus:ring-s112-teal/40" />
          </div>
          <div>
            <label className="block text-sm font-medium text-s112-text-1 mb-1">Amtliche Ried</label>
            <input aria-label="Amtliche Ried" name="amtliche_ried" placeholder="leer = wie der Name"
              className="w-full border border-s112-border rounded-lg px-3 py-2 text-sm focus:outline-hidden focus:ring-2 focus:ring-s112-teal/40" />
            {/* KAN-110: Grundlage der 85-%-Regel beim Verschnitt (§ 21 WeinG) */}
            <p className="text-xs text-s112-muted mt-1">
              Riedbezeichnung laut Riedenverzeichnis (§ 21 WeinG) – Grundlage der Riedangabe beim Verschnitt (mindestens 85 % aus derselben Ried).
              Mehrere Lagen können dieselbe Ried tragen, z. B. „Glaslautern I“ und „Glaslautern II“ → „Glaslautern“. Leer = nicht gepflegt.
            </p>
          </div>
          {/* KAN-165: das Weinbaugebiet ergibt sich aus dem Herkunft-Code (BKI) der Grundstücke – kein eigenes Feld mehr */}
          <p className="text-xs text-s112-muted">
            Das Weinbaugebiet ergibt sich aus dem Herkunft-Code (BKI) der Grundstücke der Rieden dieser Lage.
          </p>
          <div>
            <label className="block text-sm font-medium text-s112-text-1 mb-1">Notizen</label>
            <textarea aria-label="Notizen" name="notizen" rows={3}
              className="w-full border border-s112-border rounded-lg px-3 py-2 text-sm focus:outline-hidden focus:ring-2 focus:ring-s112-teal/40" />
          </div>
          <div className="flex gap-3 pt-2">
            <SendenKnopf
              className="bg-s112-teal text-s112-yellow px-5 py-2 rounded-xl text-sm font-semibold hover:bg-s112-teal/90 transition-colors">
              Speichern
            </SendenKnopf>
            <AbbrechenKnopf standard="/lagen"
            className="px-5 py-2 rounded-xl text-sm font-medium text-s112-text-2 hover:text-s112-text" />
          </div>
        </form>
      </div>
    </div>
  )
}
