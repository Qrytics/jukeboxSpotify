# Windows bridge: long-running Windows PowerShell 5.1 process.
# Reads Spotify's now-playing state from the Windows media session (the same source as the volume
# flyout) and prints one JSON line per half second. Reads commands (toggle | next | prev) from stdin.
# Exits when stdin closes, i.e. when Jukebox quits.
#
# Each pass of the loop is wrapped in try/catch: one failed Windows call used to end the whole script,
# which hid the jukebox and relaunched it every 3 seconds. Now the failure is reported as `error` and the
# loop carries on. Errors that are not caught go to stderr, which Jukebox writes to its log.
$ErrorActionPreference = 'Continue'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
Add-Type -AssemblyName System.Runtime.WindowsRuntime
$null = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager, Windows.Media.Control, ContentType = WindowsRuntime]
$null = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties, Windows.Media.Control, ContentType = WindowsRuntime]

$asTask = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
	$_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1'
})[0]

function Await($op, $type) {
	$t = $asTask.MakeGenericMethod($type).Invoke($null, @($op))
	if (-not $t.Wait(4000)) { throw 'a Windows media call timed out' }
	$t.Result
}

$mgrType = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager]
$propsType = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties]
$mgr = $null

# All sessions whose app id mentions Spotify; the one that is Playing wins, so a second media source or a
# leftover paused session cannot be followed by mistake.
function Get-SpotifySession {
	$all = @($mgr.GetSessions() | Where-Object { $_.SourceAppUserModelId -like '*Spotify*' })
	if ($all.Count -eq 0) { return $null }
	$playing = $all | Where-Object { $_.GetPlaybackInfo().PlaybackStatus.ToString() -eq 'Playing' } | Select-Object -First 1
	if ($playing) { return $playing }
	return $all[0]
}

$cmdTask = [Console]::In.ReadLineAsync()
while ($true) {
	$out = [ordered]@{
		running = $false; status = 'stopped'; title = ''; artist = ''; album = ''; artUrl = $null
		durationMs = 0; positionMs = 0; volume = $null; error = $null
		session = $false; raw = $null  # diagnostics: was a Spotify session found, and what did Windows call its state
	}
	try {
		if ($null -eq $mgr) { $mgr = Await ($mgrType::RequestAsync()) $mgrType }

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

		# Spotify.exe exactly. A leftover updater or crash-reporter process is not the player.
		$out.running = [bool](Get-Process -Name Spotify -ErrorAction SilentlyContinue)
		if ($out.running) {
			$s = Get-SpotifySession
			if ($s) {
				$out.session = $true
				$p = Await ($s.TryGetMediaPropertiesAsync()) $propsType
				$info = $s.GetPlaybackInfo()
				$tl = $s.GetTimelineProperties()
				$out.raw = [string]$info.PlaybackStatus
				if ($p -and $p.Title) {
					$out.title = [string]$p.Title
					$out.artist = [string]$p.Artist
					$out.album = [string]$p.AlbumTitle
					$endMs = [int]$tl.EndTime.TotalMilliseconds
					$posMs = [int]$tl.Position.TotalMilliseconds
					$out.durationMs = $endMs
					$out.positionMs = $posMs
					$status = if ($info.PlaybackStatus.ToString() -eq 'Playing') { 'playing' } else { 'paused' }
					# Windows only snapshots the position when Spotify reports it, so the real position is that
					# snapshot plus the time since. A track that is "playing" yet already past its end by a margin
					# is a stale session (Spotify stopped and Windows never heard), not music.
					if ($status -eq 'playing' -and $endMs -gt 0) {
						$sinceMs = ([DateTimeOffset]::UtcNow - $tl.LastUpdatedTime).TotalMilliseconds
						if ($sinceMs -gt 0 -and ($posMs + $sinceMs) -gt ($endMs + 5000)) { $status = 'paused'; $out.raw = 'Playing(stale)' }
					}
					$out.status = $status
				}
			}
		}
	} catch {
		$out.error = 'unavailable'
		[Console]::Error.WriteLine('bridge: ' + $_.Exception.Message)
		$mgr = $null  # ask Windows for a fresh session manager on the next pass
	}
	[Console]::Out.WriteLine(($out | ConvertTo-Json -Compress))
	[Console]::Out.Flush()
	# Half a second between polls, but wake at once when a command arrives so a button press shows up fast.
	for ($i = 0; $i -lt 20 -and -not $cmdTask.IsCompleted; $i++) { Start-Sleep -Milliseconds 25 }
}
