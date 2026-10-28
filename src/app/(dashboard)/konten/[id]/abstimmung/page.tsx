import { redirect, notFound } from 'next/navigation'
import { geladen } from '@/lib/supabase/geladen'
import { mitStornoGegenzeile } from '@/lib/finanzen/stornoGegenzeile'
import { nachTagUndZeit } from '@/lib/datum/reihenfolge'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { getCurrentMembership, canWrite } from '@/lib/auth/roles'
import AbstimmungClient from './AbstimmungClient'
import { wienHeute } from '@/lib/csv'
import { csvPfad } from '@/lib/behoerden/katalog'
import { standardZeitraum } from '@/lib/behoerden/buchhaltung-gemeinsam'
import type { Metadata } from 'next'

export const metadata: Metadata = { title: 'Kontoabstimmung' }

export const dynamic = 'force-dynamic'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type R = Record<string, any>

export type Bewegung = {
  id:           string
  quelle:       'zahlung' | 'ea_transaktion' | 'umbuchung_von' | 'umbuchung_nach'
  datum:        string
  beschreibung: string
  betrag:       number   // vorzeichenbehaftet: Zugang positiv, Abgang negativ
  abgeglichen:  boolean
  gesperrt:     boolean  // is_locked (nur informativ – Abgleich bleibt trotzdem möglich)
  andereKontoId?: string  // bei Umbuchungen: die jeweils andere Kontoseite (für Löschen/Revalidate)
  saldoNachher?: number
  /** KAN-149 D2b: stornierte Zahlung/Umbuchung (an ihrem Tag) bzw. deren Gegenzeile am Storno-Tag */
  storniert?: boolean
  gegenzeile?: boolean
  /** KAN-384: Erfassungszeitpunkt – Reihenfolge am selben Tag (Gegenzeile: Zeitpunkt des Stornos) */
  zeitpunkt?: string | null
}

/** Bewegung plus Gegenzeile am Storno-Tag (KAN-149 D2b, lib/finanzen/stornoGegenzeile.ts) */
function stornoPaar(b: Bewegung, z: R): Bewegung[] {
  const [orig, ...gegen] = mitStornoGegenzeile(b, { storniertAm: z.storniert_am, grund: z.storno_grund }, 'beschreibung',
    { gegenzeile: true, abgeglichen: false, gesperrt: true })
  return gegen.length ? [{ ...orig, storniert: true }, ...gegen.map(g => ({ ...g, zeitpunkt: z.storniert_am ?? null }))] : [orig]
}

/** Kassabuch (Behördenmeldung „kassabuch“): Druckseite und CSV für das laufende Jahr */
function kassabuchLinks(kontoId: string) {
  const { von, bis } = standardZeitraum(wienHeute())
  return {
    druck: `/buchhaltung/kassabuch?${new URLSearchParams({ konto: kontoId, von, bis }).toString()}`,
    csv: csvPfad('kassabuch', { konto: kontoId, von, bis }),
  }
}

