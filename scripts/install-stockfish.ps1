$ErrorActionPreference = "Stop"

$releaseTag = "sf_19"
$assetName = "stockfish-windows-x86-64-universal.zip"
$assetUrl = "https://github.com/official-stockfish/Stockfish/releases/download/$releaseTag/$assetName"
$expectedSha256 = "3c8bf1f9ea66a09350a40df4f632288285ac206d99f33ab5842c408fc30b48a7"
$repoRoot = Split-Path -Parent $PSScriptRoot
$resourceDir = Join-Path $repoRoot "src-tauri\resources\stockfish"
$tempDir = Join-Path ([System.IO.Path]::GetTempPath()) ("chessos-stockfish-" + [guid]::NewGuid().ToString("N"))
$archivePath = Join-Path $tempDir $assetName
$extractDir = Join-Path $tempDir "extracted"

try {
    New-Item -ItemType Directory -Path $tempDir -Force | Out-Null
    Write-Host "Downloading official Stockfish 19 Windows x64 universal binary..."
    Invoke-WebRequest -Uri $assetUrl -OutFile $archivePath

    $actualSha256 = (Get-FileHash -Path $archivePath -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($actualSha256 -ne $expectedSha256) {
        throw "Stockfish archive SHA-256 mismatch. Expected $expectedSha256, got $actualSha256"
    }

    Expand-Archive -LiteralPath $archivePath -DestinationPath $extractDir -Force
    $executables = @(Get-ChildItem -Path $extractDir -Recurse -File | Where-Object { $_.Extension -ieq ".exe" })
    if ($executables.Count -lt 1) {
        throw "The official Stockfish archive contains no Windows executable."
    }
    $engine = $executables | Sort-Object Length -Descending | Select-Object -First 1
    $networks = @(Get-ChildItem -Path $extractDir -Recurse -File | Where-Object { $_.Extension -ieq ".nnue" })

    if (Test-Path $resourceDir) {
        Remove-Item -Path $resourceDir -Recurse -Force
    }
    New-Item -ItemType Directory -Path $resourceDir -Force | Out-Null
    Copy-Item -LiteralPath $engine.FullName -Destination (Join-Path $resourceDir "stockfish.exe")
    foreach ($network in $networks) {
        Copy-Item -LiteralPath $network.FullName -Destination $resourceDir
    }

    $licenseSource = Join-Path $repoRoot "licenses\stockfish\Copying.txt"
    $authorsSource = Join-Path $repoRoot "licenses\stockfish\AUTHORS"
    if (!(Test-Path $licenseSource) -or !(Test-Path $authorsSource)) {
        throw "Stockfish GPL license or AUTHORS notice is missing from the repository."
    }
    Copy-Item -LiteralPath $licenseSource -Destination (Join-Path $resourceDir "COPYING.txt")
    Copy-Item -LiteralPath $authorsSource -Destination (Join-Path $resourceDir "AUTHORS")

    $notice = @"
Stockfish 19 (official-stockfish/Stockfish, tag $releaseTag)
Windows x86-64 universal release binary.
Original release asset: $assetUrl
SHA-256: $expectedSha256
License: GNU General Public License v3.0 (GPL-3.0-only).
Corresponding source code: https://github.com/official-stockfish/Stockfish/tree/$releaseTag
The source tree and license are also available at https://github.com/official-stockfish/Stockfish/archive/refs/tags/$releaseTag.zip
Stockfish is a separate executable and communicates with Chess OS using the text-based UCI protocol.
"@
    Set-Content -LiteralPath (Join-Path $resourceDir "STOCKFISH-NOTICE.txt") -Value $notice -Encoding UTF8

    Write-Host "Installed Stockfish to $resourceDir"
    Write-Host ("Executable: {0} ({1:N1} MB)" -f (Join-Path $resourceDir "stockfish.exe"), ($engine.Length / 1MB))
    Write-Host ("NNUE networks copied: {0}" -f $networks.Count)
}
finally {
    if (Test-Path $tempDir) {
        Remove-Item -Path $tempDir -Recurse -Force -ErrorAction SilentlyContinue
    }
}
