// KAN-112: Nachbildung der RPC s112_verschnitt_buchen für die Supabase-Attrappe (buchung-attrappe.mjs) – nur die
// Wirkung, die die App-Tests brauchen: erlaubte Schlüssel, erwartete Bestände (40001), Bestandsprüfung (22023), neue
// Ziel-Charge, Verschnitt mit Gebinde-Momentaufnahme, Quellen samt Anteil, Schwundbuchung je Quelle, Bestände und
// Merkmale der Ziel-Charge. Die echte Funktion prüfen die DB-Tests (scripts/db-tests/25_verschnitt.sql).
// Keine Testdatei (kein *.test.mjs), nur importiert.

const KOPF = ['datum', 'ziel_weinausbau_id', 'neue_ziel_charge', 'notizen', 'ziel_menge_erwartet', 'ziel']
const ZIEL = ['rebsorte', 'jahrgang', 'qualitaetsstufe', 'zusatzbezeichnung', 'erzeugnis', 'herkunft_code', 'kmw', 'oechsle', 'mostgewicht_einheit']
const NEU = ['name', 'behaelter_id', 'rebsorte', 'jahrgang', 'weinart', 'herkunft_code', 'land_iso', 'qualitaetsstufe', 'zusatzbezeichnung', 'erzeugnis', 'status', 'notizen']

const r2 = n => Math.round(n * 100) / 100
const fehler = (code, message) => ({ data: null, error: { code, message } })

/** Antwort auf rpc('s112_verschnitt_buchen', args) gegen die Tabellen `t` (Arrays je Tabelle, werden geändert) */
export function verschnittRpc(t, { p_tenant_id, p_kopf, p_quellen }) {
  for (const k of Object.keys(p_kopf ?? {})) if (!KOPF.includes(k)) return fehler('22023', `Schlüssel ${k} nicht erlaubt`)
  for (const k of Object.keys(p_kopf?.ziel ?? {})) if (!ZIEL.includes(k)) return fehler('22023', `Feld „${k}“ kann beim Verschnitt nicht gesetzt werden.`)
  t.weinausbau ??= []; t.verschneidungen ??= []; t.verschneidung_quellen ??= []; t.keller_umzuege ??= []
  let zielId = p_kopf.ziel_weinausbau_id ?? null
  if (!zielId && p_kopf.neue_ziel_charge) {
    const n = p_kopf.neue_ziel_charge
    for (const k of Object.keys(n)) if (!NEU.includes(k)) return fehler('22023', `Feld „${k}“ kann für die neue Charge nicht gesetzt werden.`)
    zielId = `neu-charge-${t.weinausbau.length + 1}`
    t.weinausbau.push({ id: zielId, tenant_id: p_tenant_id, menge_liter: 0, aktiv: true, land_iso: 'AT', status: 'ausbau', storniert_am: null, ...n })
  }
  const ziel = t.weinausbau.find(w => w.id === zielId && w.tenant_id === p_tenant_id)
  if (!ziel) return fehler('P0002', 'Ziel-Charge nicht gefunden.')
  if (!Array.isArray(p_quellen) || p_quellen.length === 0) return fehler('22023', 'Bitte mindestens eine Quell-Charge angeben.')
  if ('ziel_menge_erwartet' in p_kopf && Math.abs(Number(ziel.menge_liter) - Number(p_kopf.ziel_menge_erwartet)) > 0.005) {
    return fehler('40001', `Der Bestand der Ziel-Charge „${ziel.name}“ hat sich inzwischen geändert – bitte erneut buchen.`)
  }
  const vid = `vs-neu-${t.verschneidungen.length + 1}`
  t.verschneidungen.push({
    id: vid, tenant_id: p_tenant_id, datum: p_kopf.datum, ziel_weinausbau_id: zielId, ziel_behaelter_id: ziel.behaelter_id ?? null,
    notizen: p_kopf.notizen?.trim() || null, storniert_am: null, created_at: '2026-10-03T10:00:00Z', gebinde_rekonstruiert: false,
  })
  let summe = 0
  const zeilen = []
  for (const q of p_quellen) {
    const src = t.weinausbau.find(w => w.id === q.weinausbau_id && w.tenant_id === p_tenant_id)
    if (!src) return fehler('P0002', 'Quell-Charge nicht gefunden.')
    const menge = r2(Number(q.menge_liter) || 0), schwund = r2(Math.max(Number(q.schwund_liter) || 0, 0))
    if ('menge_erwartet' in q && Math.abs(Number(src.menge_liter) - Number(q.menge_erwartet)) > 0.005) {
      return fehler('40001', `Der Bestand der Quell-Charge „${src.name}“ hat sich inzwischen geändert – bitte erneut buchen.`)
    }
    if (menge + schwund > Number(src.menge_liter) + 0.005) return fehler('22023', `Quell-Charge „${src.name}“: zu viel`)
    let schwundId = null
    if (schwund >= 0.01) {
      schwundId = `schwund-${t.keller_umzuege.length + 1}`
      t.keller_umzuege.push({
        id: schwundId, tenant_id: p_tenant_id, datum: p_kopf.datum, von_weinausbau_id: src.id, von_behaelter_id: src.behaelter_id ?? null,
        nach_behaelter_id: src.behaelter_id ?? null, menge_liter: 0, brutto_liter: schwund, schwund_liter: schwund, umzug_typ: 'schwund',
        notizen: `Schwund beim Verschnitt in „${ziel.name}“`, storniert_am: null, erstellt_am: '2026-10-03T10:00:00Z',
      })
    }
    const zeile = { id: `vq-neu-${t.verschneidung_quellen.length + 1}`, verschneidung_id: vid, quell_weinausbau_id: src.id, menge_liter: menge,
      anteil_pct: null, quell_behaelter_id: src.behaelter_id ?? null, gebinde_rekonstruiert: false, schwund_umzug_id: schwundId }
    t.verschneidung_quellen.push(zeile)
    zeilen.push(zeile)
    const rest = Number(src.menge_liter) - menge - schwund
    Object.assign(src, rest <= 0.01 ? { menge_liter: 0, aktiv: false, status: 'abgeschlossen' } : { menge_liter: r2(rest) })
    summe += menge
  }
  for (const z of zeilen) z.anteil_pct = summe > 0 ? Math.round(z.menge_liter / summe * 1000) / 10 : null
  ziel.menge_liter = r2(Number(ziel.menge_liter) + summe)
  Object.assign(ziel, p_kopf.ziel ?? {})
  return { data: { verschneidung_id: vid, ziel_weinausbau_id: zielId, quellen: zeilen.length, liter: summe, ziel_menge: ziel.menge_liter }, error: null }
}
