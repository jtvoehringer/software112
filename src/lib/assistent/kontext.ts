// Stammdaten-Kontext-Loader für den Prozess-Assistenten (Bot).
//
// Lädt bei jeder Chat-Anfrage frisch die für den Mandanten relevanten
// Stammdaten (Weingärten/Grundstücke, PSM/Düngemittel, Kontakte/Firmen,
// Team-Mitglieder), damit das Sprachmodell z.B. Grundstücksnamen, Mittel
// oder Kunden korrekt zuordnen kann – siehe Konzeptdokument Abschnitt 4
// ("Kontext-Provider") und Abschnitt 7 ("lernt pro Mandant mit").
//
// Bewusst schlank gehalten (nur die für Tool-Use relevanten Felder, Limits
// auf aktive Datensätze) um die Token-Kosten pro Anfrage klein zu halten –
// siehe Kosteneinschätzung im Konzeptdokument, Abschnitt 11.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type R = Record<string, any>

export type AssistentKontext = {
  weingaerten: { id: string; name: string; ried: string | null; rebsorte: string | null }[]
  grundstuecke: { id: string; gst_nr: string; katastralgemeinde: string | null; rebsorte: string | null; weingarten_id: string | null }[]
  psm: { id: string; name: string; kategorie: string | null; oeko_zugelassen: boolean }[]
  duengemittel: { id: string; name: string; typ: string | null; oeko_zugelassen: boolean }[]
  kontakte: { id: string; name: string; ort: string | null }[]
  firmen: { id: string; name: string; ort: string | null }[]
  mitarbeiter: { user_id: string; name: string; rolle: string }[]
  fuellungen: { id: string; name: string; jahrgang: number | null; rebsorte: string | null; flaschengroesse_ml: number | null; bestand_flaschen: number; vk_preis_brutto: number | null }[]
  weinausbau: { id: string; name: string; jahrgang: number | null; rebsorte: string | null; menge_liter: number }[]
  jahrgaenge: { id: string; jahrgang: number }[]
  behaelter: { id: string; name: string; typ: string | null; volumen_liter: number | null }[]
  behandlungstypen: { id: string; name: string; einheit_standard: string | null }[]
  korrekturen: { id: string; begriff: string; interpretation: string; kategorie: string | null }[]
  ustSatzStandard: number
}

/**
 * Lädt den Stammdaten-Kontext für einen Mandanten.
 * `supabase` muss ein RLS-gebundener Server-Client des eingeloggten Users sein
 * (kein Admin-Client) – die Filterung auf den Mandanten übernimmt RLS ohnehin,
 * die explizite tenant_id-Filterung dient nur der Klarheit/Performance.
 */
