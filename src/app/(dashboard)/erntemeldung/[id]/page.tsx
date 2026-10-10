// behoerdenmeldung: lesedaten, erntemeldung, bki-traubenverkauf
import type { Metadata } from 'next'
import Link from '@/components/ui/Link'
import ErnteDetailClient from './ErnteDetailClient'
import TraubenverkaufSection from './TraubenverkaufSection'
import { type HektarhoechstertragStatus } from '@/lib/behoerden/erntemeldung'
import { leseTitel } from '@/lib/wein/lesen'
import LeseReiter from './LeseReiter'
import { type AmaAbweichung } from '@/lib/behoerden/amaMeldung'
import { ladeLeseKontext } from './leseKontext'

export const metadata: Metadata = { title: 'Lese' }
export const dynamic = 'force-dynamic'

interface Props { params: Promise<{ id: string }>; searchParams: Promise<{ lese?: string | string[]; erfassen?: string }> }

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AR = Record<string, any>

export type GSTOpt = { id: string; gst_nr: string; rebsorte: string | null; flaeche_ha: number | null
  /** KAN-81: Herkunft-Code des Grundstücks (Obergrenze der Herkunft an der Lese) */
  herkunft_code?: string | null }
export type ErnteParzelle = {
  id: string; weingarten_id: string; weingarten_name: string; weingarten_rebsorte: string | null
  grundstueck_id: string | null; grundstueck_nr: string | null; grundstueck_rebsorte: string | null
  ernte_datum: string | null; menge_kg: number | null; menge_hl: number | null
  oechsle: number | null; klosterneuburger: number | null
  /** gemessene Einheit ('kmw' | 'oechsle', KAN-128) – vor Migration A null */
  mostgewicht_einheit: string | null
  qualitaetsstufe: string | null; lesemethode: string | null; notizen: string | null
  /** KAN-81: Herkunft des Eintrags und Art seiner Lese (Obergrenze der Stufe) */
  herkunft_code?: string | null; lese_art?: string | null
  /** KAN-129: Lese des Eintrags („2026/1 Hauptlese“) und ihre Nummer – Gruppierung der Lesedaten */
  lese_titel: string | null; lese_nr: number | null
  /** KAN-148 C1b: storniert – Vermerk statt Aktionen, zählt in keiner Summe */
  storno: { am: string; von: string | null; grund: string | null } | null
}
export type WeingartenOpt = {
  id: string; name: string; rebsorte: string | null; lage_name: string | null
  /** AMA-Feldstücknummer (Suche in der Lese-Erfassung, KAN-162) */
  ama_feldnummer: string | null
  /** Fläche des Weingartens – Bezugsfläche nur, wenn er keine Grundstücke hat (KAN-161) */
  flaeche_ha: number | null
  /** mind. ein Grundstück der Nutzart WI oder gar keine Grundstücke (lib/wein/leseErfassung.ts, KAN-160) */
  erntebar: boolean
}
/** Version einer AMA-Erntemeldung (KAN-148 C2: Korrekturmeldungen = weitere Versionen) */
export type AMAVersion = {
  id: string; version: number; status: string; gesamtmenge_kg: number | null
  eingereicht_am: string | null; bestaetigt_am: string | null; ama_referenznr: string | null
  /** KAN-37 C: Meldungsrahmen – Stichtag (30.11.) und Abgabefrist (15.12.) des Jahrgangs */
  stichtag: string; abgabefrist: string
  /** KAN-37 B: beim Einreichen gespeicherte Datei (meldung_abgaben); null = offen oder vor KAN-37 B eingereicht */
  abgabe: { id: string; csv_sha256: string } | null
}
/** Neueste Version der AMA-Erntemeldung des Jahrgangs mit ihren Positionen und allen Versionen (absteigend) */
export type AMAMeldung = AMAVersion & {
  gesamtmenge_hl: number | null
  n8n_status: string | null; n8n_fehler: string | null
  positionen: { rebsorte_name: string; flaeche_ha: number | null; menge_kg: number | null }[]
  versionen: AMAVersion[]
  /** Rebsorten, deren aktuelle Lesedaten (ohne stornierte, bis Stichtag) von der Meldung abweichen (KAN-148 Soll 5) */
  abweichungen: AmaAbweichung[]
}
// Hektarhöchstertrag: Berechnung gemeinsam mit Erntemeldung-Druck und -CSV (lib/behoerden/erntemeldung.ts)
export type { HektarhoechstertragStatus }

