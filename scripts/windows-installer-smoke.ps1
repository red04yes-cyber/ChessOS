$ErrorActionPreference = "Stop"

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$tauriConfigPath = Join-Path $repoRoot "src-tauri\tauri.conf.json"
$nsisDir = Join-Path $repoRoot "src-tauri\target\release\bundle\nsis"
$installDir = Join-Path $env:LOCALAPPDATA "ChessOS-Smoke"
$baselineInstallerBackup = Join-Path $env:RUNNER_TEMP "ChessOS-baseline-installer.exe"
$pythonScript = Join-Path $env:RUNNER_TEMP "chessos-sqlite-smoke.py"
$originalConfigText = Get-Content -Path $tauriConfigPath -Raw
$originalConfig = $originalConfigText | ConvertFrom-Json
$originalVersion = [string]$originalConfig.version
$versionParts = $originalVersion.Split(".")
if ($versionParts.Count -ne 3 -or $versionParts[2] -notmatch "^\d+$") {
    throw "Versione Tauri non semver a tre componenti: $originalVersion"
}
$upgradeVersion = "$($versionParts[0]).$($versionParts[1]).$([int]$versionParts[2] + 1)"
$baselineInstallerName = $null
$appProcess = $null

function Invoke-NsisInstall([string]$InstallerPath) {
    if (-not (Test-Path -LiteralPath $InstallerPath)) {
        throw "Installer non trovato: $InstallerPath"
    }
    $process = Start-Process -FilePath $InstallerPath -ArgumentList @("/S", "/D=$installDir") -Wait -PassThru
    if ($process.ExitCode -ne 0) {
        throw "Installazione NSIS fallita con exit code $($process.ExitCode)."
    }
}

function Get-ChessOsExecutable {
    $executables = @(Get-ChildItem -Path $installDir -Filter "*.exe" -File -ErrorAction SilentlyContinue |
        Where-Object { $_.Name -notmatch "uninstall|unins" })
    if ($executables.Count -eq 0) {
        throw "Eseguibile Chess OS non trovato in $installDir."
    }
    return $executables[0].FullName
}

function Find-ChessOsDatabase {
    $expected = Join-Path $env:APPDATA "com.red04yes.chessos\chess-os.sqlite3"
    if (Test-Path -LiteralPath $expected) {
        return $expected
    }
    $found = Get-ChildItem -Path @($env:APPDATA, $env:LOCALAPPDATA) -Filter "chess-os.sqlite3" -File -Recurse -ErrorAction SilentlyContinue |
        Select-Object -First 1
    if ($found) {
        return $found.FullName
    }
    return $null
}

function Start-ChessOsAndWaitForDatabase {
    param([string]$ExecutablePath)
    $script:appProcess = Start-Process -FilePath $ExecutablePath -WorkingDirectory $installDir -PassThru
    $deadline = (Get-Date).AddSeconds(45)
    $database = $null
    while ((Get-Date) -lt $deadline) {
        $database = Find-ChessOsDatabase
        if ($database) { break }
        if ($script:appProcess.HasExited) {
            throw "Chess OS si è chiusa durante l'avvio (exit code $($script:appProcess.ExitCode))."
        }
        Start-Sleep -Seconds 1
    }
    if (-not $database) {
        throw "SQLite non è stato creato entro 45 secondi dall'avvio dell'app."
    }
    Start-Sleep -Seconds 3
    if ($script:appProcess.HasExited) {
        throw "Chess OS è terminata subito dopo aver inizializzato SQLite."
    }
    Stop-Process -Id $script:appProcess.Id -Force
    Wait-Process -Id $script:appProcess.Id -Timeout 15 -ErrorAction SilentlyContinue
    $script:appProcess = $null
    return $database
}

function Invoke-SqliteSentinel([string]$DatabasePath, [string]$Mode) {
    $code = @'
import sqlite3
import sys

path, mode = sys.argv[1], sys.argv[2]
key = "installer-upgrade-smoke"
expected = "created-by-0.1.0"
with sqlite3.connect(path, timeout=10) as db:
    columns = db.execute(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='app_settings'"
    ).fetchone()
    if not columns:
        raise SystemExit("La tabella app_settings non esiste nel database avviato dall'app.")
    if mode == "seed":
        db.execute(
            "INSERT INTO app_settings(key, value, updated_at) VALUES (?, ?, ?) "
            "ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at",
            (key, expected, "ci-installer-smoke")
        )
        db.commit()
    else:
        row = db.execute("SELECT value FROM app_settings WHERE key=?", (key,)).fetchone()
        if not row or row[0] != expected:
            raise SystemExit("Il dato SQLite sentinella non è sopravvissuto all'aggiornamento/disinstallazione.")
print("SQLite sentinel " + mode + " OK")
'@
    [System.IO.File]::WriteAllText($pythonScript, $code, [System.Text.UTF8Encoding]::new($false))
    & python $pythonScript $DatabasePath $Mode
    if ($LASTEXITCODE -ne 0) {
        throw "Verifica SQLite sentinella fallita (python exit code $LASTEXITCODE)."
    }
}

