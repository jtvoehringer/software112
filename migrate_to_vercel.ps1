# -----------------------------------------------------------------
# software:112 - Netlify zu Vercel Migration
# Ausfuehren in PowerShell im Projektordner
# -----------------------------------------------------------------

Set-Location $PSScriptRoot

# 1. netlify.toml aus Git entfernen
git rm --cached netlify.toml 2>$null
Remove-Item -Path "netlify.toml" -Force -ErrorAction SilentlyContinue

# 2. CLAUDE.md + alle anderen Aenderungen stagen
git add -A

# 3. Commit
git commit -m "chore: migrate to Vercel - remove netlify.toml, add CLAUDE.md"

# 4. Push
git push

Write-Host ""
Write-Host "Push fertig. Jetzt auf vercel.com:" -ForegroundColor Green
Write-Host "  1. Add New Project -> GitHub-Repo jtvoehringer/software112 importieren"
Write-Host "  2. Environment Variables eintragen (aus Netlify kopieren):"
Write-Host "     NEXT_PUBLIC_SUPABASE_URL"
Write-Host "     NEXT_PUBLIC_SUPABASE_ANON_KEY"
Write-Host "     SUPABASE_SERVICE_ROLE_KEY"
Write-Host "  3. Deploy starten"
Write-Host "  4. Custom Domain: software112.icp-consultants.at hinzufuegen"
Write-Host "     Vercel zeigt dir dann den genauen CNAME-Wert"
Write-Host ""
Write-Host "  Danach bei World4You DNS aendern:" -ForegroundColor Yellow
Write-Host "  software112  CNAME  cname.vercel-dns.com"
Write-Host "  (exakter Wert steht im Vercel Domain-Setup)"
Write-Host ""
