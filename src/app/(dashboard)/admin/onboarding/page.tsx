'use client'

import { useState, useEffect } from 'react'

type Schritt = {
  id: string
  titel: string
  beschreibung: string
  link?: string
  linkLabel?: string
  pflicht: boolean
}

type Gruppe = { gruppe: string; schritte: Schritt[] }

const ONBOARDING_SCHRITTE: Gruppe[] = [
  {
    gruppe: 'Mandant anlegen',
    schritte: [
      { id: 's1', pflicht: true, titel: 'Tenant in Supabase anlegen', beschreibung: 'Im Supabase SQL-Editor: INSERT INTO tenants (name, slug) VALUES (\'Weingut Name\', \'weingut-slug\'). Tenant-ID aus der Rückgabe notieren.', },
      { id: 's2', pflicht: true, titel: 'Ersten Benutzer einladen', beschreibung: 'Admin > Benutzer > "Super-Admin einladen". Nach Registrierung in Admin > Mandant > Benutzer als tenant_admin setzen.', link: '/admin/mandanten', linkLabel: 'Admin öffnen' },
      { id: 's3', pflicht: true, titel: 'Tenant-Mitgliedschaft prüfen', beschreibung: 'SQL: SELECT * FROM tenant_memberships WHERE tenant_id = \'TENANT_ID\'. Muss mindestens einen Eintrag mit role = tenant_admin zeigen.' },
    ],
  },
  {
    gruppe: 'Betrieb konfigurieren',
    schritte: [
      { id: 's4', pflicht: true, titel: 'Betriebsdaten eintragen', beschreibung: 'Admin > Mandant > Betrieb: Name, Adresse, UID-Nummer eintragen. Erscheint auf allen gedruckten Dokumenten (Rechnung, Etikett, Behandlungsprotokoll).', link: '/admin/mandanten', linkLabel: 'Admin öffnen' },
      // KAN-134: gleiche Einstellung wie „Mein Betrieb“ → Kellerwirtschaft (Betriebs-Manager)
      { id: 'kw1', pflicht: true, titel: 'Mostgewicht-Einheit festlegen', beschreibung: 'Admin > Mandant > Betrieb, Abschnitt „Kellerwirtschaft“: mit dem Betrieb klären, ob er das Mostgewicht in °KMW (Standard) oder °Oe (Öchsle) misst, und diese Einheit wählen. Formulare und Listen zeigen sie zuerst, die andere umgerechnet daneben; die Qualitätsstufe richtet sich immer nach °KMW. Später kann der Betriebs-Manager sie selbst unter System > Mein Betrieb > Kellerwirtschaft ändern.', link: '/admin/mandanten', linkLabel: 'Admin öffnen' },
      { id: 's5', pflicht: true, titel: 'Branding einrichten', beschreibung: 'Admin > Mandant > Branding: Logo hochladen (URL), Primärfarbe (teal) und Sekundärfarbe (gelb) anpassen. Logo erscheint in der Sidebar und auf Druckdokumenten.' },
      { id: 's6', pflicht: true, titel: 'Rechnungseinstellungen', beschreibung: 'Admin > Mandant > Verkauf: Rechnungsnummer-Präfix (z.B. RE), Stellen (z.B. 4), Accountnummer-Präfix (z.B. K). IBAN + BIC + Zahlungsziel für Rechnungsdruck.' },
      { id: 's7', pflicht: true, titel: 'USt.-Satz festlegen', beschreibung: 'Admin > Mandant > Verkauf: 13% für Weinproduzenten (Standard), 20% für Weinhändler. Kann später geändert werden.' },
    ],
  },
  {
    gruppe: 'Grunddaten erfassen',
    schritte: [
      { id: 's8', pflicht: true, titel: 'PSM-Stammdaten eintragen', beschreibung: 'Rieden > Betriebsmittel > Tab „Stammdaten": Die häufigsten Pflanzenschutzmittel anlegen (Name, Handelsnamen, Wirkstoff, Wartezeit, Cu-Gehalt, Öko-Zulassung).', link: '/behandlungen/lager?tab=stammdaten', linkLabel: 'Betriebsmittel öffnen' },
      { id: 's9', pflicht: true, titel: 'Rieden anlegen', beschreibung: 'Rieden > Neue Ried: alle Parzellen anlegen.', link: '/weingarten', linkLabel: 'Rieden öffnen' },
      { id: 's10', pflicht: true, titel: 'Behälter anlegen', beschreibung: 'Kellerbuch > Vinifizierung > Neuer Behälter: alle Tanks und Fässer anlegen (Typ, Volumen). Basis für Kellerplan und Umzug-Modul.', link: '/kellerbuch', linkLabel: 'Kellerbuch öffnen' },
      { id: 's11', pflicht: false, titel: 'Jahrgang anlegen', beschreibung: 'Kellerbuch > Vinifizierung: ersten Weinausbau-Jahrgang anlegen. Oder warte bis nach der nächsten Lese und starte mit der Erntemeldung.', link: '/kellerbuch', linkLabel: 'Kellerbuch öffnen' },
    ],
  },
  {
    gruppe: 'CRM & Kontakte',
    schritte: [
      { id: 's12', pflicht: false, titel: 'Bestandskunden importieren', beschreibung: 'CRM > Kontakte: Kontakte manuell anlegen oder per CSV-Import (Datenexport > Kontakte als Vorlage). Wichtig: E-Mail-Adressen für E-Mail-Matching eintragen.', link: '/crm/kontakte', linkLabel: 'Kontakte öffnen' },
      { id: 's13', pflicht: false, titel: 'Rabattgruppen anlegen', beschreibung: 'Warenwirtschaft > Rabattgruppen: z.B. "Gastronomie 10%", "Stammkunde 5%". Können dann direkt Kontakten/Firmen zugewiesen werden.', link: '/weinhandel/rabattgruppen', linkLabel: 'Rabattgruppen öffnen' },
    ],
  },
  {
    gruppe: 'E-Mail einrichten',
    schritte: [
      { id: 's15', pflicht: false, titel: 'M365 oder SMTP konfigurieren', beschreibung: 'Admin > Mandant > E-Mail (SMTP) oder M365 (Outlook). M365 empfohlen: OAuth2, kein Passwort-Sharing, Echtzeit-Webhook. SMTP als Fallback für andere Anbieter.', link: '/admin/mandanten', linkLabel: 'Admin öffnen' },
      { id: 's16', pflicht: false, titel: 'Test-E-Mail senden', beschreibung: 'CRM > Kontakt öffnen > Senden: Test-E-Mail an einen Kontakt schicken. Prüfen ob die E-Mail als Aktivität angelegt wird und die Antwort zurückkommt.' },
    ],
  },
  {
    gruppe: 'E-Mail & Nachrichten',
    schritte: [
      { id: 'em1', pflicht: false, titel: 'M365 Verbindung pro Benutzer', beschreibung: 'Jeder Benutzer verbindet seine eigene Mailbox: Nachrichten > "Mit Microsoft 365 verbinden" und mit dem Weingut-Konto anmelden. Die Verbindung ist persönlich und getrennt von der Admin-M365-Konfiguration.', link: '/nachrichten', linkLabel: 'Nachrichten öffnen' },
      { id: 'em2', pflicht: false, titel: 'Shared Mailbox einrichten (optional)', beschreibung: 'Falls eine gemeinsame Mailbox genutzt wird (z.B. office@weingut.at): Nachrichten > Einstellungen > Adresse eintragen. Exchange-Administrator muss Send-As-Rechte vergeben.', link: '/nachrichten', linkLabel: 'Nachrichten öffnen' },
      { id: 'em3', pflicht: false, titel: 'KI-Modul testen', beschreibung: 'Unter "Frag dein Weingut": eine Beispiel-Frage stellen (z.B. "Welche Kontakte haben wir?"). Das Modul ist für den Piloten mit Unlimited-Paket freigeschaltet.', link: '/ki', linkLabel: 'KI-Modul öffnen' },
    ],
  },
  {
    gruppe: 'Weinexport (optional)',
    schritte: [
      { id: 'we1', pflicht: false, titel: 'Weinexport-Modul aktivieren', beschreibung: 'Admin > Mandant > Module: modul_weinexport aktivieren. Danach erscheint "Weinexport" in der Sidebar.', link: '/admin/mandanten', linkLabel: 'Admin öffnen' },
      { id: 'we2', pflicht: false, titel: 'Test-Exportauftrag anlegen', beschreibung: 'Weinexport > Neuer Auftrag: Importeur, Destination, Incoterms und Weinposition eintragen. Testweise ein Dokument (z.B. Lieferschein) als PDF öffnen.', link: '/weinexport/neu', linkLabel: 'Neuer Auftrag' },
    ],
  },
  {
    gruppe: 'Datenimport (optional)',
    schritte: [
      { id: 'di1', pflicht: false, titel: 'Bestandskunden per CSV importieren', beschreibung: 'Administration > Datenimport > Kontakte: CSV vorbereiten (Spalte "Nachname" Pflicht), hochladen, Spalten zuordnen, importieren. Danach im CRM prüfen.', link: '/admin/import', linkLabel: 'Datenimport öffnen' },
      { id: 'di2', pflicht: false, titel: 'Flaschenlager importieren', beschreibung: 'Administration > Datenimport > Füllungen: bestehenden Lagerbestand importieren (Spalte "Bezeichnung" Pflicht, "Lagerbestand" = aktuelle Flaschenanzahl).', link: '/admin/import', linkLabel: 'Datenimport öffnen' },
    ],
  },
  {
    gruppe: 'Abnahme',
    schritte: [
      { id: 's17', pflicht: true, titel: 'Testverkauf durchführen', beschreibung: 'Warenwirtschaft > Verkauf > Neuer Verkauf: Einen kompletten Verkauf anlegen, Rechnung drucken, als bezahlt markieren. Prüfen ob Bestand korrekt reduziert wird.', link: '/weinhandel/verkauf/neu', linkLabel: 'Neuer Verkauf' },
      { id: 's18', pflicht: true, titel: 'Maßnahme + Bericht testen', beschreibung: 'Maßnahme erfassen, dann Rieden > Behandlungsprotokoll öffnen und prüfen ob der Eintrag erscheint – im Ausdruck und in der CSV („CSV exportieren“).', link: '/reports/behandlungsprotokoll', linkLabel: 'Behandlungsprotokoll öffnen' },
      { id: 's19', pflicht: false, titel: 'Handbuch + FAQ prüfen', beschreibung: 'Unter Hilfe > Handbuch und Hilfe > FAQ prüfen ob die wichtigsten Informationen für den neuen Mandanten vorhanden sind.', link: '/hilfe/handbuch', linkLabel: 'Handbuch öffnen' },
    ],
  },
]

