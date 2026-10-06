# Betrieb je Tab über Subdomains einschalten (KAN-31)

Stand 06.10.2026. Der Code ist ausgeliefert und **ohne** die Umgebungsvariable `NEXT_PUBLIC_S112_SUBDOMAIN_BASIS` wirkungslos. Die App verhält sich dann exakt wie vorher. Eingeschaltet wird **nach der Zahel-Präsentation** (Entscheidung Jörgen, 06.10.2026).

Ziel: `gebeshuber.software112.icp-consultants.at` und `spaetrot.software112.icp-consultants.at` laufen parallel im selben Browser, jeder Tab mit seinem eigenen Betrieb. Eine einzige Anmeldung (inkl. 2FA) reicht für alle. Die Hauptdomain `software112.icp-consultants.at` funktioniert wie bisher (Betrieb aus dem Cookie, Betriebswahl).

## 1. Subdomains je Betrieb festlegen (Plattform-Admin)

`/admin/mandanten/<Betrieb>` → Reiter **Betrieb** → **Subdomain (Betrieb je Tab)**. Vorschlag:

| Betrieb | Subdomain |
|---|---|
| Weingut Johannes Gebeshuber | `gebeshuber` |
| Spaetrot Gebeshuber GmbH | `spaetrot` |
| Weingut Musterhof (Demo) | `musterhof` |
| Sandbox | `sandbox` |

Erlaubt sind Kleinbuchstaben, Ziffern und Bindestrich (2–40 Zeichen). Reserviert sind `www, app, api, admin, auth, login, mail, smtp, staging, static, status, preview`. Gedruckte QR-Codes (KAN-116) enthalten später die Subdomain, deshalb nach dem Einschalten nicht mehr ändern.

## 2. DNS (world4you, Zone icp-consultants.at)

Je Betrieb ein CNAME auf Vercel. Das geht ohne Umzug der Nameserver:

```
gebeshuber.software112   CNAME   cname.vercel-dns.com.
spaetrot.software112     CNAME   cname.vercel-dns.com.
musterhof.software112    CNAME   cname.vercel-dns.com.
sandbox.software112      CNAME   cname.vercel-dns.com.
```

Ein Wildcard-Eintrag (`*.software112`) ginge bei Vercel nur mit Vercel-Nameservern (NS-Delegation der Zone `software112.icp-consultants.at`). Für die wenigen Betriebe sind einzelne CNAMEs einfacher. Für jeden neuen Betrieb kommt ein Eintrag dazu; das lässt sich später über die Vercel-API automatisieren.

## 3. Vercel (Projekt software112)

- Settings → Domains → je Subdomain hinzufügen (`gebeshuber.software112.icp-consultants.at` …). Vercel stellt die Zertifikate selbst aus, sobald der CNAME auflöst.
- Settings → Environment Variables → **Production**: `NEXT_PUBLIC_S112_SUBDOMAIN_BASIS = software112.icp-consultants.at`.
- Danach **Redeploy**: Die Variable ist `NEXT_PUBLIC_…` und wird beim Build eingebaut.

## 4. Supabase Auth (Produktion)

Authentication → URL Configuration → **Redirect URLs** ergänzen:

```
https://*.software112.icp-consultants.at/**
```

Das gilt für Einladung, Passwort-Reset und `/auth/callback`. Die Site URL bleibt die Hauptdomain.

## 5. Was beim Einschalten passiert

- Das Anmelde-Cookie heißt dann `sb-s112-auth` und gilt für die Hauptdomain und alle Subdomains. **Alle Benutzer melden sich einmal neu an**, weil die alten, nur für einen Host gesetzten Cookies ignoriert werden. Am besten Gebeshuber vorher informieren.
- Die Betriebswahl (`/betrieb-waehlen`, Betriebswechsel im Kopf) leitet auf die Subdomain des gewählten Betriebs. Betriebe ohne Subdomain bleiben auf der Hauptdomain.
- Auf einer Subdomain gilt nur dieser Betrieb. Wer dort keine aktive Mitgliedschaft hat, landet bei der Betriebswahl auf der Hauptdomain; einen stillen Rückfall in einen anderen Betrieb gibt es nicht.
- Vercel-Previews (`*.vercel.app`) bleiben unverändert (kein gemeinsames Cookie).

## 6. Abnahme

1. In Tab 1 `gebeshuber.software112.icp-consultants.at` öffnen und anmelden (inkl. 2FA).
2. In Tab 2 `spaetrot.software112.icp-consultants.at` öffnen: Man ist ohne neue Anmeldung angemeldet und sieht Spaetrot.
3. In beiden Tabs gleichzeitig einen Verkauf anlegen. Jeder bekommt die Rechnungsnummer seines Betriebs; Lager und E&A stimmen je Betrieb.
4. Tab 1 neu laden: Er zeigt weiterhin Gebeshuber, und der Betriebs-Wächter sperrt nicht.
5. Die Hauptdomain funktioniert wie bisher.

## Zurück

Umgebungsvariable entfernen und neu deployen. Danach melden sich alle wieder einmal neu an; die Subdomains zeigen dann wie die Hauptdomain den Betrieb aus dem Cookie.
