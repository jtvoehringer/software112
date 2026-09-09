#!/usr/bin/env python3
"""CD-Durchgang: Tailwind-Standardpalette und Alt-Tokens -> hohenstein-Tokens (s112-*)."""
import re, sys, os, json, pathlib

ROOT = pathlib.Path(sys.argv[1])
DRY = '--dry' in sys.argv

NEUTRAL = {'gray', 'slate', 'zinc', 'neutral', 'stone'}
ERR = {'red', 'rose'}
OK = {'green', 'emerald', 'lime'}
WARN = {'amber', 'yellow', 'orange'}
BLUE = {'blue', 'sky', 'indigo'}
DECOR = {'purple', 'violet', 'pink', 'fuchsia', 'teal', 'cyan'}
ALL = NEUTRAL | ERR | OK | WARN | BLUE | DECOR

UTILS = 'text|bg|border|ring|divide|from|to|via|placeholder|fill|stroke|outline|accent|decoration'
PAT = re.compile(r'(?<![\w-])((?:[a-z-]+:)*)(' + UTILS + r')-(' + '|'.join(sorted(ALL)) + r')-(\d{2,3})(/\d{1,3})?(?![\w-])')

def neutral(util, n):
    if util == 'text':
        if n >= 800: return 'text'
        if n == 700: return 'text-1'
        if n >= 500: return 'text-2'
        if n >= 300: return 'tertiary'
        return 'line'          # text-gray-200 u.ä.: helle Schrift auf dunkler Fläche
    if util in ('bg', 'from', 'to', 'via', 'fill'):
        if n <= 50: return 'bg'
        if n == 100: return '[#F2F3F5]'
        if n == 200: return 'line'
        if n == 300: return 'line-str'
        if n == 400: return 'grey'
        if n <= 600: return 'text-2'
        return 'text'
    if util in ('border', 'divide', 'ring', 'outline', 'stroke'):
        if n <= 200: return 'line'
        if n <= 400: return 'line-str'
        if n <= 600: return 'grey'
        return 'text'
    if util == 'placeholder': return 'tertiary'
    if util == 'accent': return 'teal'
    if util == 'decoration': return 'line-str'
    return None

def signal(kind, util, n):
    # kind: ok | warn | err
    if util in ('text', 'fill', 'stroke', 'decoration'):
        return kind if n <= 500 else kind + '-fg'
    if util in ('bg', 'from', 'to', 'via'):
        if n <= 100: return kind + '-bg'
        if n == 200: return kind + '/25'
        return kind
    if util in ('border', 'divide', 'ring', 'outline'):
        if n <= 300: return kind + '/30'
        if n == 400: return kind + '/50'
        return kind
    if util == 'placeholder': return kind
    if util == 'accent': return kind
    return None

def blue(util, n):
    if util in ('text', 'fill', 'stroke', 'decoration'):
        return 'blue-300' if n <= 400 else 'blue-700'
    if util in ('bg', 'from', 'to', 'via'):
        if n <= 50: return 'blue-50'
        if n <= 200: return 'blue-100'
        if n == 300: return 'blue-300'
        return 'teal'
    if util in ('border', 'divide', 'ring', 'outline'):
        if n <= 200: return 'blue-100'
        if n <= 400: return 'blue-300'
        return 'teal'
    if util == 'placeholder': return 'tertiary'
    if util == 'accent': return 'teal'
    return None

def decor(util, n):
    # Kategorische Farbchips -> neutral (CD: Farbe kein Gestaltungsmittel)
    if util in ('text', 'fill', 'stroke', 'decoration'):
        return 'text-1'
    if util in ('bg', 'from', 'to', 'via'):
        if n <= 100: return '[#F2F3F5]'
        if n == 200: return 'line-str'
        return 'grey'
    if util in ('border', 'divide', 'ring', 'outline'):
        return 'line-str' if n <= 300 else 'grey'
    if util == 'placeholder': return 'tertiary'
    if util == 'accent': return 'teal'
    return None

def token_repl(m):
    prefixes, util, color, shade, alpha = m.group(1), m.group(2), m.group(3), int(m.group(4)), m.group(5) or ''
    if color in NEUTRAL: t = neutral(util, shade)
    elif color in ERR: t = signal('err', util, shade)
    elif color in OK: t = signal('ok', util, shade)
    elif color in WARN: t = signal('warn', util, shade)
    elif color in BLUE: t = blue(util, shade)
    else: t = decor(util, shade)
    if t is None: return m.group(0)
    if t.startswith('['):
        return f'{prefixes}{util}-{t}'          # Hex-Wert: kein Alpha-Suffix
    if '/' in t and alpha:                      # doppeltes Alpha vermeiden
        t = t.split('/')[0]
    return f'{prefixes}{util}-s112-{t}{alpha}'