const STORAGE_KEY = 'onboarding_erledigt'

export default function OnboardingPage() {
  const [erledigt, setErledigt] = useState<Set<string>>(new Set())
  const [mandant, setMandant] = useState('')

  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY)
      if (saved) setErledigt(new Set(JSON.parse(saved)))
    } catch { /* ignore */ }
  }, [])

  function toggle(id: string) {
    setErledigt(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify([...next])) } catch { /* ignore */ }
      return next
    })
  }

  function reset() {
    if (!confirm('Alle Häkchen zurücksetzen?')) return
    setErledigt(new Set())
    try { localStorage.removeItem(STORAGE_KEY) } catch { /* ignore */ }
  }

  const gesamt = ONBOARDING_SCHRITTE.flatMap(g => g.schritte).length
  const done = ONBOARDING_SCHRITTE.flatMap(g => g.schritte).filter(s => erledigt.has(s.id)).length
  const pct = Math.round(done / gesamt * 100)

  return (
    <div className="space-y-6 max-w-3xl">
      <div className="flex items-center gap-2 text-sm text-s112-muted">
        <span>Administration</span>
        <span>/</span>
        <span className="text-s112-text-1 font-medium">Onboarding Guide</span>
      </div>
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-s112-text">Onboarding Guide</h1>
          <p className="text-sm text-s112-muted mt-1">Checkliste für die Einrichtung eines neuen Mandanten</p>
        </div>
        <button onClick={reset} className="text-xs text-s112-muted hover:text-s112-err border border-s112-border px-3 py-1.5 rounded-lg">
          Zurücksetzen
        </button>
      </div>

      {/* Fortschritt */}
      <div className="card p-4">
        <div className="flex items-center justify-between mb-2">
          <div>
            <input value={mandant} onChange={e => setMandant(e.target.value)}
              placeholder="Mandanten-Name (optional)"
              className="border border-s112-border rounded-lg px-3 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-s112-teal/40 w-60" />
          </div>
          <span className={`text-lg font-semibold ${pct === 100 ? 'text-s112-ok-fg' : 'text-s112-blue-700'}`}>{pct}%</span>
        </div>
        <div className="w-full bg-s112-bg rounded-full h-3">
          <div className={`h-3 rounded-full transition-all ${pct === 100 ? 'bg-s112-ok' : 'bg-s112-teal'}`}
            style={{ width: `${pct}%` }} />
        </div>
        <p className="text-xs text-s112-muted mt-1">{done} von {gesamt} Schritten erledigt</p>
      </div>

      {/* Schritte */}
      {ONBOARDING_SCHRITTE.map(gruppe => (
        <div key={gruppe.gruppe}>
          <h2 className="text-base font-semibold text-s112-text mb-3">
            {gruppe.gruppe}
          </h2>
          <div className="space-y-2">
            {gruppe.schritte.map(s => {
              const done = erledigt.has(s.id)
              return (
                <div key={s.id}
                  className={`card p-4 flex gap-3 ${done ? 'opacity-60' : ''}`}>
                  <button type="button" onClick={() => toggle(s.id)}
                    className={`mt-0.5 w-5 h-5 rounded border-2 flex items-center justify-center flex-shrink-0 transition-colors
                      ${done ? 'bg-s112-ok border-s112-ok text-white' : 'bg-white border-s112-line-str hover:border-s112-ok/50'}`}>
                    {done && <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                    </svg>}
                  </button>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <p className={`text-sm font-medium ${done ? 'line-through text-s112-tertiary' : 'text-s112-text'}`}>{s.titel}</p>
                      {!s.pflicht && <span className="text-xs bg-[#F2F3F5] text-s112-text-2 px-1.5 py-0.5 rounded">optional</span>}
                    </div>
                    <p className="text-xs text-s112-text-2 leading-relaxed">{s.beschreibung}</p>
                    {s.link && !done && (
                      <a href={s.link} className="text-xs text-s112-blue-700 hover:underline mt-1 inline-block">
                        {s.linkLabel} →
                      </a>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      ))}

      {pct === 100 && (
        <div className="bg-s112-ok-bg border border-s112-ok/30 rounded-xl p-5 text-center">
          <p className="font-semibold text-s112-ok-fg">{mandant ? `${mandant} ist` : 'Der Mandant ist'} vollständig eingerichtet!</p>
          <p className="text-sm text-s112-ok-fg mt-1">Alle Pflichtschritte erledigt. software:112 ist bereit für den Produktivbetrieb.</p>
        </div>
      )}
    </div>
  )
}
