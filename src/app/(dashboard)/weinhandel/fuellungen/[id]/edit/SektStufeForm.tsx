'use client'

// KAN-190 (07.10.2026): Sekt g.U. – Hefelagerung seit der Tirage, Sekt-Stufe vergeben (nur abstufen) und degorgieren.
// Dieselben Regeln prüfen Server Action und RPC (lib/wein/sekt.ts, s112_sekt_stufe_setzen).

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { fehlerText } from '@/lib/fehler'
import { GAERMETHODEN, SEKT_STUFEN, moeglicheSektStufe, sektStufeLabel, volleMonate, type SektStufe } from '@/lib/wein/sekt'
import { sektStufeSetzen } from '../../../actions'

const datumDe = (d: string) => d.split('-').reverse().join('.')

export default function SektStufeForm({ fuellungId, tirage, gaermethode, stufe, degorgiertAm, heute, writeOk }: {
  fuellungId: string
  tirage: string
  gaermethode: string | null
  stufe: SektStufe | null
  degorgiertAm: string | null
  heute: string
  writeOk: boolean
}) {
  const router = useRouter()
  const [laeuft, starte] = useTransition()
  const [fehler, setFehler] = useState<string | null>(null)
  const stichtag = degorgiertAm ?? heute
  const monate = volleMonate(tirage, stichtag)
  // Hinweis ohne Lagenreinheit (die prüft die Server Action aus der Zusammensetzung)
  const moeglich = moeglicheSektStufe({ tirage, gaermethode, stichtag, lagenrein: false })
  const erlaubt = SEKT_STUFEN.filter(s => !stufe || SEKT_STUFEN.findIndex(x => x.value === s.value) <= SEKT_STUFEN.findIndex(x => x.value === stufe))

  function absenden(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const fd = new FormData(e.currentTarget)
    setFehler(null)
    starte(async () => {
      try {
        await sektStufeSetzen(fuellungId, fd)
        router.refresh()
      } catch (err) {
        setFehler(fehlerText(err, 'Sekt-Stufe konnte nicht gespeichert werden'))
      }
    })
  }

  return (
    <div className="space-y-3">
      <dl className="grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-1 text-sm">
        <div><dt className="text-xs text-s112-muted">Tirage</dt><dd className="tabular-nums">{datumDe(tirage)}</dd></div>
        <div><dt className="text-xs text-s112-muted">Gärmethode</dt><dd>{GAERMETHODEN.find(g => g.value === gaermethode)?.label ?? '–'}</dd></div>
        <div><dt className="text-xs text-s112-muted">Hefelagerung</dt><dd className="tabular-nums">{monate} Monate{degorgiertAm ? '' : ' (bis heute)'}</dd></div>
        <div><dt className="text-xs text-s112-muted">Degorgiert</dt><dd className="tabular-nums">{degorgiertAm ? datumDe(degorgiertAm) : '–'}</dd></div>
        <div className="col-span-2 sm:col-span-4"><dt className="text-xs text-s112-muted">Sekt-Stufe</dt>
          <dd className="font-medium">{sektStufeLabel(stufe) ?? 'noch keine'}{!stufe && moeglich ? <span className="text-xs text-s112-muted font-normal"> · möglich bis „{sektStufeLabel(moeglich)}“{moeglich === 'reserve' ? ' (Große Reserve nur lagenrein)' : ''}</span> : null}</dd>
        </div>
      </dl>
      {fehler && <p role="alert" className="text-sm bg-s112-err-bg text-s112-err-fg rounded-lg px-3 py-2">{fehler}</p>}
      {writeOk && (
        <form onSubmit={absenden} className="grid grid-cols-1 sm:grid-cols-3 gap-3 items-end">
          <div>
            <label htmlFor="sekt-stufe" className="block text-xs font-medium text-s112-text-2 mb-1">Sekt-Stufe</label>
            <select id="sekt-stufe" name="sekt_stufe" defaultValue={stufe ?? ''} className="input w-full py-2.5 sm:py-2 text-base sm:text-sm">
              <option value="">{stufe ? '– unverändert –' : '– noch keine –'}</option>
              {erlaubt.map(s => <option key={s.value} value={s.value}>{s.label} (≥ {s.monate} Monate)</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="sekt-degorgiert" className="block text-xs font-medium text-s112-text-2 mb-1">Degorgiert am</label>
            <input id="sekt-degorgiert" name="degorgiert_am" type="date" min={tirage} max={heute} defaultValue={degorgiertAm ?? ''}
              disabled={!!degorgiertAm} className="input w-full py-2.5 sm:py-2 text-base sm:text-sm" />
          </div>
          <button type="submit" disabled={laeuft}
            className="bg-s112-teal text-s112-yellow px-4 py-2 rounded-xl text-sm font-semibold hover:bg-s112-teal/90 disabled:opacity-50">
            {laeuft ? 'Wird gespeichert …' : 'Speichern'}
          </button>
          <p className="sm:col-span-3 text-xs text-s112-muted">
            Sekt Austria ≥ 9 Monate Hefelagerung, Reserve ≥ 18 und Große Reserve ≥ 36 Monate (beide nur traditionelle Flaschengärung, Große
            Reserve nur lagenrein). Gezählt ab der Tirage bis zum Degorgieren. Abstufen geht, aufwerten nicht; degorgiert wird einmal.
          </p>
        </form>
      )}
    </div>
  )
}
