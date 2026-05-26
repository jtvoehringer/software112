# software:112 - Fix git index.lock and commit all missing files
$ErrorActionPreference = "Stop"
$projectPath = "C:\Users\joerg\Documents\Claude\Projects\ERP Software112"
Set-Location $projectPath

Write-Host "=== software:112 Git Fix ===" -ForegroundColor Cyan

# 1. Remove stale lock file
$lockFile = ".git\index.lock"
if (Test-Path $lockFile) {
    Remove-Item $lockFile -Force
    Write-Host "OK: index.lock removed" -ForegroundColor Green
} else {
    Write-Host "   No index.lock found" -ForegroundColor Gray
}

# 2. Force-add all missing files
Write-Host "Adding files to index..." -ForegroundColor Cyan
git add -f src/app/layout.tsx
git add -f src/app/page.tsx
git add -f src/proxy.ts
git add -f tailwind.config.ts
git add -f tsconfig.json
git add -f src/lib/
git add -f src/components/
git add -f supabase/
git add -f n8n/
git add src/app/
Write-Host "OK: All files staged" -ForegroundColor Green

# 3. Show status
Write-Host ""
Write-Host "Git Status:" -ForegroundColor Cyan
git status --short

# 4. Commit
Write-Host ""
Write-Host "Committing..." -ForegroundColor Cyan
git commit -m "fix: add all missing files - migrations, components, supabase clients, seed"

# 5. Push
Write-Host ""
Write-Host "Pushing to GitHub..." -ForegroundColor Cyan
git push origin main

Write-Host ""
Write-Host "=== DONE! Netlify build starting ===" -ForegroundColor Green
Write-Host "Build status: https://app.netlify.com" -ForegroundColor Yellow
Write-Host ""
pause