export async function ladeAssistentKontext(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  tenantId: string
): Promise<AssistentKontext> {
  const [
    { data: weingaertenRaw },
    { data: grundstueckeRaw },
    { data: psmRaw },
    { data: duengemittelRaw },
    { data: kontakteRaw },
    { data: firmenRaw },
    { data: mitgliederRaw },
    { data: fuellungenRaw },
    { data: weinausbauRaw },
    { data: einstellungenRaw },
    { data: jahrgaengeRaw },
    behaelterRows,
    { data: behandlungstypenRaw },
    { data: korrekturenRaw },
  ] = await Promise.all([
    (supabase.from('weingarten') as any)
      .select('id, name, ried, rebsorte')
      .eq('tenant_id', tenantId).eq('aktiv', true)
      .order('name').limit(300),
    (supabase.from('grundstuecke') as any)
      .select('id, gst_nr, katastralgemeinde, rebsorte, weingarten_id')
      .eq('tenant_id', tenantId).eq('nutzart', 'WI')
      .order('gst_nr').limit(500),
    (supabase.from('pflanzenschutzmittel') as any)
      .select('id, name, kategorie, oeko_zugelassen')
      .or(`tenant_id.eq.${tenantId},tenant_id.is.null`).eq('aktiv', true)
      .order('name').limit(300),
    (supabase.from('duengemittel') as any)
      .select('id, name, typ, oeko_zugelassen')
      .or(`tenant_id.eq.${tenantId},tenant_id.is.null`)
      .order('name').limit(200),
    (supabase.from('kontakte') as any)
      .select('id, vorname, nachname, ort')
      .eq('tenant_id', tenantId)
      .order('nachname').limit(500),
    (supabase.from('firmen') as any)
      .select('id, name, ort')
      .eq('tenant_id', tenantId)
      .order('name').limit(500),
    (supabase.from('tenant_memberships') as any)
      .select('user_id, role, profiles:user_id(full_name)')
      .eq('tenant_id', tenantId),
    (supabase.from('fuellungen') as any)
      .select('id, name, jahrgang, rebsorte, flaschengroesse_ml, bestand_flaschen, vk_preis_brutto')
      .eq('tenant_id', tenantId).eq('aktiv', true).gt('bestand_flaschen', 0)
      .order('name').limit(300),
    // WICHTIG (Bugfix 5.8.2026): vorher .in('status', ['ausbau', 'abfuellung']) - das hat
    // Chargen im Status "Gärung" (und "Ernte") komplett unsichtbar für den Bot gemacht, obwohl
    // das im Betrieb der weitaus häufigste Status aktiver Chargen ist. Bot:112 konnte solche
    // Chargen dadurch für KEINEN Prozess (Umziehen, Verschneiden, Abfüllen, Verkauf, ...)
    // finden - und hat auf eine vom User genannte, tatsächlich existierende, aber im Kontext
    // fehlende Charge (z.B. "a90"/Rotgipfler, Status Gärung) mit einer erfundenen
    // Erfolgsmeldung reagiert statt nachzufragen bzw. einen Fehler zu melden. Jetzt wie überall
    // sonst im Code (z.B. umziehen/actions.ts, weinausbau/[id]/page.tsx) nur "abgeschlossen"
    // ausschließen - alle anderen aktiven Status sind für den Bot sichtbar.
    (supabase.from('weinausbau') as any)
      .select('id, name, jahrgang, rebsorte, menge_liter')
      .eq('tenant_id', tenantId).eq('aktiv', true).neq('status', 'abgeschlossen').gt('menge_liter', 0)
      .order('jahrgang', { ascending: false }).limit(300),
    (supabase.from('tenant_einstellungen') as any)
      .select('ust_satz_standard')
      .eq('tenant_id', tenantId).maybeSingle(),
    (supabase.from('weinjahrgaenge') as any)
      .select('id, jahrgang')
      .eq('tenant_id', tenantId)
      .order('jahrgang', { ascending: false }).limit(50),
    // eigene + freigegebene Gebinde (Kellergemeinschaft, Migration 203) - fremd
    // belegte bleiben drin, der Bot bekommt „belegt“ als Hinweis
    ladeBehaelter(supabase, tenantId, { nurAktiv: true }),
    (supabase.from('keller_behandlungstypen') as any)
      .select('id, name, einheit_standard')
      .eq('tenant_id', tenantId)
      .order('sort_order').order('name').limit(200),
    // Korrekturgedächtnis (Phase 5) – pro Mandant gelernte Begriffs-Zuordnungen, siehe
    // Migration 148 (assistent_korrekturen). Limit als Sicherheitsgrenze gegen unbegrenzt
    // wachsende Prompts, analog zu den übrigen Kontext-Listen; erstellt_am desc, damit bei
    // Erreichen des Limits die zuletzt gelernten (vermutlich relevantesten) Einträge bleiben.
    (supabase.from('assistent_korrekturen') as any)
      .select('id, begriff, interpretation, kategorie')
      .eq('tenant_id', tenantId)
      .order('erstellt_am', { ascending: false }).limit(200),
  ])

  return {
    weingaerten: ((weingaertenRaw ?? []) as R[]).map(w => ({
      id: w.id, name: w.name, ried: w.ried ?? null, rebsorte: w.rebsorte ?? null,
    })),
    grundstuecke: ((grundstueckeRaw ?? []) as R[]).map(g => ({
      id: g.id, gst_nr: g.gst_nr, katastralgemeinde: g.katastralgemeinde ?? null,
      rebsorte: g.rebsorte ?? null, weingarten_id: g.weingarten_id ?? null,
    })),
    psm: ((psmRaw ?? []) as R[]).map(p => ({
      id: p.id, name: p.name, kategorie: p.kategorie ?? null, oeko_zugelassen: !!p.oeko_zugelassen,
    })),
    duengemittel: ((duengemittelRaw ?? []) as R[]).map(d => ({
      id: d.id, name: d.name, typ: d.typ ?? null, oeko_zugelassen: !!d.oeko_zugelassen,
    })),
    kontakte: ((kontakteRaw ?? []) as R[]).map(k => ({
      id: k.id, name: [k.vorname, k.nachname].filter(Boolean).join(' '), ort: k.ort ?? null,
    })),
    firmen: ((firmenRaw ?? []) as R[]).map(f => ({
      id: f.id, name: f.name, ort: f.ort ?? null,
    })),
    mitarbeiter: ((mitgliederRaw ?? []) as R[]).map(m => ({
      user_id: m.user_id, name: (m.profiles as R | null)?.full_name ?? '–', rolle: m.role,
    })),
    fuellungen: ((fuellungenRaw ?? []) as R[]).map(f => ({
      id: f.id, name: f.name, jahrgang: f.jahrgang ?? null, rebsorte: f.rebsorte ?? null,
      flaschengroesse_ml: f.flaschengroesse_ml ?? null, bestand_flaschen: f.bestand_flaschen ?? 0,
      vk_preis_brutto: f.vk_preis_brutto ?? null,
    })),
    weinausbau: ((weinausbauRaw ?? []) as R[]).map(w => ({
      id: w.id, name: w.name, jahrgang: w.jahrgang ?? null, rebsorte: w.rebsorte ?? null,
      menge_liter: Number(w.menge_liter ?? 0),
    })),
    ustSatzStandard: Number((einstellungenRaw as R | null)?.ust_satz_standard) || 13,
    jahrgaenge: ((jahrgaengeRaw ?? []) as R[]).map(j => ({ id: j.id, jahrgang: Number(j.jahrgang) })),
    behaelter: behaelterRows.map(b => ({
      id: b.id, name: b.anzeigeName + (b.gesperrt ? ` (belegt durch ${b.fremd_betrieb ?? 'Partnerbetrieb'} – kein Ziel)` : ''), typ: b.typ ?? null, volumen_liter: b.volumen_liter ?? null,
    })),
    behandlungstypen: ((behandlungstypenRaw ?? []) as R[]).map(t => ({
      id: t.id, name: t.name, einheit_standard: t.einheit_standard ?? null,
    })),
    korrekturen: ((korrekturenRaw ?? []) as R[]).map(k => ({
      id: k.id, begriff: k.begriff, interpretation: k.interpretation, kategorie: k.kategorie ?? null,
    })),
  }
}

