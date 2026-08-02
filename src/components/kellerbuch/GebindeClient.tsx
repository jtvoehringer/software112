'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Pencil } from 'lucide-react'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type R = Record<string, any>

interface Props {
  gebinde: R
  action: (formData: FormData) => Promise<void>
  inputCls: string
  labelCls: string
}

export default function GebindeClient({ gebinde, action, inputCls, labelCls }: Props) {
  const [open, setOpen] = useState(false)
  const router = useRouter()

  async function handleSubmit(formData: FormData) {
    await action(formData)
    setOpen(false)
    router.refresh()
  }

  return (
    <>
      <button onClick={() => setOpen(o => !o)}
        title="Bearbeiten" aria-label="Bearbeiten"
        className="text-s112-teal hover:text-s112-teal/70 mr-2">
        <Pencil className="w-4 h-4" />
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30"
          onClick={() => setOpen(false)}>
          <div className="bg-white rounded-2xl shadow-xl p-6 w-full max-w-md"
            onClick={e => e.stopPropagation()}>
            <h3 className="font-semibold text-gray-800 mb-4">Gebinde bearbeiten</h3>
            <form action={handleSubmit} className="space-y-3">
              <div>
                <label className={labelCls}>Bezeichnung *</label>
                <input name="name" required defaultValue={gebinde.name} className={inputCls} />
              </div>
              <div>
                <label className={labelCls}>Typ</label>
                <select name="typ" defaultValue={gebinde.typ ?? ''} className={inputCls}>
                  <option value="">– kein –</option>
                  <option value="lagertank">Lagertank</option>
                  <option value="immervolltank">Immervoll-Tank</option>
                  <option value="holzfass">Holzfass</option>
                  <option value="betonei">Betonei</option>
                  <option value="amphore">Amphore</option>
                  <option value="sonstiges">Sonstiges</option>
                </select>
              </div>
              <div>
                <label className={labelCls}>Fassungsvermögen (Liter)</label>
                <input name="volumen_liter" type="number" step="0.01" min={0}
                  defaultValue={gebinde.volumen_liter ?? ''} className={inputCls} />
              </div>
              <div>
                <label className={labelCls}>Standort</label>
                <input name="standort" defaultValue={gebinde.standort ?? ''} className={inputCls} />
              </div>
              <div>
                <label className={labelCls}>Status</label>
                <select name="aktiv" defaultValue={String(gebinde.aktiv)} className={inputCls}>
                  <option value="true">Aktiv</option>
                  <option value="false">Inaktiv</option>
                </select>
              </div>
              <div className="flex gap-3 pt-2">
                <button type="submit"
                  className="bg-s112-teal text-white px-4 py-2 rounded-xl text-sm font-semibold hover:bg-opacity-90">
                  Speichern
                </button>
                <button type="button" onClick={() => setOpen(false)}
                  className="px-4 py-2 rounded-xl text-sm text-gray-600 hover:text-gray-800">
                  Abbrechen
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  )
}
