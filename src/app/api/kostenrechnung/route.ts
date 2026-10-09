import { ladeBehaelter } from '@/lib/keller/behaelter'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { alle, inBloecken } from '@/lib/supabase/alle'
import { canWrite, getCurrentMembership, type Membership } from '@/lib/auth/roles'
import { NextRequest, NextResponse } from 'next/server'
import { pruefeZweiFaktor } from '@/lib/api/zweiFaktor'
import { schreibSperreKonflikt } from '@/lib/auth/sperren'
import { seitenBetriebKonflikt } from '@/lib/auth/seitenBetrieb'
import { kostenAufteilung } from '@/lib/wein/massnahmeAnteile'
import { modulKonflikt } from '@/lib/auth/modul'
export const dynamic = 'force-dynamic'
type R = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any

async function getTId(): Promise<string | null> {
  const membership = await getCurrentMembership()
  return membership?.tenantId ?? null
}

// KAN-245: Schreibrecht wie die RLS (modul_* auf kosteneintraege, kostenstellen, kostenarten und den Aufteilungen):
// Auswertungen, Rieden oder Kellerbuch. Vorher prüfte die Route nur Paket-Modul, Betrieb und Nur-Lesen-Modus.
const KOSTEN_MODULE = ['auswertungen', 'rieden', 'kellerbuch'] as const
const darfKostenSchreiben = (m: Membership) => KOSTEN_MODULE.some(x => canWrite(m, x))

type Aufteilung = { tabelle: 'kosteneintrag_weingaerten' | 'kosteneintrag_behaelter'; spalte: 'weingarten_id' | 'behaelter_id' }
const AUFTEILUNG_WG: Aufteilung = { tabelle: 'kosteneintrag_weingaerten', spalte: 'weingarten_id' }
// KAN-245: die Aufteilung auf Behälter (Kellerkosten) schickte das Formular schon immer mit, die Route verwarf sie still
const AUFTEILUNG_BH: Aufteilung = { tabelle: 'kosteneintrag_behaelter', spalte: 'behaelter_id' }

/** Ersetzt die Aufteilung eines Kosteneintrags; liefert eine Fehlermeldung oder null */
async function speichereAufteilung(s: any, art: Aufteilung, eintragsId: string, split: R[] | undefined, betrag: number): Promise<string | null> { // eslint-disable-line @typescript-eslint/no-explicit-any
  // loeschen-ohne-pruefung: Aufteilung wird gleich neu geschrieben, 0 alte Zeilen sind in Ordnung
  // storno-ausnahme: kosteneintrag_weingaerten/_behaelter – Aufteilung eines Kosteneintrags, keine Buchung
  { const { error: e } = await (s.from(art.tabelle) as any).delete().eq('kosteneintrag_id', eintragsId)
    if (e) return `Aufteilung (${art.tabelle}): ${e.message}` }
  const zeilen = (split ?? []).filter((w: R) => w?.[art.spalte])
  if (zeilen.length === 0) return null
  // KAN-132: Restausgleich (Σ betrag_anteil = Betrag, Σ anteil_pct = 100,00); ohne Prozentangaben gleichmäßig
  const gleichmaessig = zeilen.every((w: R) => !w.anteil_pct)
  const records = kostenAufteilung(Number(betrag) || 0, zeilen.map((w: R) => ({ weingartenId: String(w[art.spalte]), gewicht: gleichmaessig ? 1 : Number(w.anteil_pct) || 0 })))
    .map(a => ({ kosteneintrag_id: eintragsId, [art.spalte]: a.weingartenId, anteil_pct: a.anteil_pct, betrag_anteil: a.betrag_anteil }))
  const { error: e } = await (s.from(art.tabelle) as any).insert(records)
  return e ? `Aufteilung (${art.tabelle}): ${e.message}` : null
}

/** Beide Aufteilungen je nach Objekttyp: die nicht passende wird geleert */
async function speichereAufteilungen(s: any, eintragsId: string, b: R): Promise<string | null> { // eslint-disable-line @typescript-eslint/no-explicit-any
  const wg = b.objekt_typ === 'weingarten' ? b.wg_split : []
  const bh = b.objekt_typ === 'keller' ? b.bh_split : []
  return (await speichereAufteilung(s, AUFTEILUNG_WG, eintragsId, wg, b.betrag))
    ?? (await speichereAufteilung(s, AUFTEILUNG_BH, eintragsId, bh, b.betrag))
}

