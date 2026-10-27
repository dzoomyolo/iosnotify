$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path $PSScriptRoot -Parent
$jdk = Join-Path $repoRoot '.tools\jdk-17'

if (-not (Test-Path (Join-Path $jdk 'bin\java.exe'))) {
  Write-Error @"
JDK 17 не найден в $jdk

Поставьте Temurin/Microsoft OpenJDK 17 или распакуйте portable JDK сюда,
либо задайте JAVA_HOME на свой JDK 17 вручную.
"@
}

$env:JAVA_HOME = $jdk
$env:Path = "$jdk\bin;" + ($env:Path -split ';' | Where-Object { $_ -and $_ -ne "$jdk\bin" }) -join ';'
Write-Host "JAVA_HOME=$env:JAVA_HOME"
& "$jdk\bin\java.exe" -version
