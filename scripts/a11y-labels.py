#!/usr/bin/env python3
"""Barrierefreiheit B1 (23.9.2026): Beschriftungen mit ihren Eingabefeldern verbinden.

Muster im Code:  <label …>Text</label>  gefolgt (als Geschwister) von <input|select|textarea …>
- Hat das Feld eine feste id="…"  → label bekommt htmlFor="…"
- sonst, wenn der Beschriftungstext statisch ist → Feld bekommt aria-label="Text"
Übersprungen: Labels mit htmlFor, Labels, die das Feld selbst umschließen, dynamischer Text,
Felder mit aria-label/aria-labelledby, type="hidden".
Aufruf: python3 scripts/a11y-labels.py [--schreiben]
"""
import re, sys, glob, html

SCHREIBEN = '--schreiben' in sys.argv

def tag_ende(s, i):
    """Index nach dem Ende des Tags, der bei s[i] ('<') beginnt – berücksichtigt {…} und Strings."""
    tiefe = 0; q = None; j = i + 1
    while j < len(s):
        c = s[j]
        if q:
            if c == q and s[j-1] != '\\': q = None
        elif c in '"\'`' and tiefe > 0: q = c
        elif c == '{': tiefe += 1
        elif c == '}': tiefe -= 1
        elif c == '>' and tiefe == 0: return j + 1
        j += 1
    return -1

LABEL = re.compile(r'<label\b')
statistik = {'aria': 0, 'htmlFor': 0, 'dynamisch': 0, 'kein_feld': 0}
dateien = 0

for f in sorted(glob.glob('src/**/*.tsx', recursive=True)):
    s = open(f, encoding='utf-8').read()
    aenderungen = []  # (pos, alt_len, neu)
    for m in LABEL.finditer(s):
        a = m.start(); e = tag_ende(s, a)
        if e < 0: continue
        oeffner = s[a:e]
        if 'htmlFor' in oeffner or oeffner.endswith('/>'): continue
        z = s.find('</label>', e)
        if z < 0: continue
        inhalt = s[e:z]
        if '<label' in inhalt: continue
        # umschließende Labels (Feld im Label) überspringen
        if re.search(r'<(input|select|textarea)\b', inhalt): continue
        rest_start = z + len('</label>')
        # nächstes Geschwister: Leerraum und JSX-Kommentare überspringen
        k = rest_start
        while True:
            m2 = re.match(r'\s*(\{/\*.*?\*/\})?', s[k:], re.S)
            if m2 and m2.end() > 0: k += m2.end()
            if not (m2 and m2.group(1)): break
        feld = re.match(r'<(input|select|textarea)\b', s[k:])
        if not feld:
            statistik['kein_feld'] += 1; continue
        fe = tag_ende(s, k)
        if fe < 0: continue
        ftag = s[k:fe]
        if re.search(r'aria-label(ledby)?=', ftag) or re.search(r'type=["\']hidden["\']', ftag): continue
        idm = re.search(r'\bid="([^"{}]+)"', ftag)
        if idm:
            neu = oeffner.replace('<label', f'<label htmlFor="{idm.group(1)}"', 1)
            aenderungen.append((a, len(oeffner), neu)); statistik['htmlFor'] += 1
            continue
        text = re.sub(r'\s+', ' ', inhalt).strip()
        # einfache Inline-Auszeichnung entfernen (<span>…</span>, <b>…</b>), Symbole weg
        text = re.sub(r'<[^<>{}]+>', '', text).strip()
        if '{' in text or '<' in text or not text:
            statistik['dynamisch'] += 1; continue
        text = html.unescape(text).rstrip(' *:').strip()
        if not text: statistik['dynamisch'] += 1; continue
        wert = text.replace('"', '„') if '"' in text else text
        tagname = feld.group(1)
        neu_ftag = ftag.replace(f'<{tagname}', f'<{tagname} aria-label="{wert}"', 1)
        aenderungen.append((k, len(ftag), neu_ftag)); statistik['aria'] += 1
    if aenderungen:
        dateien += 1
        for pos, laenge, neu in sorted(aenderungen, key=lambda x: -x[0]):
            s = s[:pos] + neu + s[pos + laenge:]
        if SCHREIBEN:
            open(f, 'w', encoding='utf-8').write(s)

print(('GESCHRIEBEN' if SCHREIBEN else 'PROBELAUF'), f'– Dateien: {dateien}', statistik)
