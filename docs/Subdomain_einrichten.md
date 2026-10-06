# Betrieb je Tab über Subdomains einschalten (KAN-31)

Stand 06.10.2026. Der Code ist ausgeliefert und **ohne** die Umgebungsvariable `NEXT_PUBLIC_S112_SUBDOMAIN_BASIS` wirkungslos. Die App verhält sich dann exakt wie vorher. Eingeschaltet wird **nach der Zahel-Präsentation** (Entscheidung Jörgen, 06.10.2026).

Ziel: Hauptdomain und Betriebs-Subdomains laufen parallel im selben Browser, jeder Tab mit seinem eigenen Betrieb. Eine einzige Anmeldung (inkl. 2FA) reicht für alle.

## 1. Subdomains je Betrieb festlegen (Plattform-Admin)

`/admin/mandanten/<Betrieb>` → Reiter **Betrieb** → **Subdomain (Betrieb je Tab)**.

Vorschlag Jörgen (06.10.2026): **Weingut Johannes Gebeshuber bleibt auf der Hauptdomain** (keine Subdomain), **Spaetrot Gebeshuber GmbH** bekommt eine eigene Subdomain:

| Betrieb | Subdomain | Adresse |
|---|---|---|
| Weingut Johannes Gebeshuber | – (Hauptdomain) | `software112.icp-consultants.at` |
| Spaetrot Gebeshuber GmbH | `spaetrot` | `spaetrot.software112.icp-consultants.at` |
| Weingut Musterhof (Demo) | optional `musterhof` | |
| Sandbox | optional `sandbox` | |

So verhält sich die Betriebswahl:

- **Auf der Hauptdomain** gilt der Betrieb aus dem Betriebs-Cookie, wie heute.
- **Betrieb mit Subdomain wählen** (z. B. Spaetrot auf der Hauptdomain): Es geht auf die Subdomain, das Cookie der Hauptdomain bleibt unverändert. Ein offener Gebeshuber-Tab zeigt auch nach dem Neuladen Gebeshuber.
- **Betrieb ohne Subdomain wählen**, aus einem Subdomain-Tab: Es geht zurück auf die Hauptdomain, mit diesem Betrieb.

Erlaubt sind Kleinbuchstaben, Ziffern und Bindestrich (2–40 Zeichen). Reserviert sind `www, app, api, admin, auth, login, mail, smtp, staging, static, status, preview`. Gedruckte QR-Codes (KAN-116) enthalten später die Subdomain, deshalb nach dem Einschalten nicht mehr ändern.

## 2. DNS (world4you, Zone icp-consultants.at)

Je Subdomain ein CNAME auf Vercel. Das geht ohne Umzug der Nameserver:

```
spaetrot.software112     CNAME   cname.vercel-dns.com.
```

Optional `musterhof.software112` und `sandbox.software112` ebenso. Ein Wildcard-Eintrag (`*.software112`) ginge bei Vercel nur mit Vercel-Nameservern (NS-Delegation der Zone `software112.icp-consultants.at`). Einzelne CNAMEs sind für die wenigen Betriebe einfacher.

## 3. Vercel (Projekt software112)

- Settings → Domains → je Subdomain hinzufügen (`spaetrot.software112.icp-consultants.at` …). Vercel stellt die Zertifikate selbst aus, sobald der CNAME auflöst.
- Settings → Environment Variables → **Production**: `NEXT_PUBLIC_S112_SUBDOMAIN_BASIS = software112.icp-consultants.at`.
- Danach **Redeploy**: Die Variable ist `NEXT_PUBLIC_…` und wird beim Build eingebaut.

## 4. Supabase Auth (Produktion)

Authentication → URL Configuration → **Redirect URLs** ergänzen:

```
https://*.software112.icp-consultants.at/**
```

Das gilt für Einladung, Passwort-Reset und `/auth/callback`. Die Site URL bleibt die Hauptdomain.

## 5. Was beim Einschalten passiert

- **Anmelde-Cookie:** Es heißt dann `sb-s112-auth` und gilt für die Hauptdomain und alle Subdomains. **Alle Benutzer melden sich einmal neu an**, weil die alten, nur für einen Host gesetzten Cookies ignoriert werden. Am besten Gebeshuber vorher informieren.
- **Betriebs-Cookie:** Es gilt dann ebenfalls für die ganze Basis (neuer Name `s112_aktiver_betrieb`). Jeder wählt seinen Betrieb nach der Neuanmeldung einmal neu.
- **Auf einer Subdomain** gilt nur dieser Betrieb. Wer dort keine aktive Mitgliedschaft hat, landet bei der Betriebswahl auf der Hauptdomain; einen stillen Rückfall in einen anderen Betrieb gibt es nicht.
- **Vercel-Previews** (`*.vercel.app`) bleiben unverändert (keine gemeinsamen Cookies).

## 6. Abnahme

1. In Tab 1 `software112.icp-consultants.at` öffnen, anmelden (inkl. 2FA) und Weingut Johannes Gebeshuber wählen.
2. In Tab 2 `spaetrot.software112.icp-consultants.at` öffnen: Man ist ohne neue Anmeldung angemeldet und sieht Spaetrot.
3. In beiden Tabs gleichzeitig einen Verkauf anlegen. Jeder bekommt die Rechnungsnummer seines Betriebs; Lager und E&A stimmen je Betrieb.
4. Tab 1 neu laden: Er zeigt weiterhin Gebeshuber, und der Betriebs-Wächter sperrt nicht.
5. In Tab 1 über die Betriebswahl Spaetrot wählen → es geht auf `spaetrot.…`. Ein weiterer Tab auf der Hauptdomain zeigt danach weiterhin Gebeshuber.

## Zurück

Umgebungsvariable entfernen und neu deployen. Danach melden sich alle wieder einmal neu an und wählen ihren Betrieb; die Subdomains zeigen dann wie die Hauptdomain den Betrieb aus dem Cookie.
