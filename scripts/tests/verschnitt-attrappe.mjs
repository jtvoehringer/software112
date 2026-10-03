// KAN-112: Nachbildung der RPC s112_verschnitt_buchen für die Supabase-Attrappe (buchung-attrappe.mjs) – nur die
// Wirkung, die die App-Tests brauchen: erlaubte Schlüssel, erwartete Bestände (40001), Bestandsprüfung (22023), neue
// Ziel-Charge, Verschnitt mit Gebinde-Momentaufnahme, Quellen samt Anteil, Schwundbuchung je Quelle, Bestände und
// Merkmale der Ziel-Charge. Die echte Funktion prüfen die DB-Tests (scripts/db-tests/25_verschnitt.sql).
// KAN-193: dazu s112_zukauf_buchen (zukaufRpc) – Zukauf-Charge, Beleg und ggf. Verschnitt in die vorhandene Charge.
// Keine Testdatei (kein *.test.mjs), nur importiert.

const KOPF = ['datum', 'ziel_weinausbau_id', 'neue_ziel_charge', 'notizen', 'ziel_menge_erwartet', 'ziel']
const ZIEL = ['rebsorte', 'jahrgang', 'qualitaetsstufe', 'zusatzbezeichnung', 'erzeugnis', 'herkunft_code', 'kmw', 'oechsle', 'mostgewicht_einheit', 'weinart']   // weinart: KAN-193 (Migration kan112c)
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

/** KAN-112 Nachtrag: Antwort auf rpc('s112_verschnitte_buchen', args) – Buchungen nacheinander in einer „Transaktion“:
 *  scheitert eine, werden die Tabellen auf den Stand vorher zurückgesetzt (alle oder keiner). */
export function verschnitteRpc(t, { p_tenant_id, p_buchungen }) {
  if (!Array.isArray(p_buchungen) || p_buchungen.length === 0) return fehler('22023', 'Bitte mindestens einen Verschnitt angeben.')
  const vorher = structuredClone(t)
  const ergebnisse = []
  for (const b of p_buchungen) {
    const r = verschnittRpc(t, { p_tenant_id, p_kopf: b?.kopf, p_quellen: b?.quellen })
    if (r.error) {
      for (const k of Object.keys(t)) delete t[k]
      Object.assign(t, vorher)
      return r
    }
    ergebnisse.push(r.data)
  }
  return { data: ergebnisse, error: null }
}

// ── KAN-193: s112_zukauf_buchen ────────────────────────────────────────────────────────────────────────────────────
const ZUKAUF = ['datum', 'lieferung_uhrzeit', 'art', 'lieferant_kontakt_id', 'lieferant_firma_id', 'zh_kontakt_id',
  'eingangsrechnungsnummer', 'transport_zugmaschine', 'transport_anhaenger1', 'transport_anhaenger2', 'weinart', 'rebsorte',
  'qualitaetsstufe', 'zusatzbezeichnung', 'erzeugnis', 'land_iso', 'jahrgang', 'herkunft', 'anreicherung', 'kmw', 'oechsle',
  'mostgewicht_einheit', 'alkohol_pct', 'staatliche_pruefnummer', 'menge', 'einheit', 'preis_gesamt', 'einstandspreis_pro_liter', 'notizen']
const ZK_CHARGE = ['name', 'rebsorte', 'behaelter_id', 'jahrgang', 'menge_liter', 'einstandspreis_pro_liter', 'weinart',
  'qualitaetsstufe', 'zusatzbezeichnung', 'erzeugnis', 'land_iso', 'herkunft_code', 'kmw', 'oechsle', 'mostgewicht_einheit']
let zkZaehler = 900
const zkUuid = () => `00000000-0000-4000-8000-${String(++zkZaehler).padStart(12, '0')}`

/** Antwort auf rpc('s112_zukauf_buchen', args): Zukauf-Charge, Beleg und ggf. Verschnitt der ganzen Zukauf-Charge in die
 *  vorhandene Charge (über verschnittRpc) – alles oder nichts. Die echte Funktion prüfen die DB-Tests (26_zukauf_verschnitt.sql). */
export function zukaufRpc(t, { p_tenant_id, p_zukauf, p_charge = null, p_verschnitt = null }) {
  if (!p_zukauf || typeof p_zukauf !== 'object') return fehler('22023', 'Bitte die Angaben zum Zukauf übergeben.')
  for (const k of Object.keys(p_zukauf)) if (!ZUKAUF.includes(k)) return fehler('22023', `Feld „${k}“ kann beim Zukauf nicht gesetzt werden.`)
  if (!p_zukauf.datum || !p_zukauf.art || !(Number(p_zukauf.menge) > 0)) return fehler('22023', 'Bitte Datum, Art und eine Menge über 0 angeben.')
  t.weinausbau ??= []; t.zukauf_posten ??= []
  const vorher = structuredClone(t)
  const zurueck = r => { for (const k of Object.keys(t)) delete t[k]; Object.assign(t, vorher); return r }
  let chargeId = null
  let menge = 0
  if (p_charge) {
    for (const k of Object.keys(p_charge)) if (!ZK_CHARGE.includes(k)) return fehler('22023', `Feld „${k}“ kann für die Zukauf-Charge nicht gesetzt werden.`)
    menge = r2(Number(p_charge.menge_liter) || 0)
    if (!p_charge.behaelter_id || menge <= 0) return fehler('22023', 'Für die Zukauf-Charge bitte Gebinde und Menge angeben.')
    chargeId = zkUuid()
    t.weinausbau.push({
      id: chargeId, tenant_id: p_tenant_id, land_iso: 'AT', storniert_am: null, notizen: null, ...p_charge,
      name: p_charge.name?.trim() || p_charge.rebsorte?.trim() || 'Zukauf', status: 'ausbau', aktiv: true, menge_liter: menge,
    })
  } else if (p_verschnitt) {
    return fehler('22023', 'Ein Verschnitt braucht die Zukauf-Charge.')
  }
  const zukaufId = zkUuid()
  t.zukauf_posten.push({ id: zukaufId, tenant_id: p_tenant_id, aktiv: true, storniert_am: null, erstellt_am: '2026-10-03T09:00:00Z', ...p_zukauf, ziel_weinausbau_id: chargeId })
  let vs = null
  if (p_verschnitt) {
    if ('datum' in p_verschnitt || 'neue_ziel_charge' in p_verschnitt) return zurueck(fehler('22023', 'Datum und neue Charge kommen beim Zukauf-Verschnitt nicht aus dem Kopf.'))
    const r = verschnittRpc(t, {
      p_tenant_id, p_kopf: { ...p_verschnitt, datum: p_zukauf.datum },
      p_quellen: [{ weinausbau_id: chargeId, menge_liter: menge, menge_erwartet: menge }],
    })
    if (r.error) return zurueck(r)
    vs = r.data
  }
  return { data: { zukauf_id: zukaufId, charge_id: chargeId, verschnitt: vs }, error: null }
}
