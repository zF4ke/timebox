param(
    [switch]$SkipBuild,
    [string]$OutputDir = "delivery"
)

$ErrorActionPreference = "Stop"

$Root = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
if ([System.IO.Path]::IsPathRooted($OutputDir) -or $OutputDir.Contains("..")) {
    throw "OutputDir must be a relative path inside the project."
}

$DeliveryDir = Join-Path $Root $OutputDir
$StageDir = Join-Path $DeliveryDir "Timebox-Group45"
$ZipPath = Join-Path $DeliveryDir "Timebox-Group45-delivery.zip"

if (-not $SkipBuild) {
    Push-Location $Root
    try {
        npm run dist
    }
    finally {
        Pop-Location
    }
}

$ExePath = Join-Path $Root "release\Timebox 0.1.0.exe"
if (-not (Test-Path -LiteralPath $ExePath)) {
    throw "Executable not found at '$ExePath'. Run 'npm run dist' or rerun this script without -SkipBuild."
}

New-Item -ItemType Directory -Force -Path $DeliveryDir | Out-Null
$ResolvedDeliveryDir = (Resolve-Path $DeliveryDir).Path

if (Test-Path -LiteralPath $StageDir) {
    $ResolvedStageDir = (Resolve-Path $StageDir).Path
    if (-not $ResolvedStageDir.StartsWith($ResolvedDeliveryDir, [System.StringComparison]::OrdinalIgnoreCase)) {
        throw "Refusing to delete staging directory outside delivery folder: $ResolvedStageDir"
    }
    Remove-Item -LiteralPath $ResolvedStageDir -Recurse -Force
}
$TempZipPath = Join-Path ([System.IO.Path]::GetTempPath()) ("Timebox-Group45-delivery-{0}.zip" -f ([System.Guid]::NewGuid().ToString("N")))
if (Test-Path -LiteralPath $ZipPath) {
    Remove-Item -LiteralPath $ZipPath -Force
}

New-Item -ItemType Directory -Force -Path $StageDir | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $StageDir "executable") | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $StageDir "source") | Out-Null

$SourceRoot = Join-Path $StageDir "source"
$SourceItems = @(
    "assets",
    "benchmarks",
    "prompts",
    "src",
    "tests",
    "index.html",
    "package-lock.json",
    "package.json",
    "README.md",
    "tsconfig.electron.json",
    "tsconfig.json",
    "tsconfig.renderer.json",
    "vite.config.ts",
    "vitest.config.ts"
)

foreach ($Item in $SourceItems) {
    $From = Join-Path $Root $Item
    if (Test-Path -LiteralPath $From) {
        Copy-Item -LiteralPath $From -Destination $SourceRoot -Recurse -Force
    }
}

Copy-Item -LiteralPath $ExePath -Destination (Join-Path $StageDir "executable") -Force

Compress-Archive -Path (Join-Path $StageDir "*") -DestinationPath $TempZipPath -Force
Move-Item -LiteralPath $TempZipPath -Destination $ZipPath -Force

Write-Host "Delivery zip written to: $ZipPath"
