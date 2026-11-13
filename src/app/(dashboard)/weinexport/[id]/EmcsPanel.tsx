'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from '@/components/ui/Link'
import { zeigeErfolg } from '@/lib/ui/erfolg'
import { BEGLEITDOKUMENT_NR_MAX, MVV_CODE_MAX, VERBRAUCHSTEUERNR_MAX, VST_VERFAHREN, verbrauchsteuerFehler } from '@/lib/export/verbrauchsteuer'

// KAN-435 D2: Kasten „Verbrauchsteuer und Begleitdokument“ (früher „EMCS“) – Verfahren, ARC, MVV-Code, Nummer des
// Begleitdokuments und Verbrauchsteuernummer des Empfängers. Alles freiwillig; nach „Abgeschlossen“ sperrt die Datenbank.
interface Props {
  auftragId: string
  initialArc: string
  initialStatus: string
  initialVerfahren: string
  initialMvv: string
  initialBegleitdokument: string
  initialEmpfaengerNr: string
  /** Schreibrecht und Auftrag weder abgeschlossen noch storniert */
  aenderbar: boolean
}

const feld = 'w-full border border-s112-border rounded-lg px-3 py-1.5 text-sm focus:outline-hidden disabled:bg-s112-bg disabled:text-s112-muted'

export default function EmcsPanel({ auftragId, initialArc, initialStatus, initialVerfahren, initialMvv, initialBegleitdokument, initialEmpfaengerNr, aenderbar }: Props) {
  const router = useRouter()
  const [verfahren, setVerfahren] = useState(initialVerfahren)
  const [arc, setArc]       = useState(initialArc)
  const [status, setStatus] = useState(initialStatus)
  const [mvv, setMvv]       = useState(initialMvv)
  const [begleit, setBegleit] = useState(initialBegleitdokument)
  const [empfNr, setEmpfNr] = useState(initialEmpfaengerNr)
  const [saving, setSaving] = useState(false)
  const [fehler, setFehler] = useState<string | null>(null)

  async function speichern() {
    const eingabe = { verbrauchsteuer_verfahren: verfahren || null, mvv_code: mvv || null, begleitdokument_nr: begleit || null, empfaenger_verbrauchsteuernr: empfNr || null }
    const f = verbrauchsteuerFehler(eingabe)
    if (f) { setFehler(f); return }
    setSaving(true)
    try {
      setFehler(null)
      const res = await fetch('/api/weinexport/' + auftragId, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ emcs_arc_nummer: arc || null, emcs_status: status || null, ...eingabe }),
      })
      if (!res.ok) { setFehler((await res.json().catch(() => null))?.fehler ?? `Fehler (Status ${res.status})`); return }
      zeigeErfolg('Angaben zu Verbrauchsteuer und Begleitdokument gespeichert.')
      router.refresh()   // Hinweisliste und Datenblatt rechnet der Server neu
    } catch {
      setFehler('Die Angaben konnten nicht gespeichert werden – bitte die Verbindung prüfen.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="bg-white rounded-xl border border-s112-border p-5 mt-5">
      <h2 className="font-semibold text-s112-text mb-1">Verbrauchsteuer und Begleitdokument</h2>
      <p className="text-[11px] text-s112-muted mb-3">Alle Angaben sind freiwillig. software:112 übermittelt nichts an EMCS.</p>
      <div className="space-y-2">
        <label htmlFor="vst-verfahren" className="block text-xs text-s112-muted">Verbrauchsteuerverfahren</label>
        <select id="vst-verfahren" value={verfahren} onChange={e => setVerfahren(e.target.value)} disabled={!aenderbar} className={feld}>
          <option value="">nicht festgelegt</option>
          {Object.entries(VST_VERFAHREN).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
        <label htmlFor="vst-arc" className="block text-xs text-s112-muted mt-1">ARC-Nummer (aus EMCS)</label>
        <input id="vst-arc" value={arc} onChange={e => setArc(e.target.value)} disabled={!aenderbar} maxLength={30}
          placeholder="AT123456789012345" className={feld} />
        <label htmlFor="vst-status" className="block text-xs text-s112-muted mt-1">EMCS-Status</label>
        <select id="vst-status" value={status} onChange={e => setStatus(e.target.value)} disabled={!aenderbar} className={feld}>
          <option value="">nicht eingereicht</option>
          <option value="draft">Entwurf</option>
          <option value="submitted">Eingereicht</option>
          <option value="accepted">Akzeptiert</option>
          <option value="cancelled">Storniert</option>
        </select>
        <label htmlFor="vst-empfaenger" className="block text-xs text-s112-muted mt-1">Verbrauchsteuernummer des Empfängers</label>
        <input id="vst-empfaenger" value={empfNr} onChange={e => setEmpfNr(e.target.value)} disabled={!aenderbar} maxLength={VERBRAUCHSTEUERNR_MAX + 6}
          placeholder="z. B. DE12345678901" className={feld} />
        <label htmlFor="vst-mvv" className="block text-xs text-s112-muted mt-1">MVV-Code</label>
        <input id="vst-mvv" value={mvv} onChange={e => setMvv(e.target.value)} disabled={!aenderbar} maxLength={MVV_CODE_MAX} className={feld} />
        <label htmlFor="vst-begleit" className="block text-xs text-s112-muted mt-1">Nummer des Begleitdokuments</label>
        <input id="vst-begleit" value={begleit} onChange={e => setBegleit(e.target.value)} disabled={!aenderbar} maxLength={BEGLEITDOKUMENT_NR_MAX} className={feld} />
        {aenderbar && (
          <button type="button" disabled={saving} onClick={() => void speichern()}
            className="w-full text-xs bg-s112-teal text-s112-yellow py-1.5 rounded-lg hover:bg-s112-teal/90 disabled:opacity-40">
            {saving ? 'Speichern …' : 'Speichern'}
          </button>
        )}
        {fehler && <p role="alert" className="text-xs text-s112-err">{fehler}</p>}
        {/* KAN-435 D1: Datenblatt zum Erfassen in EMCS statt der nicht einreichbaren e-AD-XML-Datei */}
        <Link href={'/weinexport/' + auftragId + '/emcs-datenblatt'}
          className="block text-center text-xs border border-s112-border text-s112-text-2 py-1.5 rounded-lg hover:bg-s112-bg mt-1">
          Datenblatt für EMCS
        </Link>
        <p className="text-[11px] text-s112-muted">Das Datenblatt zeigt die Angaben zum Erfassen in EMCS; die ARC-Nummer trägst du danach hier ein.</p>
      </div>
    </div>
  )
}
