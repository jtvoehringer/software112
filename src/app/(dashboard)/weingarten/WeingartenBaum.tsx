'use client'

import { useState, useTransition } from 'react'
import Link from '@/components/ui/Link'
import { useRouter } from 'next/navigation'
import { Pencil, Trash2, MapPin, RotateCcw } from 'lucide-react'
import { googleMapsUrl, fmtKoord } from '@/lib/geo/rieden'
import { deleteWeingarten, deleteRied, setzeWeingartenAktiv } from './actions'
import { fmtHa } from '@/lib/format'
import { NutzungBadge } from '@/lib/wein/grundstueckStatus'
import { bkiRebsorteKuerzel } from '@/lib/wein/bki_kuerzel'
import { tastaturBedienbar } from '@/lib/ui/tastatur'

// Auffangkorb-Label für Weingärten ohne eigene Ried-Zuordnung (w.ried === null) -
// KEIN echter Ried, nur eine technische Sammelgruppe. Wird verwendet, um beim
// Rendern zu entscheiden, ob GST-Zeilen direkt unter der Gruppe gezeigt werden
// dürfen (nur bei einer echten Lage sinnvoll) oder ob jeder Weingarten weiterhin
// seine eigene, benannte/bearbeitbare Zeile behalten muss (siehe LageGruppe).
const KEIN_RIED = 'Rieden'

// KAN-150 F1: Rieden mit Bezug (Maßnahmen, Lese, Chargen …) werden nicht gelöscht, sondern deaktiviert – die Action
// meldet das mit deaktivierbar: true, hier wird dann „Stattdessen deaktivieren?“ angeboten.
async function loeschenOderDeaktivieren(
  ergebnis: { error?: string; deaktivierbar?: boolean } | undefined, ids: string[], refresh: () => void,
) {
  if (!ergebnis?.error) { refresh(); return }
  if (ergebnis.deaktivierbar && confirm(`${ergebnis.error}\n\nStattdessen deaktivieren?`)) {
    const r = await setzeWeingartenAktiv(ids, false)
    if (r.error) alert(r.error)
    refresh()
    return
  }
  if (!ergebnis.deaktivierbar) alert(`Fehler beim Löschen: ${ergebnis.error}`)
}

// AMA-Feldstücknr. und Codes hängen am Weingarten-Datensatz (Ried-Formular),
// eine Lage/Ried kann aber aus mehreren Weingarten-Datensätzen bestehen -
// genügt hier wie in LageGruppe der erste vorhandene Wert (siehe dortiger
// Kommentar). Als eigene Funktion, weil sowohl LageGruppe (Anzeige) als auch
// WeingartenBaum (Sortierung nach AMA-Feldstücknr., Rückmeldung 24.8.2026)
// denselben repräsentativen Wert pro Lage brauchen.
function amaFeldnummerFuerLage(weingaerten: WRow[]): string | null {
  return weingaerten.find(w => w.ama_feldnummer)?.ama_feldnummer ?? null
}

// Rückmeldung 24.8.2026 (Teil 3): "Interne Bezeichnung" ist ein optionales
// zweites, betriebsinternes Namensfeld auf dem Ried-Formular - analog zu
// AMA-Feldstücknr./Codes weiter oben genügt der erste vorhandene Wert pro
// Lage, wird aber nur angezeigt, wenn tatsächlich einer gesetzt ist.
function interneBezeichnungFuerLage(weingaerten: WRow[]): string | null {
  return weingaerten.find(w => w.interne_bezeichnung)?.interne_bezeichnung ?? null
}