const fehlerAntwort = (fehler: string, status = 500) => NextResponse.json({ fehler }, { status })
const NICHT_GEFUNDEN = 'Nicht gefunden oder keine Berechtigung – bitte die Seite neu laden.'

export async function GET(req: NextRequest) {
  const zweiFaktor = await pruefeZweiFaktor()
  if (zweiFaktor) return zweiFaktor
  const ohneModul = await modulKonflikt('modul_controlling')   // KAN-6: Paket-Modul auch in der Route
  if (ohneModul) return ohneModul
  const s = await createSupabaseServerClient()
  const t = await getTId()
  if (!t) return NextResponse.json({ fehler: 'Kein Betrieb' }, { status: 401 })
  const a = req.nextUrl.searchParams.get('action')

  if (a === 'eintraege') {
    const { data, error: dataErr } = await (s.from('kosteneintraege') as any)
      .select('id, datum, betrag, beschreibung, objekt_typ, periode, transaktions_nr, kostenstelle:kostenstelle_id(name), kostenart:kostenart_id(name), wg:weingarten_id(name), behaelter:behaelter_id(name)')
      .eq('tenant_id', t).order('datum', { ascending: false }).limit(300)
    if (dataErr) return NextResponse.json({ fehler: `Daten konnten nicht geladen werden: ${dataErr.message}` }, { status: 500 })
    // WG-Splits nachladen
    const ids = (data ?? []).map((e: R) => e.id)
    let splits: R[] = []
    if (ids.length > 0) {
      // alle(): 300 Einträge mit je mehreren Rieden können über 1.000 Aufteilungszeilen haben;
      // inBloecken: 300 IDs liegen knapp unter der URL-Grenze (≈ 350 UUIDs)
      const { data: sd, error: sdErr } = await inBloecken<R>(ids, b => alle<R>((s.from('kosteneintrag_weingaerten') as any)
        .select('kosteneintrag_id, weingarten_id, anteil_pct, betrag_anteil, wg:weingarten_id(name)')
        .in('kosteneintrag_id', b)
        .order('id')))
      if (sdErr) return NextResponse.json({ fehler: `Daten konnten nicht geladen werden: ${sdErr.message}` }, { status: 500 })
      splits = sd ?? []
    }
    // KAN-245: Behälter-Aufteilung (Kellerkosten) ebenfalls laden – das Formular zeigt und bearbeitet sie
    let bhSplits: R[] = []
    if (ids.length > 0) {
      const { data: bd, error: bdErr } = await inBloecken<R>(ids, b => alle<R>((s.from('kosteneintrag_behaelter') as any)
        .select('kosteneintrag_id, behaelter_id, anteil_pct, betrag_anteil, bh:behaelter_id(name)')
        .in('kosteneintrag_id', b)
        .order('id')))
      if (bdErr) return NextResponse.json({ fehler: `Daten konnten nicht geladen werden: ${bdErr.message}` }, { status: 500 })
      bhSplits = bd ?? []
    }
    const eintraege = (data ?? []).map((e: R) => ({
      ...e,
      wg_splits: splits.filter((sp: R) => sp.kosteneintrag_id === e.id),
      bh_splits: bhSplits.filter((sp: R) => sp.kosteneintrag_id === e.id),
    }))
    return NextResponse.json({ eintraege })
  }
  if (a === 'kostenstellen') {
    const { data, error: dataErr } = await (s.from('kostenstellen') as any).select('id, name, kuerzel').eq('tenant_id', t).eq('aktiv', true).order('name')
    if (dataErr) return NextResponse.json({ fehler: `Daten konnten nicht geladen werden: ${dataErr.message}` }, { status: 500 })
    return NextResponse.json({ kostenstellen: data ?? [] })
  }
  if (a === 'kostenarten') {
    const { data, error: dataErr } = await (s.from('kostenarten') as any).select('id, name, kategorie').eq('tenant_id', t).eq('aktiv', true).order('name')
    if (dataErr) return NextResponse.json({ fehler: `Daten konnten nicht geladen werden: ${dataErr.message}` }, { status: 500 })
    return NextResponse.json({ kostenarten: data ?? [] })
  }
  if (a === 'weingaerten') {
    const { data, error: dataErr } = await (s.from('weingarten') as any).select('id, name').eq('tenant_id', t).order('name')
    if (dataErr) return NextResponse.json({ fehler: `Daten konnten nicht geladen werden: ${dataErr.message}` }, { status: 500 })
    return NextResponse.json({ weingaerten: data ?? [] })
  }
  if (a === 'behaelter') {
    // eigene + freigegebene Gebinde (Kellergemeinschaft, Migration 203)
    const rows = await ladeBehaelter(s, t, { nurAktiv: true })
    return NextResponse.json({ behaelter: rows.map(b => ({ id: b.id, name: b.anzeigeName, typ: b.typ })) })
  }
  if (a === 'auswertung') {
    const jahr = req.nextUrl.searchParams.get('jahr') ?? new Date().getFullYear().toString()
    // alle(): Jahresauswertung über alle Kosteneinträge, nicht nur die ersten 1.000
    const { data: ke, error: keErr } = await alle<R>((s.from('kosteneintraege') as any)
      .select('id, betrag, periode, objekt_typ, kostenstelle:kostenstelle_id(name), kostenart:kostenart_id(name), wg:weingarten_id(name), behaelter:behaelter_id(name)')
      .eq('tenant_id', t).gte('datum', `${jahr}-01-01`).lte('datum', `${jahr}-12-31`).order('id'))
    if (keErr) return NextResponse.json({ fehler: `Daten konnten nicht geladen werden: ${keErr.message}` }, { status: 500 })
    const ids = (ke ?? []).map((e: R) => e.id)
    let splits: R[] = []
    if (ids.length > 0) {
      // inBloecken: alle Kosteneinträge des Jahres – ab ≈ 350 IDs scheiterte die URL
      const { data: sd, error: sdErr } = await inBloecken<R>(ids, b => alle<R>((s.from('kosteneintrag_weingaerten') as any)
        .select('kosteneintrag_id, anteil_pct, betrag_anteil, wg:weingarten_id(name, lagen:lage_id(name))').in('kosteneintrag_id', b).order('id')))
      if (sdErr) return NextResponse.json({ fehler: `Daten konnten nicht geladen werden: ${sdErr.message}` }, { status: 500 })
      splits = sd ?? []
    }
    return NextResponse.json({ eintraege: ke ?? [], splits, jahr })
  }
  return NextResponse.json({ fehler: 'Unbekannte Aktion' }, { status: 400 })
}

