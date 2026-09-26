'use client'
// ── Dialog „Soll ein Lead angelegt werden?“ (E-Mail → Lead, 15.9.2026) ────────
// Wird aus dem NachrichtenClient geöffnet, wenn der Absender einer geöffneten
// E-Mail weder Kontakt noch Firma noch Lead ist. Ablauf wie beim Visitenkarten-
// Scan: KI liest Signatur und Inhalt (/api/nachrichten/lead-vorschlag), die
// Felder werden vorbelegt und bleiben editierbar; Segment, Firma (neu/
// bestehend/keine), Rabattgruppe, Zahlungsziel und Notizen werden im Dialog
// erfasst. Speichern über die Server Action createLeadAusEmail (aktiver
// Betrieb über getCurrentMembership, siehe crm/actions.ts).

import { useEffect, useState } from 'react'
import Link from '@/components/ui/Link'
import { X, Sparkles, UserPlus, Building2 } from 'lucide-react'
import { SEGMENTE, LAENDER } from '@/lib/crm/types'
import type { LeadVorbelegung } from '@/lib/crm/leadEmail'
import { createLeadAusEmail, type LeadAusEmailDaten } from '../crm/actions'
import { useDialog } from '@/components/ui/useDialog'

export type LeadMail = {
  id: string; conversationId: string | null; betreff: string; von: string; vonName: string; an: string; datum: string
  bodyText: string; bodyHtml: string | null
  // Postfach der Mail (eigenes/geteilt) – createLeadAusEmail lädt den Inhalt dort selbst nach (KAN-137)
  mailbox?: 'own' | 'shared'
}
type FirmaOption = { id: string; name: string; ort: string | null; segment: string; is_lead: boolean }
type Rabattgruppe = { id: string; name: string; rabatt_pct: number }

type Props = {
  mail: LeadMail
  onClose: () => void
  onAngelegt: (info: { typ: 'kontakt'; id: string; name: string; firmaId: string | null }) => void
}

const inputCls = 'w-full border border-s112-line-str rounded-lg px-3 py-2 text-sm text-s112-text placeholder:text-s112-tertiary focus:outline-none focus:ring-2 focus:ring-s112-teal focus:border-transparent bg-white'
const labelCls = 'block text-xs font-medium text-s112-text-2 mb-1'