// Rückmeldung 24.8.2026 (Teil 2): AMA-Feldstücknr. (auf dem Ried/Weingarten-
// Datensatz) und AMA-Schlagnr. (auf dem einzelnen Grundstück) sind ZWEI
// verschiedene Nummernkreise, die vorher fälschlich dieselbe Spalte/denselben
// Sortierzustand teilten. Eigene, von der Ried-Gruppen-Sortierung (sortBy in
// WeingartenBaum) unabhängige Sortierung für die GST-Zeilen INNERHALB einer
// aufgeklappten Ried, per Klick auf die eigene "AMA-Schlagnr."-Spaltenüber-
// schrift. Nulls (keine Schlagnr. auf dem Grundstück) ans Ende, sonst
// numerisch, bei Gleichstand nach GST-Nr.
function sortGst(gsts: GSTRow[], gstSort: 'gst_nr' | 'schlag'): GSTRow[] {
  const sorted = [...gsts]
  if (gstSort === 'schlag') {
    sorted.sort((a, b) => {
      const x = a.ama_feldnummer
      const y = b.ama_feldnummer
      if (x == null && y == null) return a.gst_nr.localeCompare(b.gst_nr, 'de', { numeric: true })
      if (x == null) return 1
      if (y == null) return -1
      return x.localeCompare(y, 'de', { numeric: true }) || a.gst_nr.localeCompare(b.gst_nr, 'de', { numeric: true })
    })
  } else {
    sorted.sort((a, b) => a.gst_nr.localeCompare(b.gst_nr, 'de', { numeric: true }))
  }
  return sorted
}

const BEWIRTSCHAFTUNG_BADGE: Record<string, string> = {
  biodynamisch:  'bg-s112-ok-bg text-s112-ok-fg',
  biologisch:    'bg-s112-ok-bg text-s112-ok-fg',
  in_umstellung: 'bg-s112-warn-bg text-s112-warn-fg',
  nachhaltig:    'bg-[#F2F3F5] text-s112-text-1',
  kip:           'bg-s112-blue-100 text-s112-blue-700',
  konventionell: 'bg-[#F2F3F5] text-s112-text-2',
  // Legacy-Werte
  bio:           'bg-s112-ok-bg text-s112-ok-fg',
  demeter:       'bg-s112-ok-bg text-s112-ok-fg',
}
const BEWIRTSCHAFTUNG_LABEL: Record<string, string> = {
  biodynamisch:  'Biodynamisch',
  biologisch:    'Bio/Organisch',
  in_umstellung: 'In Umstellung',
  nachhaltig:    'Nachhaltig',
  kip:           'KIP',
  konventionell: 'Konventionell',
  bio:           'Bio',
  demeter:       'Biodynamisch',
}

export type WRow = {
  id: string; name: string; ried: string | null; rebsorte: string | null
  weinart: string | null; flaeche_ha: number | null; bewirtschaftung: string | null; aktiv: boolean
  ama_feldnummer: string | null; codes: string | null; interne_bezeichnung: string | null
  // Stufe 1 Rieden-Koordinaten (Migration 181), optional
  zentrum_lat?: number | null; zentrum_lon?: number | null
}
export type GSTRow = {
  id: string; weingarten_id: string; gst_nr: string
  rebsorte: string | null; flaeche_ha: number | null; flaeche_ha_kataster: number | null
  spritzbar: boolean; katastralgemeinde: string | null
  // status ist seit Migration 171 abgelöst (Nutzart) und wird nicht mehr geladen –
  // die Seite liefert die Zeilen aus lib/behoerden/flaechenverzeichnis (GstStamm)
  status?: string | null
  nutzart: string | null
  ama_feldnummer: string | null
  /** KAN-150: deaktiviert (nicht mehr bewirtschaftet) ab deaktiviert_am */
  aktiv?: boolean
  deaktiviert_am?: string | null
}