export default async function ErnteDetailPage({ params, searchParams }: Props) {
  const { id } = await params
  const { lese: leseParam, erfassen } = await searchParams
  // Pilot 30.09.2026: Laden gemeinsam mit den Pressungen im Kellerbuch (leseKontext.ts)
  const {
    jg, writeOk, adminOk, betrieb, csvErlaubt, bkiErlaubt, lesen, lesenMitSperre, aktiveLese, aktiveLeseMitSperre,
    alleParzellen, parzellen, nachStichtag, weingaerten, gstByWeingarten, amaMeldung, hektarhoechstertrag, pressungen,
    verkauefe, tvQuelleOptions, zukaufTrauben,
  } = await ladeLeseKontext(id, leseParam)
  const pressungenHref = `/kellerbuch/pressungen?jahrgang=${id}${aktiveLese && lesen.length > 1 ? `&lese=${aktiveLese.lfd_nr}` : ''}`

  return (
    <div className="max-w-3xl">
      <div className="flex items-center gap-2 text-sm text-s112-muted mb-6">
        <Link href="/erntemeldung" className="hover:text-s112-blue-700 transition-colors">Lese</Link>
        <span>/</span>
        <span className="text-s112-text-1 font-medium">Jahrgang {(jg as AR).jahrgang}</span>
      </div>

      <div className="flex items-center justify-between mb-6">
        <h1 className="text-3xl font-semibold text-s112-blue-700 tabular-nums">{(jg as AR).jahrgang}</h1>
        <div className="flex items-center gap-3">
          {/* KAN-147: betriebliche Lese-Auswertung (Ertrag, Mostgewicht, Fortschritt, Vorjahre) */}
          <Link href={`/erntemeldung/${id}/auswertung`} className="text-sm text-s112-blue-700 hover:underline font-medium">Auswertung</Link>
          {(jg as AR).abgeschlossen && (
            <span className="text-xs bg-[#F2F3F5] text-s112-text-2 px-2 py-1 rounded-full">Abgeschlossen</span>
          )}
        </div>
      </div>

      {aktiveLeseMitSperre && (
        <LeseReiter
          jahrgangId={id}
          jahrgang={Number((jg as AR).jahrgang)}
          lesen={lesenMitSperre}
          aktiv={aktiveLeseMitSperre}
          writeOk={writeOk}
          adminOk={adminOk}
        />
      )}

      <ErnteDetailClient
        jahrgang={jg as AR}
        leseId={aktiveLese?.id ?? null}
        leseArt={aktiveLese?.art ?? null}
        leseTitel={aktiveLese && lesen.length > 1 ? leseTitel((jg as AR).jahrgang, aktiveLese) : null}
        mehrereLesen={lesen.length > 1}
        tabellenParzellen={alleParzellen}
        stichtagHinweis={nachStichtag}
        parzellen={parzellen}
        weingaerten={weingaerten}
        gstByWeingarten={gstByWeingarten}
        amaMeldung={amaMeldung}
        hektarhoechstertrag={hektarhoechstertrag}
        pressungenAnzahl={pressungen.filter(p => !p.storno).length}
        pressungenHref={pressungenHref}
        writeOk={writeOk}
        adminOk={adminOk}
        betriebName={betrieb.name}
        csvErlaubt={csvErlaubt}
        erfassenOffen={erfassen === '1'}
      />

      {(tvQuelleOptions.length > 0 || verkauefe.length > 0 || zukaufTrauben.some(z => z.art !== 'maische')) && (
        <div className="mt-6">
          <TraubenverkaufSection
            jahrgangId={id}
            leseId={aktiveLese?.id ?? null}
            jahrgang={Number((jg as AR).jahrgang)}
            bkiErlaubt={bkiErlaubt}
            verkauefe={verkauefe}
            quelleOptions={tvQuelleOptions}
            zukaufOptions={zukaufTrauben.filter(z => z.art !== 'maische')}   // KAN-41: Maische wird nicht weiterverkauft
            writeOk={writeOk}
            adminOk={adminOk}
          />
        </div>
      )}
        </div>
  )
}
