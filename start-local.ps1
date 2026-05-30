# Quick one-click launcher for testing Stellar Venture locally on Windows
# Run this from PowerShell in the project root:
#   .\start-local.ps1

Write-Host "Starting Stellar Venture local server..." -ForegroundColor Cyan
Write-Host "Open http://localhost:3000 in your browser after it starts." -ForegroundColor Yellow
Write-Host ""
Write-Host "New P4 idle features (persistent dispatches, offline progress, CLAIM/RETURN) are ready to test." -ForegroundColor Green
Write-Host ""

# Use the serve script from package.json (cross-platform, no Python needed)
npm run serve