export default async function AbstimmungPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const supabase   = await createSupabaseServerClient()
  const membership = await getCurrentMembership()
  if (!membership?.tenantId) redirect('/login')
  const tenantId = membership.tenantId
  const writeOk  = canWrite(membership.role, 'ea')
  const { id: kontoId } = await params

  const einst = geladen(await (supabase.from('tenant_einstellungen') as any)
    .select('modul_ea').eq('tenant_id', tenantId).maybeSingle(), 'Einstellungen')
  if (!einst?.modul_ea) redirect('/dashboard')

  const kontoRaw = geladen(await (supabase.from('konten') as any)
    .select('*').eq('id', kontoId).eq('tenant_id', tenantId).maybeSingle(), 'Konten')
  if (!kontoRaw) notFound()
  const konto = kontoRaw as R

  const alleKontenRaw = geladen(await (supabase.from('konten') as any)
    .select('id, name').eq('tenant_id', tenantId).eq('aktiv', true).neq('id', kontoId).order('name'), 'Konten')
  const andereKonten = ((alleKontenRaw ?? []) as R[]).map(k => ({ id: k.id as string, name: k.name as string }))
  const kontoNamen = new Map<string, string>([[kontoId, konto.name], ...andereKonten.map(k => [k.id, k.name] as const)])

  const [zahlungenRawRes, txRawRes, umbVonRawRes, umbNachRawRes] = await Promise.all([
    // storno-sichtbar: Liste/Druck zeigt stornierte Buchungen gekennzeichnet (storniert_am wird mitgeladen) – Abstimmung
    (supabase.from('zahlungen') as any)
      .select('id, betrag, datum, erstellt_am, abgeglichen, storniert_am, storno_grund, verkaufsposten(rechnungsnummer)')
      .eq('tenant_id', tenantId).eq('konto_id', kontoId),
    // storno-sichtbar: Liste/Druck zeigt stornierte Buchungen gekennzeichnet (storniert_am wird mitgeladen) – Abstimmung
    (supabase.from('ea_transaktionen') as any)
      .select('id, typ, betrag_brutto, datum, erstellt_am, beschreibung, abgeglichen, is_locked, storniert_am, storno_von_id')
      .eq('tenant_id', tenantId).eq('konto_id', kontoId),
    // storno-sichtbar: Liste/Druck zeigt stornierte Buchungen gekennzeichnet (storniert_am wird mitgeladen) – Abstimmung
    (supabase.from('konto_umbuchungen') as any)
      .select('id, betrag, datum, erstellt_am, beschreibung, von_abgeglichen, nach_konto_id, storniert_am, storno_grund')
      .eq('tenant_id', tenantId).eq('von_konto_id', kontoId),
    // storno-sichtbar: Liste/Druck zeigt stornierte Buchungen gekennzeichnet (storniert_am wird mitgeladen) – Abstimmung
    (supabase.from('konto_umbuchungen') as any)
      .select('id, betrag, datum, erstellt_am, beschreibung, nach_abgeglichen, von_konto_id, storniert_am, storno_grund')
      .eq('tenant_id', tenantId).eq('nach_konto_id', kontoId),
  ])
  const zahlungenRaw = geladen(zahlungenRawRes, 'Zahlungen')
  const txRaw = geladen(txRawRes, 'Buchungen')
  const umbVonRaw = geladen(umbVonRawRes, 'Umbuchungen')
  const umbNachRaw = geladen(umbNachRawRes, 'Umbuchungen')

  const bewegungen: Bewegung[] = [
    // KAN-149 D2b: stornierte Zahlungen/Umbuchungen an ihrem Tag gekennzeichnet, Gegenzeile am Storno-Tag
    ...((zahlungenRaw ?? []) as R[]).flatMap(z => stornoPaar({
      id: z.id as string, quelle: 'zahlung' as const, datum: z.datum as string, zeitpunkt: z.erstellt_am ?? null,
      beschreibung: `Zahlungseingang${z.verkaufsposten?.rechnungsnummer ? ` RE ${z.verkaufsposten.rechnungsnummer}` : ''}`,
      betrag: Number(z.betrag ?? 0), abgeglichen: !!z.abgeglichen, gesperrt: false,
    }, z)),
    // KAN-149 D2c: E&A-Stornos sind echte Gegenbuchungen (negativer Betrag, eigener Abgleich) – Original und
    // Gegenbuchung nur grau gekennzeichnet
    ...((txRaw ?? []) as R[]).map(t => ({
      id: t.id as string, quelle: 'ea_transaktion' as const, datum: t.datum as string, zeitpunkt: t.erstellt_am ?? null,
      beschreibung: `${t.beschreibung as string}${t.storniert_am ? ' (storniert)' : ''}`,
      betrag: (t.typ === 'einnahme' ? 1 : -1) * Number(t.betrag_brutto ?? 0),
      abgeglichen: !!t.abgeglichen, gesperrt: !!t.is_locked,
      storniert: !!t.storniert_am || !!t.storno_von_id,
    })),
    ...((umbVonRaw ?? []) as R[]).flatMap(u => stornoPaar({
      id: u.id as string, quelle: 'umbuchung_von' as const, datum: u.datum as string, zeitpunkt: u.erstellt_am ?? null,
      beschreibung: u.beschreibung || `⇆ an ${kontoNamen.get(u.nach_konto_id) ?? 'anderes Konto'}`,
      betrag: -Number(u.betrag ?? 0), abgeglichen: !!u.von_abgeglichen, gesperrt: false,
      andereKontoId: u.nach_konto_id as string,
    }, u)),
    ...((umbNachRaw ?? []) as R[]).flatMap(u => stornoPaar({
      id: u.id as string, quelle: 'umbuchung_nach' as const, datum: u.datum as string, zeitpunkt: u.erstellt_am ?? null,
      beschreibung: u.beschreibung || `⇆ von ${kontoNamen.get(u.von_konto_id) ?? 'anderes Konto'}`,
      betrag: Number(u.betrag ?? 0), abgeglichen: !!u.nach_abgeglichen, gesperrt: false,
      andereKontoId: u.von_konto_id as string,
    }, u)),
  ]

  // Chronologisch für den Saldenlauf, danach für die Anzeige umgedreht (neueste zuerst)
  bewegungen.sort(nachTagUndZeit(b => ({ tag: b.datum, zeit: b.zeitpunkt, id: b.id })))   // KAN-384

  const vorEroeffnung = bewegungen.filter(b => b.datum <= konto.eroeffnungsdatum)
  const nachEroeffnung = bewegungen.filter(b => b.datum > konto.eroeffnungsdatum)

  let laufend = Number(konto.eroeffnungssaldo ?? 0)
  for (const b of nachEroeffnung) {
    laufend += b.betrag
    b.saldoNachher = laufend
  }

  return (
    <AbstimmungClient
      konto={{ id: konto.id, name: konto.name, typ: konto.typ, iban: konto.iban, eroeffnungsdatum: konto.eroeffnungsdatum, eroeffnungssaldo: Number(konto.eroeffnungssaldo ?? 0) }}
      andereKonten={andereKonten}
      bewegungen={[...nachEroeffnung].reverse()}
      anzahlVorEroeffnung={vorEroeffnung.length}
      aktuellerSaldo={laufend}
      writeOk={writeOk}
      kassabuch={konto.typ === 'kassa' ? kassabuchLinks(konto.id) : null}
    />
  )
}
