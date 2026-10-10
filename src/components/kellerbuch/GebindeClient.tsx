'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Pencil } from 'lucide-react'
import { useDialog } from '@/components/ui/useDialog'
import { GEBINDE_MATERIALIEN } from '@/lib/keller/gebindeMaterial'
import SendenKnopf from '@/components/ui/SendenKnopf'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type R = Record<string, any>

interface Props {
  gebinde: R
  action: (formData: FormData) => Promise<void>
  inputCls: string
  labelCls: string
  /** Namen der Partnerbetriebe (Kellergemeinschaft) - zeigt den Freigabe-Schalter; null = keine Partner */
  partner?: string | null
}

export default function GebindeClient({ gebinde, action, inputCls, labelCls, partner = null }: Props) {
  const [open, setOpen] = useState(false)
  const dialog = useDialog(open, () => setOpen(false), 'Gebinde bearbeiten')
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
        className="text-s112-blue-700 hover:text-s112-blue-700/70 mr-2">
        <Pencil className="w-4 h-4" />
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30"
          onClick={() => setOpen(false)}>
          <div {...dialog} className="bg-white rounded-xl shadow-xl p-6 w-full max-w-md"
            onClick={e => e.stopPropagation()}>
            <h3 className="font-semibold text-s112-text mb-4">Gebinde bearbeiten</h3>
            <form data-ungespeichert action={handleSubmit} className="space-y-3">
              <div>
                <label className={labelCls}>Bezeichnung *</label>
                <input aria-label="Bezeichnung" name="name" required defaultValue={gebinde.name} className={inputCls} />
              </div>
              <div>
                <label className={labelCls}>Typ</label>
                <select aria-label="Typ" name="typ" defaultValue={gebinde.typ ?? ''} className={inputCls}>
                  <option value="">– kein –</option>
                  <option value="amphore">Amphore</option>
                  <option value="barrique">Barrique</option>
                  <option value="betonei">Betonei</option>
                  <option value="bottich">Bottich</option>
                  <option value="doppelbarrique">Doppel-Barrique</option>
                  <option value="gaerstaender">Gärständer</option>
                  <option value="holzfass">Holzfass</option>
                  <option value="immervolltank">Immervoll-Tank</option>
                  <option value="lagertank">Lagertank</option>
                  <option value="stahltank">Stahltank</option>
                  <option value="presse">Presse</option>
                  <option value="zisterne">Zisterne</option>
                  <option value="sonstiges">Sonstiges</option>
                </select>
              </div>
              <div>
                <label className={labelCls}>Fassungsvermögen (Liter)</label>
                <input aria-label="Fassungsvermögen (Liter)" name="volumen_liter" type="number" step="0.01" min={0}
                  defaultValue={gebinde.volumen_liter ?? ''} className={inputCls} />
              </div>
              <div>
                <label className={labelCls}>Standort</label>
                <input aria-label="Standort" name="standort" defaultValue={gebinde.standort ?? ''} className={inputCls} />
              </div>
              {/* KAN-48 AP11: BKI-Gebindeverzeichnis – Material (Vorschläge, ohne Angabe aus dem Typ) und Langbezeichnung */}
              <div>
                <label className={labelCls}>Material</label>
                <input aria-label="Material" name="material" maxLength={255} list={`gebinde-materialien-${gebinde.id}`} defaultValue={gebinde.material ?? ''} placeholder="leer = aus dem Typ" className={inputCls} />
                <datalist id={`gebinde-materialien-${gebinde.id}`}>{GEBINDE_MATERIALIEN.map(m => <option key={m} value={m} />)}</datalist>
              </div>
              <div>
                <label className={labelCls}>Bezeichnung lang</label>
                <input aria-label="Bezeichnung lang" name="bezeichnung_lang" maxLength={255} defaultValue={gebinde.bezeichnung_lang ?? ''} placeholder="z.B. Edelstahltank 5000 l mit Kühlmantel" className={inputCls} />
              </div>
              <div>
                <label className={labelCls}>Notizen</label>
                <input aria-label="Notizen" name="notizen" defaultValue={gebinde.notizen ?? ''} className={inputCls} />
              </div>
              <div className="flex flex-wrap gap-4 text-sm text-s112-text">
                <label className="inline-flex items-center gap-2 cursor-pointer"><input type="checkbox" name="stapler" value="true" defaultChecked={!!gebinde.stapler} className="accent-(--s112-teal)" /> mit Stapler versetzbar</label>
                {partner && (
                  <label className="inline-flex items-center gap-2 cursor-pointer"><input type="hidden" name="gemeinsam_sichtbar" value="1" /><input type="checkbox" name="gemeinsam" value="true" defaultChecked={gebinde.gemeinsam !== false} className="accent-(--s112-teal)" /> für Partnerbetriebe freigegeben ({partner})</label>
                )}
              </div>
              <div>
                <label className={labelCls}>Status</label>
                <select aria-label="Status" name="aktiv" defaultValue={String(gebinde.aktiv)} className={inputCls}>
                  <option value="true">Aktiv</option>
                  <option value="false">Inaktiv</option>
                </select>
              </div>
              <div className="flex gap-3 pt-2">
                <SendenKnopf
                  className="bg-s112-teal text-s112-yellow px-4 py-2 rounded-xl text-sm font-semibold hover:bg-s112-teal/90">
                  Speichern
                </SendenKnopf>
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