export const FLASCHEN_LABEL: Record<number, string> = {
  187: '0,187 L', 375: '0,375 L', 500: '0,500 L', 750: '0,75 L',
  1000: '1,0 L', 1500: '1,5 L', 3000: '3,0 L', 6000: '6,0 L',
}

/**
 * Formatiert den Kontext kompakt als Textblock für den System-Prompt.
 * Bewusst als einfache Listen (keine JSON-Verschachtelung) – spart Tokens
 * und ist für das Sprachmodell genauso gut auswertbar.
 */
import { formatRebsorteMitKuerzel } from '@/lib/wein/bki_kuerzel'
import { ladeBehaelter } from '@/lib/keller/behaelter'

export function formatiereKontextFuerPrompt(k: AssistentKontext): string {
  const zeile = (id: string, label: string, extra?: string | null) =>
    `- [${id}] ${label}${extra ? ` (${extra})` : ''}`

  return `
WEINGÄRTEN / RIEDEN (${k.weingaerten.length}):
${k.weingaerten.map(w => zeile(w.id, w.name, [w.ried, w.rebsorte ? formatRebsorteMitKuerzel(w.rebsorte) : null].filter(Boolean).join(', ') || null)).join('\n') || '(keine)'}

GRUNDSTÜCKE (${k.grundstuecke.length}):
${k.grundstuecke.map(g => zeile(g.id, g.gst_nr, [g.katastralgemeinde, g.rebsorte ? formatRebsorteMitKuerzel(g.rebsorte) : null].filter(Boolean).join(', ') || null)).join('\n') || '(keine)'}

PFLANZENSCHUTZMITTEL (${k.psm.length}):
${k.psm.map(p => zeile(p.id, p.name, [p.kategorie, p.oeko_zugelassen ? 'bio-zugelassen' : null].filter(Boolean).join(', ') || null)).join('\n') || '(keine)'}

DÜNGEMITTEL (${k.duengemittel.length}):
${k.duengemittel.map(d => zeile(d.id, d.name, [d.typ, d.oeko_zugelassen ? 'bio-zugelassen' : null].filter(Boolean).join(', ') || null)).join('\n') || '(keine)'}

KONTAKTE (${k.kontakte.length}):
${k.kontakte.map(c => zeile(c.id, c.name, c.ort)).join('\n') || '(keine)'}

FIRMEN (${k.firmen.length}):
${k.firmen.map(f => zeile(f.id, f.name, f.ort)).join('\n') || '(keine)'}

TEAM-MITGLIEDER:
${k.mitarbeiter.map(m => `- ${m.name} (${m.rolle})`).join('\n') || '(keine)'}

FÜLLUNGEN / FLASCHEN-BESTAND (${k.fuellungen.length}, nur mit Bestand > 0):
${k.fuellungen.map(f => zeile(f.id, f.name, [f.jahrgang, f.rebsorte ? formatRebsorteMitKuerzel(f.rebsorte) : null, f.flaschengroesse_ml ? FLASCHEN_LABEL[f.flaschengroesse_ml] : null, `${f.bestand_flaschen} Stk verfügbar`, f.vk_preis_brutto != null ? `VK ${f.vk_preis_brutto} €` : null].filter(Boolean).join(', ') || null)).join('\n') || '(keine)'}

WEINAUSBAU-CHARGEN / FASS-TANK-BESTAND (${k.weinausbau.length}, nur mit Menge > 0):
${k.weinausbau.map(w => zeile(w.id, w.name, [w.jahrgang, w.rebsorte ? formatRebsorteMitKuerzel(w.rebsorte) : null, `${w.menge_liter} L verfügbar`].filter(Boolean).join(', ') || null)).join('\n') || '(keine)'}

STANDARD-UST-SATZ DES BETRIEBS: ${k.ustSatzStandard}%

WEINJAHRGÄNGE (${k.jahrgaenge.length}, bereits angelegt):
${k.jahrgaenge.map(j => `- ${j.jahrgang}`).join('\n') || '(keine)'}

BEHÄLTER / GEBINDE (${k.behaelter.length}):
${k.behaelter.map(b => zeile(b.id, b.name, [b.typ, b.volumen_liter != null ? `${b.volumen_liter} L` : null].filter(Boolean).join(', ') || null)).join('\n') || '(keine)'}

KELLERBEHANDLUNGS-TYPEN (${k.behandlungstypen.length}):
${k.behandlungstypen.map(t => zeile(t.id, t.name, t.einheit_standard)).join('\n') || '(keine)'}

GELERNTE ZUORDNUNGEN – Korrekturgedächtnis (${k.korrekturen.length}, bei einem passenden Treffer
IMMER zuerst hier nachsehen, bevor du selbst in den obigen Stammdaten suchst):
${k.korrekturen.map(x => `- "${x.begriff}" → ${x.interpretation}${x.kategorie ? ` [${x.kategorie}]` : ''}`).join('\n') || '(noch keine gelernt)'}
`.trim()
}