try {
    Write-Host "== Build installer baseline $originalVersion =="
    Push-Location $repoRoot
    try {
        npm.cmd run tauri:build
        if ($LASTEXITCODE -ne 0) { throw "Build baseline NSIS fallita." }
    } finally {
        Pop-Location
    }

    $baselineInstaller = Get-ChildItem -Path $nsisDir -Filter "*.exe" -File |
        Sort-Object LastWriteTimeUtc -Descending |
        Select-Object -First 1
    if (-not $baselineInstaller) {
        throw "La build baseline non ha prodotto un installer NSIS."
    }
    Copy-Item -LiteralPath $baselineInstaller.FullName -Destination $baselineInstallerBackup -Force
    $baselineInstallerName = $baselineInstaller.Name

    if (Test-Path -LiteralPath $installDir) {
        Remove-Item -LiteralPath $installDir -Recurse -Force
    }
    $existingDatabase = Find-ChessOsDatabase
    if ($existingDatabase) {
        Remove-Item -LiteralPath (Split-Path -Parent $existingDatabase) -Recurse -Force
    }

    Write-Host "== Install baseline $originalVersion on clean Windows runner =="
    Invoke-NsisInstall $baselineInstallerBackup
    $appExecutable = Get-ChessOsExecutable
    $databasePath = Start-ChessOsAndWaitForDatabase $appExecutable
    Write-Host "SQLite created at: $databasePath"
    Invoke-SqliteSentinel $databasePath "seed"

    Write-Host "== Build upgrade candidate $upgradeVersion =="
    $originalConfig.version = $upgradeVersion
    $candidateConfig = $originalConfig | ConvertTo-Json -Depth 50
    $candidateVersion = [string](($candidateConfig | ConvertFrom-Json).version)
    if ($candidateVersion -ne $upgradeVersion) {
        throw "Impossibile impostare la versione candidata $upgradeVersion in tauri.conf.json."
    }
    [System.IO.File]::WriteAllText($tauriConfigPath, $candidateConfig, [System.Text.UTF8Encoding]::new($false))

    Get-ChildItem -Path $nsisDir -Filter "*.exe" -File -ErrorAction SilentlyContinue |
        Remove-Item -Force
    Push-Location $repoRoot
    try {
        npm.cmd run tauri:build
        if ($LASTEXITCODE -ne 0) { throw "Build upgrade NSIS $upgradeVersion fallita." }
    } finally {
        Pop-Location
    }

    $upgradeInstaller = Get-ChildItem -Path $nsisDir -Filter "*.exe" -File |
        Sort-Object LastWriteTimeUtc -Descending |
        Select-Object -First 1
    if (-not $upgradeInstaller) {
        throw "La build upgrade non ha prodotto un installer NSIS."
    }

    Write-Host "== Upgrade install $originalVersion -> $upgradeVersion =="
    Invoke-NsisInstall $upgradeInstaller.FullName
    $appExecutable = Get-ChessOsExecutable
    $productVersion = (Get-Item -LiteralPath $appExecutable).VersionInfo.ProductVersion
    if ($productVersion -and -not $productVersion.StartsWith($upgradeVersion)) {
        throw "Versione file installata inattesa: '$productVersion', attesa '$upgradeVersion'."
    }
    $databaseAfterUpgrade = Start-ChessOsAndWaitForDatabase $appExecutable
    if ($databaseAfterUpgrade -ne $databasePath) {
        throw "Il percorso SQLite è cambiato durante l'aggiornamento: $databasePath -> $databaseAfterUpgrade."
    }
    Invoke-SqliteSentinel $databaseAfterUpgrade "verify"

    Write-Host "== Uninstall upgrade candidate =="
    $installedExecutable = Get-ChessOsExecutable
    $uninstaller = Get-ChildItem -Path $installDir -Filter "*.exe" -File -Recurse |
        Where-Object { $_.Name -match "uninstall|unins" } |
        Select-Object -First 1
    if (-not $uninstaller) {
        throw "Uninstaller NSIS non trovato in $installDir."
    }
    $uninstall = Start-Process -FilePath $uninstaller.FullName -ArgumentList @("/S", "_?=$installDir") -Wait -PassThru
    if ($uninstall.ExitCode -ne 0) {
        throw "Disinstallazione NSIS fallita con exit code $($uninstall.ExitCode)."
    }
    if (Test-Path -LiteralPath $installedExecutable) {
        throw "L'eseguibile è ancora presente dopo la disinstallazione."
    }
    if (-not (Test-Path -LiteralPath $databasePath)) {
        throw "La disinstallazione ha eliminato il database utente."
    }
    Invoke-SqliteSentinel $databasePath "verify"

    Write-Host "PASS: installazione, avvio, upgrade $originalVersion->$upgradeVersion, persistenza SQLite e disinstallazione."
}
finally {
    if ($appProcess -and -not $appProcess.HasExited) {
        Stop-Process -Id $appProcess.Id -Force -ErrorAction SilentlyContinue
    }
    [System.IO.File]::WriteAllText($tauriConfigPath, $originalConfigText, [System.Text.UTF8Encoding]::new($false))
    if ((Test-Path -LiteralPath $baselineInstallerBackup) -and $baselineInstallerName) {
        if (-not (Test-Path -LiteralPath $nsisDir)) {
            New-Item -Path $nsisDir -ItemType Directory -Force | Out-Null
        }
        Get-ChildItem -Path $nsisDir -Filter "*.exe" -File -ErrorAction SilentlyContinue |
            Remove-Item -Force
        Copy-Item -LiteralPath $baselineInstallerBackup -Destination (Join-Path $nsisDir $baselineInstallerName) -Force
    }
    if (Test-Path -LiteralPath $installDir) {
        Remove-Item -LiteralPath $installDir -Recurse -Force -ErrorAction SilentlyContinue
    }
    Remove-Item -LiteralPath $pythonScript -Force -ErrorAction SilentlyContinue
}
