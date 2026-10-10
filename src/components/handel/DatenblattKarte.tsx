'use client'

// KAN-220 (07.10.2026): Produktdatenblatt (PDF) und Bilder je Füllung (Flasche, Etikett) – Hochladen/Ersetzen/Entfernen
// über /api/weinhandel/fuellungen/<id>/bilder, das PDF über …/datenblatt.

import { useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { FileText, ImagePlus, Trash2 } from 'lucide-react'
import { BILD_ARTEN, BILD_LABEL, bildFehler, type BildArt } from '@/lib/handel/datenblatt'
import { fehlerText } from '@/lib/fehler'

export default function DatenblattKarte({ fuellungId, bilder, schreiben }: {
  fuellungId: string
  /** signierte Adressen der vorhandenen Bilder */
  bilder: Partial<Record<BildArt, string>>
  schreiben: boolean
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [fehler, setFehler] = useState<string | null>(null)
  const eingaben = useRef<Partial<Record<BildArt, HTMLInputElement | null>>>({})
  const basis = '/api/weinhandel/fuellungen/' + fuellungId   // API-Routen (nicht die Seite /weinhandel/fuellungen/<id>)

  async function antwortPruefen(res: Response, text: string) {
    if (res.ok) return
    const j = await res.json().catch(() => ({}))
    throw new Error((j as { fehler?: string }).fehler ?? text)
  }

  function hochladen(art: BildArt, datei: File | undefined) {
    setFehler(null)
    const pf = bildFehler(datei ?? null)
    if (pf || !datei) { setFehler(pf); return }
    const fd = new FormData()
    fd.set('art', art)
    fd.set('datei', datei)
    startTransition(async () => {
      try {
        await antwortPruefen(await fetch(`${basis}/bilder`, { method: 'POST', body: fd }), 'Das Bild konnte nicht gespeichert werden.')
        router.refresh()
      } catch (e) {
        setFehler(fehlerText(e, 'Das Bild konnte nicht gespeichert werden.'))
      } finally {
        const el = eingaben.current[art]
        if (el) el.value = ''
      }
    })
  }

  function entfernen(art: BildArt) {
    setFehler(null)
    if (!window.confirm(`Bild „${BILD_LABEL[art]}“ entfernen?`)) return
    startTransition(async () => {
      try {
        await antwortPruefen(await fetch(`${basis}/bilder?art=${art}`, { method: 'DELETE' }), 'Das Bild konnte nicht entfernt werden.')
        router.refresh()
      } catch (e) {
        setFehler(fehlerText(e, 'Das Bild konnte nicht entfernt werden.'))
      }
    })
  }

  return (
    <section className="card p-4 space-y-3">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h2 className="font-semibold text-s112-text text-sm">Produktdatenblatt</h2>
        <a href={`${basis}/datenblatt`} target="_blank" rel="noopener" className="btn-secondary text-sm inline-flex items-center gap-1.5">
          <FileText size={15} aria-hidden /> Datenblatt (PDF)
        </a>
      </div>
      <p className="text-xs text-s112-muted">
        Für Händler: Sorte, Herkunft, Qualität, Analysewerte (aus dem freigegebenen E-Label, sonst der jüngsten Analyse),
        Flaschengröße, Prüfnummer, Nährwerte und die Bilder unten.
      </p>
      <div className="grid grid-cols-2 gap-3">
        {BILD_ARTEN.map(art => (
          <div key={art} className="rounded-lg border border-s112-line p-2 flex flex-col items-center gap-2">
            <span className="text-xs font-medium text-s112-text-2">{BILD_LABEL[art]}</span>
            {bilder[art]
              // eslint-disable-next-line @next/next/no-img-element -- signierte Adresse aus einem privaten Bucket, nicht über next/image optimierbar
              ? <img src={bilder[art]} alt={`${BILD_LABEL[art]} der Füllung`} className="h-32 w-full object-contain" />
              : <div className="h-32 w-full flex items-center justify-center text-xs text-s112-muted bg-s112-bg rounded">kein Bild</div>}
            {schreiben && (
              <div className="flex gap-2">
                <label className="btn-secondary text-xs inline-flex items-center gap-1 cursor-pointer">
                  <ImagePlus size={13} aria-hidden /> {bilder[art] ? 'Ersetzen' : 'Hochladen'}
                  <input ref={el => { eingaben.current[art] = el }} type="file" accept="image/jpeg,image/png" className="sr-only"
                    disabled={pending} onChange={e => hochladen(art, e.target.files?.[0])} aria-label={`Bild ${BILD_LABEL[art]} hochladen`} />
                </label>
                {bilder[art] && (
                  <button type="button" disabled={pending} onClick={() => entfernen(art)}
                    className="text-xs text-s112-err inline-flex items-center gap-1" aria-label={`Bild ${BILD_LABEL[art]} entfernen`}>
                    <Trash2 size={13} aria-hidden /> Entfernen
                  </button>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
      {schreiben && <p className="text-xs text-s112-muted">JPEG oder PNG, höchstens 4 MB.</p>}
      {fehler && <p role="alert" className="text-sm text-s112-err">{fehler}</p>}
    </section>
  )
}