export async function POST(req: NextRequest) {
  const zweiFaktor = await pruefeZweiFaktor()
  if (zweiFaktor) return zweiFaktor
  const ohneModul = await modulKonflikt('modul_controlling')   // KAN-6: Paket-Modul auch in der Route
  if (ohneModul) return ohneModul
  const s = await createSupabaseServerClient()
  const t = await getTId()
  if (!t) return NextResponse.json({ fehler: 'Kein Betrieb' }, { status: 401 })
  const konflikt = await seitenBetriebKonflikt(t)   // KAN-30: Seite aus einem anderen Betrieb? (Transaktionsnummer)
  if (konflikt) return konflikt
  const membership = await getCurrentMembership()
  const gesperrt = await schreibSperreKonflikt(membership)   // KAN-5: Nur-Lesen-Modus bei gesperrtem Abo
  if (gesperrt) return gesperrt
  if (!membership || !darfKostenSchreiben(membership)) return fehlerAntwort('Keine Berechtigung für die Kostenrechnung – dafür ist die Freigabe Auswertungen, Rieden oder Kellerbuch nötig.', 403)
  const b = await req.json() as R

  const fields = {
    kostenstelle_id: b.kostenstelle_id ?? null, kostenart_id: b.kostenart_id ?? null,
    datum: b.datum, betrag: b.betrag, beschreibung: b.beschreibung ?? null,
    periode: b.datum?.slice(0, 7) ?? null, objekt_typ: b.objekt_typ ?? null,
    weingarten_id: null, // immer null – Splits in Junction-Tabelle
    behaelter_id: b.behaelter_id ?? null,
  }

  if (b.action === 'eintrag') {
    const { data: txnKe, error: txnKeErr } = await (s.rpc as any)('get_next_transaktionsnr', { p_tenant_id: t, p_typ: 'kosteneintrag' })
    if (txnKeErr) return NextResponse.json({ fehler: `Daten konnten nicht geladen werden: ${txnKeErr.message}` }, { status: 500 })
    const { data, error } = await (s.from('kosteneintraege') as any).insert({ tenant_id: t, transaktions_nr: txnKe ?? null, ...fields }).select().single()
    if (error) return fehlerAntwort(error.message)
    const aufteilungFehler = await speichereAufteilungen(s, (data as R).id, b)
    if (aufteilungFehler) {
      // KAN-245: ohne Aufteilung nicht halb gespeichert stehen lassen (vorher: Eintrag ohne Rieden, Antwort ok)
      const { error: e } = await (s.from('kosteneintraege') as any).delete().eq('id', (data as R).id).eq('tenant_id', t).select('id')
      return fehlerAntwort(e ? `${aufteilungFehler} – der Eintrag konnte nicht zurückgenommen werden (${e.message}), bitte prüfen.` : `${aufteilungFehler} – nichts gespeichert.`)
    }
    return NextResponse.json({ ok: true })
  }
  if (b.action === 'aktualisieren') {
    const { data: geaendert, error } = await (s.from('kosteneintraege') as any).update(fields).eq('id', b.id).eq('tenant_id', t).select('id')
    if (error) return fehlerAntwort(error.message)
    if (((geaendert ?? []) as unknown[]).length === 0) return fehlerAntwort(NICHT_GEFUNDEN, 404)
    const aufteilungFehler = await speichereAufteilungen(s, b.id, b)
    if (aufteilungFehler) return fehlerAntwort(`Eintrag gespeichert, aber ${aufteilungFehler} – bitte die Aufteilung erneut speichern.`)
    return NextResponse.json({ ok: true })
  }
  if (b.action === 'loeschen') {
    // KAN-243: vorher meldete die Route auch bei Datenbankfehler bzw. still abgelehntem Löschen (RLS, 0 Zeilen) „ok“
    const { data: weg, error: e } = await (s.from('kosteneintraege') as any).delete().eq('id', b.id).eq('tenant_id', t).select('id')
    if (e) return fehlerAntwort(e.message)
    if (((weg ?? []) as unknown[]).length === 0) return fehlerAntwort('Der Kosteneintrag wurde nicht gelöscht (nicht gefunden oder keine Berechtigung) – bitte die Seite neu laden.', 404)
    return NextResponse.json({ ok: true })
  }
  // Kostenstellen und Kostenarten anlegen/bearbeiten/deaktivieren – KAN-245: Fehler kommen jetzt in der Antwort an
  // (vorher nur protokolliert, Antwort immer ok); Ändern prüft die getroffene Zeile
  const STAMM: Record<string, { tabelle: string; werte: () => R; deaktivieren?: boolean }> = {
    ks_save:   { tabelle: 'kostenstellen', werte: () => ({ name: b.name, kuerzel: b.kuerzel || null, beschreibung: b.beschreibung || null }) },
    ks_delete: { tabelle: 'kostenstellen', werte: () => ({ aktiv: false }), deaktivieren: true },
    ka_save:   { tabelle: 'kostenarten',   werte: () => ({ name: b.name, kuerzel: b.kuerzel || null, kategorie: b.kategorie || null }) },
    ka_delete: { tabelle: 'kostenarten',   werte: () => ({ aktiv: false }), deaktivieren: true },
  }
  const stamm = STAMM[String(b.action)]
  if (stamm) {
    if (!stamm.deaktivieren && !String(b.name ?? '').trim()) return fehlerAntwort('Bitte einen Namen angeben.', 400)
    if (b.id || stamm.deaktivieren) {
      const { data: geaendert, error: e } = await (s.from(stamm.tabelle) as any).update(stamm.werte()).eq('id', b.id).eq('tenant_id', t).select('id')
      if (e) return fehlerAntwort(e.message)
      if (((geaendert ?? []) as unknown[]).length === 0) return fehlerAntwort(NICHT_GEFUNDEN, 404)
    } else {
      const { error: e } = await (s.from(stamm.tabelle) as any).insert({ tenant_id: t, ...stamm.werte() })
      if (e) return fehlerAntwort(e.message)
    }
    return NextResponse.json({ ok: true })
  }
  return NextResponse.json({ fehler: 'Unbekannte Aktion' }, { status: 400 })
}
