$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Speech
$projectRoot = Split-Path -Parent $PSScriptRoot
$audioDirectory = Join-Path $projectRoot 'public/demo'
[System.IO.Directory]::CreateDirectory($audioDirectory) | Out-Null
$dialogue = @(
    @{ speaker = '小林'; rate = 0; text = '今天我们评审订单服务的超时处理方案。目标是减少网络波动时用户下单失败的情况。' },
    @{ speaker = '阿周'; rate = 1; text = '我建议客户端收到超时后，自动重试创建订单请求，最多重试三次，间隔一秒。' },
    @{ speaker = '小林'; rate = 0; text = '这样用户不用手动点第二次，看起来体验会更好。我们可以先按这个方案推进。' },
    @{ speaker = '阿周'; rate = 1; text = '还有一个问题。请求可能已经创建了订单，只是客户端没有收到响应。我们需要确认这个接口的行为。' }
)
$synth = New-Object System.Speech.Synthesis.SpeechSynthesizer
$synth.SelectVoice('Microsoft Huihui Desktop')
$format = New-Object System.Speech.AudioFormat.SpeechAudioFormatInfo(16000, [System.Speech.AudioFormat.AudioBitsPerSample]::Sixteen, [System.Speech.AudioFormat.AudioChannel]::Mono)
$segments = @()
$chunks = New-Object 'System.Collections.Generic.List[byte[]]'
$offset = 0.0
$index = 0
try {
    foreach ($line in $dialogue) {
        $memory = New-Object System.IO.MemoryStream
        $synth.SetOutputToWaveStream($memory)
        $synth.Rate = $line.rate
        $synth.Speak($line.text)
        $synth.SetOutputToNull()
        $wave = $memory.ToArray()
        $memory.Dispose()
        $readOffset = 12
        $raw = $null
        while ($readOffset + 8 -le $wave.Length) {
            $chunkName = [System.Text.Encoding]::ASCII.GetString($wave, $readOffset, 4)
            $chunkLength = [BitConverter]::ToInt32($wave, $readOffset + 4)
            if ($chunkName -eq 'fmt ') {
                $inputRate = [BitConverter]::ToInt32($wave, $readOffset + 12)
                $inputBits = [BitConverter]::ToInt16($wave, $readOffset + 22)
                $inputChannels = [BitConverter]::ToInt16($wave, $readOffset + 10)
            }
            if ($chunkName -eq 'data') {
                $raw = New-Object byte[] $chunkLength
                [Array]::Copy($wave, $readOffset + 8, $raw, 0, $chunkLength)
                break
            }
            $readOffset += 8 + $chunkLength + ($chunkLength % 2)
        }
        if ($null -eq $raw) { throw 'Synthesized audio has no PCM data.' }
        if ($inputBits -ne 16 -or $inputChannels -ne 1) { throw 'Expected mono 16-bit synthesized audio.' }
        $sampleCount = [int]($raw.Length / 2)
        $outCount = [int][Math]::Floor($sampleCount * 16000.0 / $inputRate)
        $resampled = New-Object byte[] ($outCount * 2)
        for ($i = 0; $i -lt $outCount; $i++) {
            $sourceIndex = [int][Math]::Floor($i * $inputRate / 16000.0)
            $resampled[$i * 2] = $raw[$sourceIndex * 2]
            $resampled[$i * 2 + 1] = $raw[$sourceIndex * 2 + 1]
        }
        $seconds = $resampled.Length / 32000.0
        $segments += @{ id = [string]$index; speaker = $line.speaker; text = $line.text; start = [Math]::Round($offset, 3); end = [Math]::Round($offset + $seconds, 3); source = 'sample' }
        $chunks.Add($resampled)
        $silence = New-Object byte[] 16000
        $chunks.Add($silence)
        $offset += $seconds + 0.5
        $index++
    }
    $target = Join-Path $audioDirectory 'meeting.wav'
    $output = [System.IO.File]::Create($target)
    $writer = New-Object System.IO.BinaryWriter($output)
    $bytesTotal = ($chunks | ForEach-Object { $_.Length } | Measure-Object -Sum).Sum
    $writer.Write([System.Text.Encoding]::ASCII.GetBytes('RIFF'))
    $writer.Write([int]($bytesTotal + 36))
    $writer.Write([System.Text.Encoding]::ASCII.GetBytes('WAVEfmt '))
    $writer.Write([int]16); $writer.Write([int16]1); $writer.Write([int16]1)
    $writer.Write([int]16000); $writer.Write([int]32000); $writer.Write([int16]2); $writer.Write([int16]16)
    $writer.Write([System.Text.Encoding]::ASCII.GetBytes('data')); $writer.Write([int]$bytesTotal)
    foreach ($chunk in $chunks) { $writer.Write($chunk) }
    $writer.Dispose()
    $manifest = @{ duration = [Math]::Round($offset, 3); audio = '/demo/meeting.wav'; segments = $segments } | ConvertTo-Json -Depth 5
    [System.IO.File]::WriteAllText((Join-Path $audioDirectory 'meeting.json'), $manifest, (New-Object System.Text.UTF8Encoding($false)))
    Write-Output "Generated $target ($([Math]::Round($offset, 1)) seconds)"
} finally {
    $synth.Dispose()
}