function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg className={`w-4 h-4 transition-transform ${open ? 'rotate-90' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
    </svg>
  )
}

// ── Grundstück-Zeile ──────────────────────────────────────────────────────────

function GSTZeile({ gst, verschachtelt = false }: { gst: GSTRow; verschachtelt?: boolean }) {
  const router = useRouter()
  return (
    <tr
      className={`border-b border-s112-border/50 last:border-0 bg-white hover:bg-s112-bg/30 cursor-pointer transition-colors ${gst.aktiv === false ? "opacity-50" : ""}`}
      onClick={() => router.push(`/weingarten/${gst.weingarten_id}`)}
      {...tastaturBedienbar(() => router.push(`/weingarten/${gst.weingarten_id}`), null)}
      title={gst.aktiv === false ? `Deaktiviert seit ${gst.deaktiviert_am ?? "–"} – zum Weingarten` : "Zum Weingarten (Grundstück bearbeiten)"}
    >
      {/* Zwei Kontexte: direkt unter dem Ried (verschachtelt=false, "flatGst" in
          LageGruppe - ersetzt dort die Weingarten-Zeile komplett) vs. als
          aufklappbares Kind EINER konkreten Weingarten-Zeile (verschachtelt=true,
          siehe WeingartenZeile) - dort eine Ebene tiefer einrücken. Beide Fälle
          sind reiner Text ohne Chevron-Icon, ihr Eltern-Zeile (LageGruppe bzw.
          WeingartenZeile) hat aber ein Chevron+Abstand vor dem Label - pl-8 lag
          dadurch optisch auf oder sogar vor dem Ried-Titel statt sichtbar
          eingerückt. pl-12 (flach) / pl-16 (verschachtelt) gleichen das aus. */}
      <td className={`${verschachtelt ? 'pl-16' : 'pl-12'} pr-3 py-2 text-xs text-s112-text-2`}>
        <span className="font-mono">GST {gst.gst_nr}</span>
        {gst.katastralgemeinde && (
          <span className="ml-2 text-s112-tertiary">{gst.katastralgemeinde}</span>
        )}
      </td>
      <td className="px-3 py-2 text-xs text-s112-muted" />
      <td className="px-3 py-2 text-xs text-s112-muted">{gst.ama_feldnummer ?? '–'}</td>
      <td className="px-3 py-2 text-xs text-s112-muted" />
      <td className="px-3 py-2 text-xs text-s112-muted">{gst.rebsorte ?? '–'}</td>
      <td className="px-3 py-2 text-xs text-s112-muted font-mono">{bkiRebsorteKuerzel(gst.rebsorte) ?? '–'}</td>
      <td className="px-3 py-2 text-xs"><NutzungBadge nutzart={gst.nutzart} /></td>
      <td className="px-3 py-2 text-xs text-right tabular-nums text-s112-muted">{gst.flaeche_ha_kataster ? fmtHa(gst.flaeche_ha_kataster) : '–'}</td>
      <td className="px-3 py-2 text-xs text-right tabular-nums text-s112-muted">
        {fmtHa(gst.flaeche_ha)}
      </td>
      <td />
    </tr>
  )
}

// ── Weingarten-Zeile ──────────────────────────────────────────────────────────

function WeingartenZeile({
  w, gsts, writeOk, adminOk, gstSort,
}: {
  w: WRow; gsts: GSTRow[]; writeOk: boolean; adminOk: boolean; gstSort: 'gst_nr' | 'schlag'
}) {
  const [open, setOpen] = useState(false)
  const [pending, startTransition] = useTransition()
  const router = useRouter()

  function handleDelete() {
    if (!confirm(`"${w.name}" wirklich löschen?`)) return
    startTransition(async () => {
      await loeschenOderDeaktivieren(await deleteWeingarten(w.id), [w.id], () => router.refresh())
    })
  }
  function handleReaktivieren() {
    startTransition(async () => {
      const r = await setzeWeingartenAktiv([w.id], true)
      if (r.error) alert(r.error)
      router.refresh()
    })
  }

  const gstHa        = gsts.reduce((s, g) => s + (g.flaeche_ha ?? 0), 0)
  const gstKatasterHa = gsts.reduce((s, g) => s + (g.flaeche_ha_kataster ?? 0), 0)

  return (
    <>
      <tr
        className={`border-b border-s112-border last:border-0 cursor-pointer select-none
          ${!w.aktiv ? 'opacity-50' : 'hover:bg-s112-bg/40'} transition-colors
          ${pending ? 'opacity-40 pointer-events-none' : ''}`}
        onClick={() => gsts.length > 0 && setOpen(o => !o)}
        {...tastaturBedienbar(() => { if (gsts.length > 0) setOpen(o => !o) }, null)}
        aria-expanded={gsts.length > 0 ? open : undefined}
      >
        <td className="pl-8 pr-3 py-2.5">
          <div className="flex items-center gap-2">
            <span className={`text-s112-tertiary ${gsts.length === 0 ? 'invisible' : ''}`}>
              <ChevronIcon open={open} />
            </span>
            <div>
              <div className="flex items-center gap-2">
                <Link
                  href={`/weingarten/${w.id}`}
                  onClick={e => e.stopPropagation()}
                  className="font-medium text-s112-text text-sm hover:text-s112-blue-700 hover:underline"
                >
                  {w.name}
                </Link>
                {w.zentrum_lat != null && w.zentrum_lon != null && (
                  <a href={googleMapsUrl(Number(w.zentrum_lat), Number(w.zentrum_lon))} target="_blank" rel="noopener"
                    onClick={e => e.stopPropagation()} title="In Google Maps öffnen" aria-label="In Google Maps öffnen"
                    className="text-s112-blue-700 hover:opacity-75"><MapPin size={13} strokeWidth={1.75} /></a>
                )}
                {w.bewirtschaftung && (
                  <span className={`inline-block px-1.5 py-0 rounded-full text-xs font-medium ${BEWIRTSCHAFTUNG_BADGE[w.bewirtschaftung] ?? 'bg-[#F2F3F5] text-s112-text-2'}`}>
                    {BEWIRTSCHAFTUNG_LABEL[w.bewirtschaftung] ?? w.bewirtschaftung}
                  </span>
                )}
              </div>
              {w.interne_bezeichnung && (
                <div className="text-xs text-s112-muted">{w.interne_bezeichnung}</div>
              )}
            </div>
          </div>
        </td>
        <td className="px-3 py-2.5 text-xs text-s112-muted">{w.ama_feldnummer ?? '–'}</td>
        <td className="px-3 py-2.5 text-xs text-s112-muted" />
        <td className="px-3 py-2.5 text-xs text-s112-muted" title="EOP = Einsatz von Organismen und Pheromonen, PSMBIO = Einsatz von Pflanzenschutzmitteln laut Bio-Verordnung">{w.codes ?? '–'}</td>
        <td className="px-3 py-2.5 text-sm">
          <div className="flex items-center gap-1.5 flex-wrap">
            {w.weinart && w.weinart !== 'unbekannt' && (
              <span className={`inline-block px-1.5 py-0 rounded-full text-xs font-medium ${
                w.weinart === 'rot'   ? 'bg-s112-err-bg text-s112-err-fg' :
                w.weinart === 'weiss' ? 'bg-s112-warn-bg text-s112-warn-fg' :
                w.weinart === 'rose'  ? 'bg-[#F2F3F5] text-s112-text-1' :
                'bg-[#F2F3F5] text-s112-text-2'
              }`}>
                {w.weinart === 'rot' ? 'Rot' : w.weinart === 'weiss' ? 'Weiß' : 'Rosé'}
              </span>
            )}
          </div>
        </td>
        <td className="px-3 py-2.5" />
        <td className="px-3 py-2.5" />
        <td className="px-3 py-2.5 text-sm text-right tabular-nums text-s112-tertiary">{gstKatasterHa > 0 ? fmtHa(gstKatasterHa) : '–'}</td>
        <td className="px-3 py-2.5 text-sm text-right tabular-nums">
          {w.flaeche_ha != null ? fmtHa(w.flaeche_ha) : (gstHa > 0 ? fmtHa(gstHa) : '–')}
        </td>
        <td className="px-3 py-2.5" onClick={e => e.stopPropagation()}>
          <div className="flex items-center justify-between gap-3">
            <span className="text-xs text-s112-tertiary">{gsts.length > 0 ? gsts.length + ' GST' : ''}</span>
            <div className="flex items-center gap-3">
            {writeOk && (
              <Link href={`/weingarten/${w.id}`}
                title="Bearbeiten" aria-label="Bearbeiten"
                className="text-s112-blue-700 hover:text-s112-blue-700/70">
                <Pencil size={14} />
              </Link>
            )}
            {adminOk && !w.aktiv && (
              <button onClick={handleReaktivieren}
                title="Reaktivieren" aria-label="Reaktivieren"
                className="text-s112-blue-700 hover:text-s112-blue-700/70">
                <RotateCcw size={14} />
              </button>
            )}
            {adminOk && (
              <button onClick={handleDelete}
                title="Löschen" aria-label="Löschen"
                className="text-s112-err hover:text-s112-err-fg">
                <Trash2 size={14} />
              </button>
            )}
            </div>
          </div>
        </td>
      </tr>

      {open && sortGst(gsts, gstSort).map(g => <GSTZeile key={g.id} gst={g} verschachtelt />)}
    </>
  )
}

// ── Lage-Gruppe ───────────────────────────────────────────────────────────────

function LageGruppe({
  ried, weingaerten, gstMap, writeOk, adminOk, istEchteLage, gstSort,
}: {
  ried: string; weingaerten: WRow[]; gstMap: Map<string, GSTRow[]>
  writeOk: boolean; adminOk: boolean; istEchteLage: boolean; gstSort: 'gst_nr' | 'schlag'
}) {
  // Rückmeldung 24.8.2026: Rieden-Übersicht soll beim Einstieg eingeklappt
  // starten statt aufgeklappt.
  const [open, setOpen] = useState(false)
  const [pending, startTransition] = useTransition()
  const router = useRouter()

  const totalHa = weingaerten.reduce((s, w) => {
    const gsts = gstMap.get(w.id) ?? []
    const ha = gsts.length > 0
      ? gsts.reduce((a, g) => a + (g.flaeche_ha ?? 0), 0)
      : (w.flaeche_ha ?? 0)
    return s + ha
  }, 0)
  const totalKatasterHa = weingaerten.reduce((s, w) => {
    const gsts = gstMap.get(w.id) ?? []
    return s + gsts.reduce((a, g) => a + (g.flaeche_ha_kataster ?? 0), 0)
  }, 0)

  // AMA-Feldstücknr. und Codes sind Felder auf dem Weingarten-Datensatz
  // (Ried-Formular), nicht pro Grundstück. Eine Lage/Ried kann aus mehreren
  // Weingarten-Datensätzen zusammengesetzt sein (siehe Kommentar unten zu
  // weingaertenMitGst/weingaertenOhneGst) - in der Praxis sollten diese beiden
  // Felder für dieselbe physische Ried aber übereinstimmen, deshalb genügt der
  // erste vorhandene Wert. Ohne das wären beide Werte in der Übersicht nirgends
  // sichtbar, sobald die GST-Zeilen flach unter dem Ried gelistet werden (siehe
  // flatGst) - dort wird ja keine eigene Weingarten-Zeile mehr gezeigt.
  const amaFeldnummer = amaFeldnummerFuerLage(weingaerten)
  // Koordinaten (Stufe 1, Migration 181): liegen auf Riedenebene – alle Zeilen
  // derselben Ried tragen denselben Pin, deshalb genügt die erste mit Wert.
  const geo = weingaerten.find(w => w.zentrum_lat != null && w.zentrum_lon != null)
  // Stammdaten der Ried = erster Weingarten-Datensatz (Ried-Formular hängt am
  // weingarten-Datensatz; Feldstücknr./Codes/Koordinaten gelten je Ried).
  const stammdatenId = weingaerten[0]?.id ?? null
  const codes = weingaerten.find(w => w.codes)?.codes ?? null
  const interneBezeichnung = interneBezeichnungFuerLage(weingaerten)

  // Weingärten mit eigenen Grundstücken sind hier oft nur ein technischer
  // Container pro Rebsorte (z.B. "<Ried> - Gelber Muskateller 2013" und
  // "<Ried> - Zierfandler 2013" für dieselbe Lage) - ihre eigene Zeile
  // wiederholt den Ried-Namen aus der Gruppenüberschrift nochmal und bringt
  // sonst keine Information, die nicht auch direkt auf der GST-Zeile steht
  // (Rebsorte, Fläche). Deshalb werden ihre Grundstücke direkt unter dem Ried
  // gelistet, ohne die Zwischenzeile - nach GST-Nr. sortiert, damit z.B. zwei
  // Rebsorten auf demselben Grundstück nebeneinander stehen. Bearbeiten des
  // jeweiligen Weingartens bleibt per Klick auf eine seiner GST-Zeilen
  // erreichbar (siehe GSTZeile onClick → /weingarten/[id]).
  // Weingärten OHNE eigene Grundstücke (z.B. Flächen ohne GST-Aufteilung)
  // haben keine andere Darstellung und behalten deshalb ihre eigene Zeile.
  //
  // WICHTIG: das Flatten passiert NUR innerhalb einer echten Lage (istEchteLage).
  // Der Auffangkorb für Weingärten OHNE Ried-Zuordnung (siehe KEIN_RIED weiter
  // unten) ist kein Ried, sondern nur eine technische Sammelgruppe - dort jeden
  // Weingarten weiterhin als eigene, benannte/bearbeitbare Zeile zeigen wie
  // bisher, sonst verschwinden bei Mandanten, die Rieden gar nicht nutzen
  // (z.B. Sandbox: jedes GST ist dort direkt als eigener Weingarten "GST xxx"
  // angelegt, ohne Ried), die Weingarten-Namen und die Bearbeiten/Löschen-Icons
  // komplett - genau das ist am 15.8. in der Sandbox passiert.
  const weingaertenMitGst = istEchteLage ? weingaerten.filter(w => (gstMap.get(w.id) ?? []).length > 0) : []
  const weingaertenOhneGst = istEchteLage ? weingaerten.filter(w => (gstMap.get(w.id) ?? []).length === 0) : weingaerten
  const flatGst = sortGst(weingaertenMitGst.flatMap(w => gstMap.get(w.id) ?? []), gstSort)

  // Rückmeldung 24.8.2026: Löschen einer ganzen Ried (inkl. aller
  // darunterliegenden GST) war bisher gar nicht möglich - nur einzelne
  // weingarten-Datensätze waren über WeingartenZeile löschbar, für "echte"
  // Rieden mit flach angezeigten GST-Zeilen (siehe flatGst oben) gab es hier
  // in der Gruppenkopfzeile keine Löschen-Aktion. deleteRied() löscht ALLE
  // weingarten-Zeilen dieser Gruppe in einem atomaren Schritt - grundstuecke
  // werden dank "on delete cascade" automatisch mitgelöscht.
  function handleDeleteRied() {
    const anzahlGst = flatGst.length
    const bestaetigt = confirm(
      `Sie sind im Begriff die Ried "${ried}" mit allen ${anzahlGst} Grundstücken unwiderruflich zu löschen.\n\nDiese Aktion kann nicht rückgängig gemacht werden. Fortfahren?`
    )
    if (!bestaetigt) return
    const ids = weingaerten.map(w => w.id)
    startTransition(async () => {
      await loeschenOderDeaktivieren(await deleteRied(ids), ids, () => router.refresh())
    })
  }
  const alleInaktiv = weingaerten.length > 0 && weingaerten.every(w => !w.aktiv)
  function handleReaktivierenRied() {
    startTransition(async () => {
      const r = await setzeWeingartenAktiv(weingaerten.map(w => w.id), true)
      if (r.error) alert(r.error)
      router.refresh()
    })
  }

  return (
    <>
      <tr
        className={`bg-s112-bg border-b border-s112-border cursor-pointer select-none hover:bg-s112-bg/80 transition-colors ${pending ? 'opacity-40 pointer-events-none' : ''}`}
        onClick={() => setOpen(o => !o)}
        {...tastaturBedienbar(() => setOpen(o => !o), null)} aria-expanded={open}
      >
        <td className="px-4 py-2.5">
          <div className="flex items-center gap-2">
            <span className="text-s112-blue-700"><ChevronIcon open={open} /></span>
            <div>
              <div className="font-semibold text-s112-text text-sm flex items-center gap-1.5">
                {/* Rückmeldung 27.8.2026: Klick auf den Riednamen öffnet die Stammdaten
                    (erster Weingarten-Datensatz der Ried), der Chevron/Rest der Zeile
                    klappt weiterhin auf/zu. */}
                {istEchteLage && stammdatenId ? (
                  <Link href={`/weingarten/${stammdatenId}`} onClick={e => e.stopPropagation()}
                    title="Stammdaten der Ried öffnen" className="hover:text-s112-blue-700 hover:underline">{ried}</Link>
                ) : ried}
                {/* Geo-Pin immer sichtbar: mit Koordinaten → Google Maps, ohne → Detailseite zum Setzen */}
                {istEchteLage && (geo
                  ? <a href={googleMapsUrl(Number(geo.zentrum_lat), Number(geo.zentrum_lon))} target="_blank" rel="noopener"
                      onClick={e => e.stopPropagation()} title={`In Google Maps öffnen (${fmtKoord(Number(geo.zentrum_lat), Number(geo.zentrum_lon))})`} aria-label="In Google Maps öffnen"
                      className="text-s112-blue-700 hover:opacity-75"><MapPin size={13} strokeWidth={1.75} /></a>
                  : stammdatenId && (
                    <Link href={`/weingarten/${stammdatenId}`} onClick={e => e.stopPropagation()}
                      title="Noch keine Koordinaten – in den Stammdaten setzen" aria-label="Koordinaten setzen"
                      className="text-s112-tertiary hover:text-s112-blue-700"><MapPin size={13} strokeWidth={1.5} /></Link>
                  ))}
              </div>
              {interneBezeichnung && (
                <div className="text-xs text-s112-muted">{interneBezeichnung}</div>
              )}
            </div>
          </div>
        </td>
        <td className="px-4 py-2.5 text-sm text-s112-muted">{amaFeldnummer ?? '–'}</td>
        <td className="px-4 py-2.5" />
        <td className="px-4 py-2.5 text-sm text-s112-muted" title="EOP = Einsatz von Organismen und Pheromonen, PSMBIO = Einsatz von Pflanzenschutzmitteln laut Bio-Verordnung">{codes ?? '–'}</td>
        <td className="px-4 py-2.5" />
        <td className="px-4 py-2.5" />
        <td className="px-4 py-2.5" />
        <td className="px-4 py-2.5 text-sm text-right tabular-nums text-s112-tertiary">{totalKatasterHa > 0 ? fmtHa(totalKatasterHa) : '–'}</td>
        <td className="px-4 py-2.5 text-sm text-right tabular-nums text-s112-text-2">{fmtHa(totalHa)}</td>
        <td className="px-4 py-2.5" onClick={e => e.stopPropagation()}>
          {istEchteLage && adminOk && alleInaktiv && (
            <button onClick={handleReaktivierenRied} title="Ried reaktivieren" aria-label="Ried reaktivieren"
              className="text-s112-blue-700 hover:text-s112-blue-700/70 mr-3">
              <RotateCcw size={14} />
            </button>
          )}
          {istEchteLage && adminOk && (
            <button
              onClick={handleDeleteRied}
              title="Ried inkl. aller Grundstücke löschen"
              aria-label="Ried inkl. aller Grundstücke löschen"
              className="text-s112-err hover:text-s112-err-fg"
            >
              <Trash2 size={14} />
            </button>
          )}
        </td>
      </tr>

      {open && flatGst.map(g => <GSTZeile key={g.id} gst={g} />)}

      {open && weingaertenOhneGst.map(w => (
        <WeingartenZeile
          key={w.id}
          w={w}
          gsts={gstMap.get(w.id) ?? []}
          writeOk={writeOk}
          adminOk={adminOk}
          gstSort={gstSort}
        />
      ))}
    </>
  )
}

// ── Haupt-Komponente ──────────────────────────────────────────────────────────

export default function WeingartenBaum({
  weingaerten, grundstuecke, writeOk, adminOk,
}: {
  weingaerten: WRow[]; grundstuecke: GSTRow[]
  writeOk: boolean; adminOk: boolean
}) {
  // Rückmeldung 24.8.2026: Übersicht soll wahlweise nach AMA-Feldstücknr.
  // sortierbar sein (Klick auf die Spaltenüberschrift), Standard bleibt wie
  // bisher alphabetisch nach Ried/Grundstück.
  const [sortBy, setSortBy] = useState<'ried' | 'ama'>('ried')
  // Rückmeldung 24.8.2026 (Teil 2): eigener, von sortBy unabhängiger
  // Sortierzustand für die AMA-Schlagnr.-Spalte (pro Grundstück) - siehe
  // sortGst weiter oben.
  const [gstSort, setGstSort] = useState<'gst_nr' | 'schlag'>('gst_nr')

  const gstMap = new Map<string, GSTRow[]>()
  for (const g of grundstuecke) {
    const arr = gstMap.get(g.weingarten_id) ?? []
    arr.push(g)
    gstMap.set(g.weingarten_id, arr)
  }

  const lagenMap = new Map<string, WRow[]>()
  for (const w of weingaerten) {
    const ried = w.ried ?? KEIN_RIED
    const arr = lagenMap.get(ried) ?? []
    arr.push(w)
    lagenMap.set(ried, arr)
  }
  const lagen = Array.from(lagenMap.entries()).sort(([riedA, wgsA], [riedB, wgsB]) => {
    if (sortBy === 'ama') {
      const a = amaFeldnummerFuerLage(wgsA)
      const b = amaFeldnummerFuerLage(wgsB)
      // Lagen ohne AMA-Feldstücknr. ans Ende, sonst numerisch (1, 2, ..., 12
      // statt alphabetisch 1, 12, 2), bei Gleichstand alphabetisch nach Ried.
      if (a == null && b == null) return riedA.localeCompare(riedB, 'de')
      if (a == null) return 1
      if (b == null) return -1
      return a.localeCompare(b, 'de', { numeric: true }) || riedA.localeCompare(riedB, 'de')
    }
    return riedA.localeCompare(riedB, 'de')
  })

  return (
    // WICHTIG: kein "overflow-hidden" mehr auf diesem Wrapper - das hätte die
    // sticky-Kopfzeile unten wirkungslos gemacht. position: sticky verankert
    // sich immer am NÄCHSTEN Vorfahren mit overflow != visible; solange dieser
    // Wrapper overflow-hidden trägt (und selbst nie scrollt, weil er sich mit
    // seinem Inhalt mitausdehnt), "klebt" die Zeile an diesem Wrapper fest
    // statt am tatsächlich scrollenden <main> - optisch identisch mit "klebt
    // gar nicht". Die abgerundeten oberen Ecken werden stattdessen direkt auf
    // den äußeren th-Zellen gesetzt (siehe rounded-tl-2xl/rounded-tr-2xl unten).
    <div className="card p-0">
      <table className="w-full text-sm">
        <thead>
          {/* Fixiert die Kopfzeile beim Runterscrollen (Rückmeldung 19.8.2026) -
              sticky relativ zum scrollenden <main> aus AppShell.tsx,
              deshalb genügt top-0 ohne zusätzlichen Offset (die äußere
              Kopfleiste mit Suche/Glocke liegt außerhalb des Scroll-Containers). */}
          <tr className="sticky top-0 z-10 bg-s112-bg border-b-2 border-s112-border shadow-xs">
            <th
              className="text-left px-4 py-3 font-semibold text-s112-text-1 rounded-tl-2xl cursor-pointer select-none hover:text-s112-blue-700"
              onClick={() => setSortBy('ried')} {...tastaturBedienbar(() => setSortBy('ried'), null)}
              aria-sort={sortBy === 'ried' ? 'ascending' : undefined}
              title="Nach Ried/Grundstück sortieren"
            >
              Ried / Grundstück{sortBy === 'ried' && ' ▲'}
            </th>
            <th
              className="text-left px-3 py-3 font-semibold text-s112-text-1 cursor-pointer select-none hover:text-s112-blue-700"
              onClick={() => setSortBy('ama')} {...tastaturBedienbar(() => setSortBy('ama'), null)}
              aria-sort={sortBy === 'ama' ? 'ascending' : undefined}
              title="Nach AMA-Feldstücknr. sortieren"
            >
              AMA-Feldstücknr.{sortBy === 'ama' && ' ▲'}
            </th>
            <th
              className="text-left px-3 py-3 font-semibold text-s112-text-1 cursor-pointer select-none hover:text-s112-blue-700"
              onClick={() => setGstSort('schlag')} {...tastaturBedienbar(() => setGstSort('schlag'), null)}
              aria-sort={gstSort === 'schlag' ? 'ascending' : undefined}
              title="Nach AMA-Schlagnr. sortieren"
            >
              AMA-Schlagnr.{gstSort === 'schlag' && ' ▲'}
            </th>
            <th className="text-left px-3 py-3 font-semibold text-s112-text-1">Codes</th>
            <th className="text-left px-3 py-3 font-semibold text-s112-text-1">Rebsorte</th>
            <th className="text-left px-3 py-3 font-semibold text-s112-text-1">BKI-Kürzel</th>
            <th className="text-left px-3 py-3 font-semibold text-s112-text-1">Nutzung</th>
            <th className="text-right px-3 py-3 font-semibold text-s112-text-1 leading-tight">GST-Fläche<br />lt. Kataster</th>
            <th className="text-right px-3 py-3 font-semibold text-s112-text-1 leading-tight">GST-Fläche<br />lt. AMA</th>
            <th className="text-left px-3 py-3 font-semibold text-s112-text-1 rounded-tr-2xl" />
          </tr>
        </thead>
        <tbody>
          {lagen.map(([ried, wgs]) => (
            <LageGruppe
              key={ried}
              ried={ried}
              weingaerten={wgs}
              gstMap={gstMap}
              writeOk={writeOk}
              adminOk={adminOk}
              istEchteLage={ried !== KEIN_RIED}
              gstSort={gstSort}
            />
          ))}
        </tbody>
      </table>
    </div>
  )
}

