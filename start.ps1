# Stepladder — start the dev server and open the game.
#
# Usage:  .\start.ps1                 pick the first free port from 5199 up
#         .\start.ps1 -Port 5200      use exactly this port, or fail if taken
#         .\start.ps1 -NoOpen         start the server without opening a browser
#
# Ctrl-C stops the server.
#
# If Windows blocks this with an execution-policy error, run it as:
#   powershell -ExecutionPolicy Bypass -File .\start.ps1

param(
    [int]$Port = 0,
    [switch]$NoOpen
)

Set-Location -Path $PSScriptRoot

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    Write-Host "Node.js is not installed, or is not on your PATH." -ForegroundColor Red
    Write-Host "Install v18 or newer from https://nodejs.org and run this again."
    exit 1
}

if (-not (Test-Path 'node_modules')) {
    Write-Host "Installing dependencies (first run only)..."
    npm install
    if ($LASTEXITCODE -ne 0) {
        Write-Host "npm install failed. Fix the errors above and try again." -ForegroundColor Red
        exit 1
    }
}

# An explicit port is a request, so honour it strictly and fail loudly if it is
# taken. With no port given, find a free one — and leave strictPort off so Vite
# can still recover if it gets claimed between the check and the bind.
$explicit = ($Port -gt 0)
if ($explicit) {
    $chosen = $Port
} else {
    $found = (node scripts/find-port.mjs 5199 2>$null)
    if ([string]::IsNullOrWhiteSpace($found)) { $chosen = 5199 } else { $chosen = [int]$found }
}

Write-Host ""
Write-Host "  Stepladder  ->  http://localhost:$chosen"
Write-Host "  Ctrl-C to stop."
Write-Host ""

$viteArgs = @('vite', '--port', $chosen)
if ($explicit) { $viteArgs += '--strictPort' }
if (-not $NoOpen) { $viteArgs += '--open' }

try {
    # Foreground on purpose: Ctrl-C reaches Vite directly, so nothing is left
    # holding the port afterwards.
    npx @viteArgs
    # 130 is a normal Ctrl-C, not a failure.
    if ($LASTEXITCODE -ne 0 -and $LASTEXITCODE -ne 130) {
        Write-Host ""
        Write-Host "Vite exited with code $LASTEXITCODE."
        if ($explicit) {
            Write-Host "Port $chosen may be in use. Run .\start.ps1 with no -Port to pick a free one."
        }
    }
}
finally {
    Write-Host ""
    Write-Host "Server stopped."
}