export default function LeadDialog({ mail, onClose, onAngelegt }: Props) {
  const dialog = useDialog(true, onClose, 'Lead aus E-Mail anlegen')
  const [phase, setPhase] = useState<'analyse' | 'form' | 'speichern' | 'fertig'>('analyse')
  const [fehler, setFehler] = useState<string | null>(null)
  const [kiModell, setKiModell] = useState<string | null>(null)
  const [firmen, setFirmen] = useState<FirmaOption[]>([])
  const [kandidaten, setKandidaten] = useState<FirmaOption[]>([])
  const [rabattgruppen, setRabattgruppen] = useState<Rabattgruppe[]>([])
  const [ergebnis, setErgebnis] = useState<{ kontaktId: string; firmaId: string | null; name: string } | null>(null)

  // Formularfelder
  const [vorname, setVorname] = useState('')
  const [nachname, setNachname] = useState('')
  const [email, setEmail] = useState('')
  const [telefon, setTelefon] = useState('')
  const [mobil, setMobil] = useState('')
  const [position, setPosition] = useState('')
  const [strasse, setStrasse] = useState('')
  const [plz, setPlz] = useState('')
  const [ort, setOrt] = useState('')
  const [land, setLand] = useState('AT')
  const [segment, setSegment] = useState('privat')
  const [rabattgruppeId, setRabattgruppeId] = useState('')
  const [zahlungsziel, setZahlungsziel] = useState('14')
  const [notizen, setNotizen] = useState('')
  const [firmaModus, setFirmaModus] = useState<'keine' | 'neu' | 'bestehend'>('keine')
  const [firmaName, setFirmaName] = useState('')
  const [firmaWebsite, setFirmaWebsite] = useState('')
  const [firmaId, setFirmaId] = useState('')
  const [firmaSuche, setFirmaSuche] = useState('')

  useEffect(() => {
    let aktiv = true
    ;(async () => {
      try {
        const res = await fetch('/api/nachrichten/lead-vorschlag', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ von: mail.von, vonName: mail.vonName, betreff: mail.betreff, bodyText: mail.bodyText, bodyHtml: mail.bodyHtml }),
        })
        const d = await res.json()
        if (!aktiv) return
        if (d.fehler) { setFehler(d.fehler); setPhase('form'); setEmail(mail.von); return }
        const v = d.vorbelegung as LeadVorbelegung
        setVorname(v.vorname ?? ''); setNachname(v.nachname ?? ''); setEmail(v.email ?? mail.von)
        setTelefon(v.telefon ?? ''); setMobil(v.mobil ?? ''); setPosition(v.position ?? '')
        setStrasse(v.strasse ?? ''); setPlz(v.plz ?? ''); setOrt(v.ort ?? ''); setLand(v.land && LAENDER.includes(v.land) ? v.land : 'AT')
        setSegment(v.segment ?? 'privat')
        setNotizen([v.anliegen ? `Anliegen: ${v.anliegen}` : null, `Lead aus E-Mail vom ${new Date(mail.datum).toLocaleDateString('de-AT')} („${mail.betreff}“)`].filter(Boolean).join('\n'))
        setFirmen(d.firmen ?? []); setKandidaten(d.kandidaten ?? []); setRabattgruppen(d.rabattgruppen ?? [])
        setKiModell(d.kiModell ?? null)
        if (d.kandidaten?.length) { setFirmaModus('bestehend'); setFirmaId(d.kandidaten[0].id) }
        else if (v.firma) { setFirmaModus('neu'); setFirmaName(v.firma); setFirmaWebsite(v.website ?? '') }
        else { setFirmaModus('keine'); setFirmaWebsite(v.website ?? '') }
        if (v.firma || d.kandidaten?.length) setZahlungsziel('30')
        setPhase('form')
      } catch (e) {
        if (!aktiv) return
        setFehler('Analyse fehlgeschlagen: ' + String(e)); setEmail(mail.von); setPhase('form')
      }
    })()
    return () => { aktiv = false }
    // Nur je Mail-ID neu analysieren - das mail-Objekt wird vom Parent bei jedem Render neu gebaut
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mail.id])

  async function speichern() {
    if (!nachname.trim()) { setFehler('Nachname ist ein Pflichtfeld'); return }
    if (firmaModus === 'neu' && !firmaName.trim()) { setFehler('Firmenname fehlt'); return }
    if (firmaModus === 'bestehend' && !firmaId) { setFehler('Bitte eine Firma wählen'); return }
    setFehler(null); setPhase('speichern')
    const zz = parseInt(zahlungsziel, 10)
    const daten: LeadAusEmailDaten = {
      vorname: vorname.trim() || null, nachname: nachname.trim(), email: email.trim() || null,
      telefon: telefon.trim() || null, mobil: mobil.trim() || null, position: position.trim() || null,
      strasse: strasse.trim() || null, plz: plz.trim() || null, ort: ort.trim() || null, land,
      segment, rabattgruppe_id: rabattgruppeId || null, zahlungsziel_tage: isNaN(zz) ? null : zz,
      notizen: notizen.trim() || null,
      firma: { modus: firmaModus, id: firmaModus === 'bestehend' ? firmaId : null, name: firmaModus === 'neu' ? firmaName.trim() : null, website: firmaWebsite.trim() || null, segment: firmaModus === 'neu' ? segment : null },
      mail: { id: mail.id, conversationId: mail.conversationId, betreff: mail.betreff, von: mail.von, vonName: mail.vonName, an: mail.an, datum: mail.datum, bodyText: mail.bodyText, mailbox: mail.mailbox },
    }
    const r = await createLeadAusEmail(daten)
    if (r.error || !r.kontaktId) { setFehler(r.error ?? 'Speichern fehlgeschlagen'); setPhase('form'); return }
    const name = [vorname.trim(), nachname.trim()].filter(Boolean).join(' ')
    setErgebnis({ kontaktId: r.kontaktId, firmaId: r.firmaId ?? null, name })
    setPhase('fertig')
    onAngelegt({ typ: 'kontakt', id: r.kontaktId, name, firmaId: r.firmaId ?? null })
  }

  const firmenGefiltert = firmaSuche.trim()
    ? firmen.filter(f => f.name.toLowerCase().includes(firmaSuche.toLowerCase())).slice(0, 50)
    : [...kandidaten, ...firmen.filter(f => !kandidaten.some(k => k.id === f.id))].slice(0, 50)

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-s112-text/40 p-4" onClick={phase === 'fertig' ? onClose : undefined}>
      <div {...dialog} className="bg-white rounded-xl shadow-xl w-full max-w-2xl max-h-[92vh] flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-3 border-b border-s112-line">
          <h2 className="text-base font-semibold text-s112-text inline-flex items-center gap-2"><UserPlus className="w-4 h-4 text-s112-teal" /> Lead aus E-Mail anlegen</h2>
          <button onClick={onClose} className="text-s112-tertiary hover:text-s112-text" aria-label="Schließen"><X className="w-4 h-4" /></button>
        </div>

        {phase === 'analyse' && (
          <div className="p-8 text-center space-y-3">
            <Sparkles className="w-8 h-8 text-s112-teal mx-auto animate-pulse" />
            <p className="text-sm text-s112-text-2">KI liest Signatur und Anliegen aus der E-Mail von <b className="text-s112-text">{mail.vonName || mail.von}</b>…</p>
          </div>
        )}

        {(phase === 'form' || phase === 'speichern') && (
          <>
            <div className="px-5 py-4 overflow-y-auto space-y-4 text-sm">
              <p className="text-xs text-s112-text-2">
                Absender <b className="text-s112-text">{mail.von}</b> ist noch nicht im CRM. Daten prüfen, Segment wählen und als Lead speichern.
                {kiModell ? ' Vorbelegung durch KI – bitte kontrollieren.' : ' Vorbelegung ohne KI (Anzeigename und Adresse).'}
              </p>
              {fehler && <div className="bg-s112-err-bg border border-s112-err/30 rounded-lg px-3 py-2 text-xs text-s112-err-fg">{fehler}</div>}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div><label className={labelCls}>Vorname</label><input aria-label="Vorname" value={vorname} onChange={e => setVorname(e.target.value)} className={inputCls} /></div>
                <div><label className={labelCls}>Nachname *</label><input aria-label="Nachname" value={nachname} onChange={e => setNachname(e.target.value)} className={inputCls} required /></div>
                <div><label className={labelCls}>E-Mail</label><input aria-label="E-Mail" type="email" value={email} onChange={e => setEmail(e.target.value)} className={inputCls} /></div>
                <div><label className={labelCls}>Position</label><input aria-label="Position" value={position} onChange={e => setPosition(e.target.value)} className={inputCls} placeholder="z. B. Einkauf, Sommelier" /></div>
                <div><label className={labelCls}>Telefon</label><input aria-label="Telefon" value={telefon} onChange={e => setTelefon(e.target.value)} className={inputCls} placeholder="+43 …" /></div>
                <div><label className={labelCls}>Mobil</label><input aria-label="Mobil" value={mobil} onChange={e => setMobil(e.target.value)} className={inputCls} placeholder="+43 …" /></div>
              </div>

              <div className="rounded-lg border border-s112-line bg-s112-bg p-3 space-y-2">
                <p className="text-xs font-semibold text-s112-text inline-flex items-center gap-1.5"><Building2 className="w-3.5 h-3.5 text-s112-tertiary" /> Firma</p>
                <div className="flex flex-wrap gap-3 text-xs">
                  {([['keine', 'Privatperson (keine Firma)'], ['neu', 'Firma neu anlegen (als Lead)'], ['bestehend', 'Bestehende Firma']] as const).map(([v, l]) => (
                    <label key={v} className="inline-flex items-center gap-1.5 cursor-pointer">
                      <input type="radio" name="firmaModus" checked={firmaModus === v} onChange={() => setFirmaModus(v)} className="accent-[var(--s112-teal)]" />{l}
                    </label>
                  ))}
                </div>
                {firmaModus === 'neu' && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div><label className={labelCls}>Firmenname *</label><input aria-label="Firmenname" value={firmaName} onChange={e => setFirmaName(e.target.value)} className={inputCls} /></div>
                    <div><label className={labelCls}>Website</label><input aria-label="Website" value={firmaWebsite} onChange={e => setFirmaWebsite(e.target.value)} className={inputCls} placeholder="weingut-beispiel.at" /></div>
                  </div>
                )}
                {firmaModus === 'bestehend' && (
                  <div className="space-y-2">
                    {kandidaten.length > 0 && <p className="text-[11px] text-s112-text-2">Ähnlich benannte Firmen gefunden – bitte prüfen.</p>}
                    <input value={firmaSuche} onChange={e => setFirmaSuche(e.target.value)} className={inputCls} placeholder="Firma suchen…" />
                    <select value={firmaId} onChange={e => setFirmaId(e.target.value)} className={inputCls} size={Math.min(6, Math.max(2, firmenGefiltert.length))}>
                      {firmenGefiltert.map(f => <option key={f.id} value={f.id}>{f.name}{f.ort ? ` · ${f.ort}` : ''}{f.is_lead ? ' (Lead)' : ''}</option>)}
                      {firmenGefiltert.length === 0 && <option value="" disabled>keine Firma gefunden</option>}
                    </select>
                  </div>
                )}
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className="col-span-2"><label className={labelCls}>Straße</label><input aria-label="Straße" value={strasse} onChange={e => setStrasse(e.target.value)} className={inputCls} /></div>
                <div><label className={labelCls}>PLZ</label><input aria-label="PLZ" value={plz} onChange={e => setPlz(e.target.value)} className={inputCls} /></div>
                <div><label className={labelCls}>Ort</label><input aria-label="Ort" value={ort} onChange={e => setOrt(e.target.value)} className={inputCls} /></div>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div><label className={labelCls}>Land</label>
                  <select aria-label="Land" value={land} onChange={e => setLand(e.target.value)} className={inputCls}>{LAENDER.map(l => <option key={l} value={l}>{l}</option>)}</select></div>
                <div><label className={labelCls}>Segment *</label>
                  <select aria-label="Segment" value={segment} onChange={e => setSegment(e.target.value)} className={inputCls}>{SEGMENTE.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}</select></div>
                <div><label className={labelCls}>Rabattgruppe</label>
                  <select aria-label="Rabattgruppe" value={rabattgruppeId} onChange={e => setRabattgruppeId(e.target.value)} className={inputCls}>
                    <option value="">– keine –</option>
                    {rabattgruppen.map(r => <option key={r.id} value={r.id}>{r.name} ({r.rabatt_pct} %)</option>)}
                  </select></div>
                <div><label className={labelCls}>Zahlungsziel (Tage)</label><input aria-label="Zahlungsziel (Tage)" type="number" min={0} value={zahlungsziel} onChange={e => setZahlungsziel(e.target.value)} className={inputCls} /></div>
              </div>

              <div><label className={labelCls}>Notizen</label><textarea aria-label="Notizen" value={notizen} onChange={e => setNotizen(e.target.value)} rows={3} className={inputCls} /></div>
            </div>
            <div className="px-5 py-3 border-t border-s112-line flex items-center justify-between gap-3">
              <p className="text-[11px] text-s112-tertiary">Die E-Mail wird als Aktivität am neuen Lead abgelegt.</p>
              <div className="flex gap-2">
                <button onClick={onClose} disabled={phase === 'speichern'} className="text-sm border border-s112-line-str text-s112-text-2 px-4 py-2 rounded-lg hover:bg-s112-bg">Abbrechen</button>
                <button onClick={speichern} disabled={phase === 'speichern'} className="text-sm bg-s112-teal text-white px-4 py-2 rounded-lg font-semibold hover:bg-opacity-90 disabled:opacity-50">
                  {phase === 'speichern' ? 'Speichern…' : 'Als Lead speichern'}
                </button>
              </div>
            </div>
          </>
        )}

        {phase === 'fertig' && ergebnis && (
          <div className="p-6 space-y-4">
            <div className="bg-s112-ok-bg border border-s112-ok/30 rounded-lg px-4 py-3 text-sm text-s112-ok-fg">
              Lead <b>{ergebnis.name}</b> wurde angelegt{ergebnis.firmaId ? ' und mit der Firma verknüpft' : ''}. Die E-Mail liegt in der Historie des Kontakts.
            </div>
            <div className="flex flex-wrap gap-2">
              <Link href={`/crm/kontakte/${ergebnis.kontaktId}`} className="text-sm bg-s112-teal text-white px-4 py-2 rounded-lg font-semibold hover:bg-opacity-90">Kontakt öffnen</Link>
              {ergebnis.firmaId && <Link href={`/crm/firmen/${ergebnis.firmaId}`} className="text-sm border border-s112-line-str text-s112-text-2 px-4 py-2 rounded-lg hover:bg-s112-bg">Firma öffnen</Link>}
              <button onClick={onClose} className="text-sm border border-s112-line-str text-s112-text-2 px-4 py-2 rounded-lg hover:bg-s112-bg">Schließen</button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
