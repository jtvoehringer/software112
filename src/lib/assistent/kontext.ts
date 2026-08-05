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
  ] = await Promise.all([
    (supabase.from('weingarten') as any)
      .select('id, name, ried, rebsorte')
      .eq('tenant_id', tenantId).eq('aktiv', true)
      .order('name').limit(300),
    (supabase.from('grundstuecke') as any)
      .select('id, gst_nr, katastralgemeinde, rebsorte, weingarten_id')
      .eq('tenant_id', tenantId).eq('status', 'aktiv')
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
  }
}

/**
 * Formatiert den Kontext kompakt als Textblock für den System-Prompt.
 * Bewusst als einfache Listen (keine JSON-Verschachtelung) – spart Tokens
 * und ist für das Sprachmodell genauso gut auswertbar.
 */
export function formatiereKontextFuerPrompt(k: AssistentKontext): string {
  const zeile = (id: string, label: string, extra?: string | null) =>
    `- [${id}] ${label}${extra ? ` (${extra})` : ''}`

  return `
WEINGÄRTEN / RIEDEN (${k.weingaerten.length}):
${k.weingaerten.map(w => zeile(w.id, w.name, [w.ried, w.rebsorte].filter(Boolean).join(', ') || null)).join('\n') || '(keine)'}

GRUNDSTÜCKE (${k.grundstuecke.length}):
${k.grundstuecke.map(g => zeile(g.id, g.gst_nr, [g.katastralgemeinde, g.rebsorte].filter(Boolean).join(', ') || null)).join('\n') || '(keine)'}

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
`.trim()
}
