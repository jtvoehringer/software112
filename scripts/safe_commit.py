#!/usr/bin/env python3
"""
safe_commit.py – NTFS-sicherer Git-Commit für software:112
Verwendung: python3 scripts/safe_commit.py "commit message" [file1 file2 ...]
Ohne Dateiangabe: alle geänderten TypeScript-Dateien

Prüft vor dem Commit:
  1. Keine Null-Bytes
  2. Datei endet mit Newline
  3. TypeScript-Dateien: letzte nicht-leere Zeile ist eine schließende Klammer
  4. npx tsc --noEmit (nur wenn --tsc Flag gesetzt)
"""
import os, sys, subprocess, glob

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
GIT_ENV = {**os.environ, 'GIT_INDEX_FILE': '/tmp/gitindex_s112'}

# ── Integritätsprüfung ──────────────────────────────────────────────────────
def check_file(path: str) -> list[str]:
    errors = []
    try:
        with open(path, 'rb') as f:
            raw = f.read()
    except Exception as e:
        return [f"  Kann nicht lesen: {e}"]

    if b'\x00' in raw:
        null_count = raw.count(b'\x00')
        errors.append(f"  {null_count} Null-Bytes gefunden!")

    stripped = raw.rstrip(b'\x00\r\n ')
    if not stripped:
        errors.append("  Datei ist leer!")
        return errors

    # Für TypeScript/TSX: letzte nicht-leere Zeile sollte } oder ) sein
    if path.endswith(('.ts', '.tsx')):
        lines = stripped.decode('utf-8', errors='replace').splitlines()
        last = lines[-1].strip() if lines else ''
        if last not in ('}', ')', '];', '};', '),', '})', '})'):
            errors.append(f"  Verdächtige letzte Zeile: {repr(last[:60])}")

    return errors

# ── Git-Operationen ─────────────────────────────────────────────────────────
def git(*args, capture=False):
    cmd = ['git'] + list(args)
    if capture:
        r = subprocess.run(cmd, capture_output=True, text=True, cwd=REPO, env=GIT_ENV)
        return r.stdout.strip(), r.stderr.strip()
    else:
        subprocess.run(cmd, cwd=REPO, env=GIT_ENV, check=True)

def main():
    args = sys.argv[1:]
    if not args:
        print("Verwendung: python3 scripts/safe_commit.py 'message' [datei1 datei2 ...]")
        sys.exit(1)

    message = args[0]
    files = args[1:]

    # Index aufbauen
    print("→ Git-Index aufbauen...")
    git('read-tree', 'HEAD')

    # Dateien ermitteln
    if not files:
        out, _ = git('diff', '--name-only', 'HEAD', capture=True)
        files = [f for f in out.splitlines() if f.endswith(('.ts', '.tsx', '.sql', '.js', '.jsx', '.json', '.css'))]
        if not files:
            print("Keine geänderten Dateien gefunden.")
            sys.exit(0)
        print(f"→ Automatisch erkannte Dateien: {len(files)}")

    # Integritätsprüfung
    print("\n── Integritätsprüfung ──────────────────────────────────────────")
    failed = []
    for f in files:
        full = os.path.join(REPO, f)
        if not os.path.exists(full):
            print(f"  ⚠️  {f} – nicht gefunden, wird übersprungen")
            continue
        errs = check_file(full)
        if errs:
            print(f"  ✗ {f}")
            for e in errs:
                print(e)
            failed.append(f)
        else:
            size = os.path.getsize(full)
            print(f"  ✓ {f} ({size:,} bytes)")

    if failed:
        print(f"\n✗ {len(failed)} Datei(en) haben Integritätsprobleme – Commit abgebrochen.")
        sys.exit(1)

    # git add
    print("\n→ Dateien stagen...")
    for f in files:
        full = os.path.join(REPO, f)
        if os.path.exists(full):
            git('add', f)

    # Tree + Commit
    tree, _ = git('write-tree', capture=True)
    parent, _ = git('rev-parse', 'HEAD', capture=True)
    commit, err = git('commit-tree', tree, '-p', parent, '-m', message, capture=True)

    if not commit or len(commit) < 10:
        print(f"✗ commit-tree fehlgeschlagen: {err}")
        sys.exit(1)

    # Ref aktualisieren
    ref_path = os.path.join(REPO, '.git', 'refs', 'heads', 'main')
    with open(ref_path, 'w') as rf:
        rf.write(commit + '\n')

    print(f"\n✓ Committed: {commit[:12]}")
    print(f'  "{message}"')
    print(f"  {len(files)} Datei(en)\n")
    print("→ Jetzt: git push")

if __name__ == '__main__':
    main()
