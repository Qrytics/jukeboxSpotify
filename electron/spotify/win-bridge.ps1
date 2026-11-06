# Windows bridge: long-running Windows PowerShell 5.1 process.
# Reads Spotify's now-playing state from the Windows media session (the same source as the volume
# flyout) and prints one JSON line per half second. Reads commands (toggle | next | prev) from stdin.
# Exits when stdin closes, i.e. when Jukebox quits.
$ErrorActionPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
Add-Type -AssemblyName System.Runtime.WindowsRuntime
$null = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager, Windows.Media.Control, ContentType = WindowsRuntime]
$null = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties, Windows.Media.Control, ContentType = WindowsRuntime]

$asTask = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
	$_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1'
})[0]

function Await($op, $type) {
	$t = $asTask.MakeGenericMethod($type).Invoke($null, @($op))
	[void]$t.Wait(-1)
	$t.Result
}

$mgrType = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager]
$propsType = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties]
$mgr = Await ($mgrType::RequestAsync()) $mgrType

function Get-SpotifySession {
	$mgr.GetSessions() | Where-Object { $_.SourceAppUserModelId -like '*Spotify*' } | Select-Object -First 1
}

$cmdTask = [Console]::In.ReadLineAsync()
while ($true) {
	if ($cmdTask.IsCompleted) {
		$cmd = $cmdTask.Result
		if ($null -eq $cmd) { break }
		$s = Get-SpotifySession
		if ($s) {
			switch ($cmd.Trim()) {
				'toggle' { [void](Await ($s.TryTogglePlayPauseAsync()) ([bool])) }
				'next' { [void](Await ($s.TrySkipNextAsync()) ([bool])) }
				'prev' { [void](Await ($s.TrySkipPreviousAsync()) ([bool])) }
			}
		}
		$cmdTask = [Console]::In.ReadLineAsync()
	}

	$running = [bool](Get-Process -Name Spotify -ErrorAction SilentlyContinue)
	$out = [ordered]@{
		running = $running; status = 'stopped'; title = ''; artist = ''; album = ''; artUrl = $null
		durationMs = 0; positionMs = 0; volume = $null; error = $null
	}
	if ($running) {
		$s = Get-SpotifySession
		if ($s) {
			$p = Await ($s.TryGetMediaPropertiesAsync()) $propsType
			$info = $s.GetPlaybackInfo()
			$tl = $s.GetTimelineProperties()
			if ($p -and $p.Title) {
				$out.title = [string]$p.Title
				$out.artist = [string]$p.Artist
				$out.album = [string]$p.AlbumTitle
				$out.status = if ($info.PlaybackStatus.ToString() -eq 'Playing') { 'playing' } else { 'paused' }
				$out.durationMs = [int]$tl.EndTime.TotalMilliseconds
				$out.positionMs = [int]$tl.Position.TotalMilliseconds
			}
		}
	}
	[Console]::Out.WriteLine(($out | ConvertTo-Json -Compress))
	[Console]::Out.Flush()
	Start-Sleep -Milliseconds 500
}
