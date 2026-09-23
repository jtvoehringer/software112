'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Pencil } from 'lucide-react'
import { useDialog } from '@/components/ui/useDialog'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type R = Record<string, any>

interface Props {
  plan: R
  action: (formData: FormData) => Promise<void>
  inputCls: string
  labelCls: string
}

export default function KellerplanEditModal({ plan, action, inputCls, labelCls }: Props) {
  const [open, setOpen] = useState(false)
  const dialog = useDialog(open, () => setOpen(false), 'Kellerplan bearbeiten')
  const router = useRouter()

  async function handleSubmit(formData: FormData) {
    await action(formData)
    setOpen(false)
    router.refresh()
  }

  return (
    <>
      <button onClick={() => setOpen(true)}
        title="Bearbeiten" aria-label="Bearbeiten"
        className="text-s112-blue-700 hover:text-s112-blue-700/70">
        <Pencil className="w-4 h-4" />
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30"
          onClick={() => setOpen(false)}>
          <div {...dialog} className="bg-white rounded-xl shadow-xl p-6 w-full max-w-sm"
            onClick={e => e.stopPropagation()}>
            <h3 className="font-semibold text-s112-text mb-4">Kellerplan bearbeiten</h3>
            <form action={handleSubmit} className="space-y-3">
              <div>
                <label className={labelCls}>Name *</label>
                <input aria-label="Name" name="name" required defaultValue={plan.name} className={inputCls} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={labelCls}>Breite (m)</label>
                  <input aria-label="Breite (m)" name="breite_m" type="number" step="0.5" min="1"
                    defaultValue={plan.breite_m} className={inputCls} />
                </div>
                <div>
                  <label className={labelCls}>Länge (m)</label>
                  <input aria-label="Länge (m)" name="laenge_m" type="number" step="0.5" min="1"
                    defaultValue={plan.laenge_m} className={inputCls} />
                </div>
              </div>
              <div>
                <label className={labelCls}>Notizen</label>
                <input aria-label="Notizen" name="notizen" defaultValue={plan.notizen ?? ''} className={inputCls} />
              </div>
              <div className="flex gap-3 pt-2">
                <button type="submit"
                  className="bg-s112-teal text-white px-4 py-2 rounded-xl text-sm font-semibold hover:bg-opacity-90">
                  Speichern
                </button>
                <button type="button" onClick={() => setOpen(false)}
                  className="px-4 py-2 rounded-xl text-sm text-s112-text-2 hover:text-s112-text">
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