# Alt-Tokens / Gewichte / Radien
SIMPLE = [
    (re.compile(r'(?<![\w-])((?:[a-z-]+:)*)text-s112-teal(?![\w-])'), r'\1text-s112-blue-700'),
    (re.compile(r'(?<![\w-])((?:[a-z-]+:)*)text-s112-navy(?![\w-])'), r'\1text-s112-text'),
    (re.compile(r'(?<![\w-])((?:[a-z-]+:)*)bg-s112-navy(?![\w-])'), r'\1bg-s112-text'),
    (re.compile(r'(?<![\w-])((?:[a-z-]+:)*)border-s112-navy(?![\w-])'), r'\1border-s112-text'),
    (re.compile(r'(?<![\w-])((?:[a-z-]+:)*)font-(?:bold|extrabold|black)(?![\w-])'), r'\1font-semibold'),
    (re.compile(r'(?<![\w-])((?:[a-z-]+:)*)rounded-2xl(?![\w-])'), r'\1rounded-xl'),
    (re.compile(r'(?<![\w-])((?:[a-z-]+:)*)rounded-3xl(?![\w-])'), r'\1rounded-2xl'),
    (re.compile(r'(?<![\w-])((?:[a-z-]+:)*)shadow-md(?![\w-])'), r'\1shadow-sm'),
]

# Feste Hex-Werte (außerhalb Tailwind-Klassen), Groß/Klein egal
HEX = {
    'ef4444': 'C9564E', 'dc2626': '8E3A34', 'f97316': 'D9A441', 'f59e0b': 'D9A441', 'd97706': 'D9A441',
    'ca8a04': 'D9A441', 'b45309': '8A6415', 'ea580c': 'D9A441', '92620a': '8A6415', 'fef3e0': 'FBF3E3',
    '94a3b8': '99999D', '9ca3af': 'A0A3AB', '78716c': '6E717A', '374151': '22252B',
    'e5e7eb': 'EDEEF1', 'eeeeee': 'EDEEF1', 'e5e5e5': 'EDEEF1', 'f2f2f2': 'EDEEF1',
    'f9fafb': 'F7F8FA', 'f9f9f9': 'F7F8FA', 'f5f5f5': 'F7F8FA', 'fafaf9': 'F7F8FA', 'f8f8f3': 'F7F8FA',
    'f1f5f9': 'F7F8FA', 'f8fafc': 'F7F8FA', 'fafcff': 'F7F8FA',
    '35609e': '2F63AC', '0284c7': '2F63AC', '0891b2': '2F63AC', '16a34a': '3E9B79',
    'e0f2fe': 'EEF4FD', 'ecfeff': 'EEF4FD', 'f0fdf4': 'EAF5F0', 'fffbeb': 'FBF3E3', 'fff7ed': 'FBF3E3',
    'fefce8': 'FBF3E3', 'fef2f2': 'FBEEED', 'fdf2f8': 'F2F3F5', 'faf5ff': 'F2F3F5', '9333ea': '5A5D66', 'be185d': '5A5D66',
    'f1f6fd': 'EEF4FD', 'edf3fa': 'EEF4FD', 'eef1f5': 'F2F3F5', 'f4f5f7': 'F2F3F5', 'fbfbfc': 'F7F8FA',
    '98c780': '3E9B79', '98c6dd': '77A6E7', 'f9e54f': 'E9CB86',
}
HEXPAT = re.compile(r'#(' + '|'.join(HEX) + r')\b', re.I)

def process(text):
    new = PAT.sub(token_repl, text)
    for pat, rep in SIMPLE:
        new = pat.sub(rep, new)
    new = HEXPAT.sub(lambda m: '#' + HEX[m.group(1).lower()], new)
    return new

changed = []
stats = {}
for p in ROOT.rglob('*'):
    if p.suffix not in ('.tsx', '.ts') or 'node_modules' in p.parts: continue
    src = p.read_text(encoding='utf-8')
    new = process(src)
    if new != src:
        n = sum(1 for a, b in zip(src.splitlines(), new.splitlines()) if a != b)
        changed.append((str(p.relative_to(ROOT)), n))
        if not DRY: p.write_text(new, encoding='utf-8')
print(f'{len(changed)} Dateien geändert, {sum(n for _, n in changed)} Zeilen')
if DRY:
    for f, n in sorted(changed, key=lambda x: -x[1])[:25]: print(f'{n:5} {f}')
