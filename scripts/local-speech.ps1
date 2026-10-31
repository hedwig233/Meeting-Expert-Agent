param([Parameter(Mandatory=$true)][string]$InputPath, [Parameter(Mandatory=$true)][string]$OutputPath)
$ErrorActionPreference = 'Stop'
$taskStage = 'initialize'
$taskFailures = @()
try {
    Add-Type -AssemblyName System.Speech
    $taskSettings = [System.IO.File]::ReadAllText($InputPath, [System.Text.Encoding]::UTF8) | ConvertFrom-Json
    $taskProbe = New-Object System.Speech.Synthesis.SpeechSynthesizer
    try { $taskVoices = @($taskProbe.GetInstalledVoices() | Where-Object { $_.Enabled -and $_.VoiceInfo.Culture.Name.StartsWith('zh') } | ForEach-Object { $_.VoiceInfo.Name }) }
    finally { $taskProbe.Dispose() }
    if (-not $taskVoices.Count) { Write-Output (@{ ok = $false; code = 'NO_CHINESE_VOICE'; stage = 'enumerate' } | ConvertTo-Json -Compress); exit 1 }
    $taskCandidates = @()
    if ($taskSettings.voice) { $taskCandidates += [string]$taskSettings.voice }
    $taskCandidates += @($taskVoices | Where-Object { $_ -like '*Desktop*' })
    $taskCandidates += $taskVoices
    foreach ($taskVoice in @($taskCandidates | Select-Object -Unique)) {
        $taskSynth = New-Object System.Speech.Synthesis.SpeechSynthesizer
        try {
            $taskStage = 'select_voice'; $taskSynth.SelectVoice($taskVoice)
            $taskSynth.Rate = 0
            $taskStage = 'output_file'; $taskSynth.SetOutputToWaveFile($OutputPath)
            $taskStage = 'synthesize'; $taskSynth.Speak([string]$taskSettings.text)
            $taskSynth.SetOutputToNull()
            Write-Output (@{ ok = $true; voice = $taskVoice } | ConvertTo-Json -Compress)
            exit 0
        } catch {
            $taskFailures += @{ voice = $taskVoice; stage = $taskStage; errorType = $_.Exception.GetType().Name }
        } finally { $taskSynth.Dispose() }
    }
    Write-Output (@{ ok = $false; code = 'ALL_VOICES_FAILED'; stage = $taskStage; attempts = $taskFailures } | ConvertTo-Json -Depth 4 -Compress)
    exit 1
} catch {
    Write-Output (@{ ok = $false; code = 'SPEECH_INITIALIZATION_FAILED'; stage = $taskStage; errorType = $_.Exception.GetType().Name } | ConvertTo-Json -Compress)
    exit 1
}
