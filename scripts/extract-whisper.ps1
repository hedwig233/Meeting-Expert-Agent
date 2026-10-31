param([Parameter(Mandatory=$true)][string]$Archive, [Parameter(Mandatory=$true)][string]$Destination)
$ErrorActionPreference = 'Stop'
$taskWorkspace = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../data/whisper'))
$taskTarget = [System.IO.Path]::GetFullPath($Destination)
if (-not $taskTarget.StartsWith($taskWorkspace + [System.IO.Path]::DirectorySeparatorChar, [System.StringComparison]::OrdinalIgnoreCase)) { throw 'Archive destination is outside the Whisper workspace.' }
Expand-Archive -LiteralPath $Archive -DestinationPath $taskTarget -Force
