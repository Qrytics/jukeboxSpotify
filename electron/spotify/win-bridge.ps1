# Windows bridge: long-running Windows PowerShell 5.1 process.
# Reads Spotify's now-playing state from the Windows media session (the same source as the volume
# flyout) and prints one JSON line per half second. Reads commands (toggle | next | prev | focus | vol) from stdin.
# (volumes look like `vol 0.5`). Exits when stdin closes, i.e. when Jukebox quits.
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

# Local volume comes from the desktop app's own audio session (Core Audio), so the slider appears
# whenever this laptop can actually turn Spotify up or down. Playing from another device
# (Spotify Connect) leaves no local session, so volume stays null and the slider stays hidden.
# $VolumeOK is false when the helper cannot compile; volume then silently stays null as before.
$VolumeCs = @'
using System;
using System.Runtime.InteropServices;

public static class SpotifyVolume {
    private enum EDataFlow { eRender = 0 }
    private enum ERole { eMultimedia = 1 }

    [ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")]
    private class MMDeviceEnumerator { }

    [ComImport, Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IMMDeviceEnumerator {
        void Unused1();
        void GetDefaultAudioEndpoint(EDataFlow dataFlow, ERole role, out IMMDevice ppDevice);
    }

    [ComImport, Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IMMDevice {
        void Activate([MarshalAs(UnmanagedType.LPStruct)] Guid iid, int dwClsCtx, IntPtr pActivationParams, [MarshalAs(UnmanagedType.IUnknown)] out object ppInterface);
    }

    [ComImport, Guid("77AA99A0-1BD6-484F-8BC7-2C654C9A9B6F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IAudioSessionManager2 {
        void Unused1();
        void Unused2();
        void GetSessionEnumerator(out IAudioSessionEnumerator sessionList);
    }

    [ComImport, Guid("E2F5BB11-0570-40CA-ACDD-3AA01277DEE8"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IAudioSessionEnumerator {
        void GetCount(out int sessionCount);
        void GetSession(int sessionCount, out IAudioSessionControl session);
    }

    [ComImport, Guid("F4B1A599-7266-4319-A8CA-E70ACB11E8CD"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IAudioSessionControl {
    }

    [ComImport, Guid("BFB7FF88-7239-4FC9-8FA2-07C950BE9C6D"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IAudioSessionControl2 {
        void GetState(out int state);
        void GetDisplayName([MarshalAs(UnmanagedType.LPWStr)] out string name);
        void SetDisplayName([MarshalAs(UnmanagedType.LPWStr)] string value, ref Guid eventContext);
        void GetIconPath([MarshalAs(UnmanagedType.LPWStr)] out string path);
        void SetIconPath([MarshalAs(UnmanagedType.LPWStr)] string value, ref Guid eventContext);
        void GetGroupingParam(out Guid grouping);
        void SetGroupingParam(ref Guid groupingOverride, ref Guid eventContext);
        void RegisterAudioSessionNotification([MarshalAs(UnmanagedType.IUnknown)] object notifications);
        void UnregisterAudioSessionNotification([MarshalAs(UnmanagedType.IUnknown)] object notifications);
        void GetSessionIdentifier([MarshalAs(UnmanagedType.LPWStr)] out string id);
        void GetSessionInstanceIdentifier([MarshalAs(UnmanagedType.LPWStr)] out string id);
        void GetProcessId(out int pid);
    }

    [ComImport, Guid("87CE5498-68D6-44E5-9215-6DA47EF883D8"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface ISimpleAudioVolume {
        void SetMasterVolume(float level, ref Guid eventContext);
        void GetMasterVolume(out float level);
        void SetMute(bool mute, ref Guid eventContext);
        void GetMute(out bool mute);
    }

    private static bool FindSession(int[] pids, out ISimpleAudioVolume volume) {
        volume = null;
        ISimpleAudioVolume fallback = null;
        var enumerator = (IMMDeviceEnumerator)new MMDeviceEnumerator();
        IMMDevice device;
        enumerator.GetDefaultAudioEndpoint(EDataFlow.eRender, ERole.eMultimedia, out device);
        object o;
        device.Activate(typeof(IAudioSessionManager2).GUID, 23, IntPtr.Zero, out o);
        var mgr = (IAudioSessionManager2)o;
        IAudioSessionEnumerator list;
        mgr.GetSessionEnumerator(out list);
        int n;
        list.GetCount(out n);
        for (int i = 0; i < n; i++) {
            IAudioSessionControl ctl;
            list.GetSession(i, out ctl);
            var ctl2 = (IAudioSessionControl2)ctl;
            int pid;
            ctl2.GetProcessId(out pid);
            bool match = false;
            for (int k = 0; k < pids.Length; k++) if (pids[k] == pid) { match = true; break; }
            if (!match) continue;
            var v = (ISimpleAudioVolume)ctl;
            int state;
            ctl2.GetState(out state);
            if (state == 1) { volume = v; return true; }
            if (fallback == null && state != 2) fallback = v;
        }
        if (fallback != null) { volume = fallback; return true; }
        return false;
    }

    public static float GetVolume(int[] pids) {
        try {
            ISimpleAudioVolume v;
            if (FindSession(pids, out v)) {
                bool mute;
                v.GetMute(out mute);
                if (mute) return 0f;
                float level;
                v.GetMasterVolume(out level);
                return level;
            }
        } catch { }
        return -1f;
    }

    public static void SetVolume(int[] pids, float level) {
        try {
            ISimpleAudioVolume v;
            if (FindSession(pids, out v)) {
                Guid g = Guid.Empty;
                v.SetMute(false, ref g);
                v.SetMasterVolume(level, ref g);
            }
        } catch { }
    }
}
'@
# Bring Spotify's window to the front. Spotify.exe has several processes; the one with a window is the player.
# Minimized to the tray it has no window at all, so fall back to the spotify: protocol, which Windows hands
# to the running app and which makes it show itself.
$FocusCs = @'
using System;
using System.Runtime.InteropServices;
public static class WinFocus {
    [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int cmd);
    [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
    [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h);
    [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
}
'@
$FocusOK = $false
try { Add-Type -TypeDefinition $FocusCs -Language CSharp; $FocusOK = $true } catch { }

function Focus-Spotify {
	$p = Get-Process -Name Spotify -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1
	if ($p -and $FocusOK) {
		# A toggle: a minimized window is restored and raised; the frontmost window is minimized; a window that is merely behind others is raised, never hidden.
		if ([WinFocus]::IsIconic($p.MainWindowHandle)) {
			[void][WinFocus]::ShowWindow($p.MainWindowHandle, 9)
			[void][WinFocus]::SetForegroundWindow($p.MainWindowHandle)
		} elseif ([WinFocus]::GetForegroundWindow() -eq $p.MainWindowHandle) {
			[void][WinFocus]::ShowWindow($p.MainWindowHandle, 6)
		} else {
			[void][WinFocus]::ShowWindow($p.MainWindowHandle, 9)
			[void][WinFocus]::SetForegroundWindow($p.MainWindowHandle)
		}
	} else {
		Start-Process 'spotify:'
	}
}

$VolumeOK = $false
try {
	Add-Type -TypeDefinition $VolumeCs -Language CSharp
	$VolumeOK = $true
} catch {
	# locked-down machine: carry on without volume
}

# All sessions whose app id mentions Spotify; the one that is Playing wins, so a second media source or a
# leftover paused session cannot be followed by mistake.
function Get-SpotifySession {
	$all = @($mgr.GetSessions() | Where-Object { $_.SourceAppUserModelId -like '*Spotify*' })
	if ($all.Count -eq 0) { return $null }
	$playing = $all | Where-Object { $_.GetPlaybackInfo().PlaybackStatus.ToString() -eq 'Playing' } | Select-Object -First 1
	if ($playing) { return $playing }
	return $all[0]
}

# NB: [Console]::In hangs Windows PowerShell 5.1 here (stdin is a pipe and there is no console
# window), freezing the whole bridge before it prints a single line. A StreamReader over the raw stdin
# handle reads the same lines with the same EOF-on-quit behaviour, without touching [Console]::In.
$stdin = New-Object IO.StreamReader([Console]::OpenStandardInput(), [System.Text.Encoding]::UTF8)
$cmdTask = $stdin.ReadLineAsync()
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
			$cmdText = $cmd.Trim()
			if ($VolumeOK -and $cmdText -match '^vol\s+([0-9]*\.?[0-9]+)$') {
				$want = [Math]::Max(0.0, [Math]::Min(1.0, [float]::Parse($Matches[1], [System.Globalization.CultureInfo]::InvariantCulture)))
				try {
					[SpotifyVolume]::SetVolume($spotifyPids, $want)
					$out.volume = $want
				} catch {
					# keep the last known volume; the next poll refreshes it
				}
			} else {
				$s = Get-SpotifySession
				if ($cmdText -eq 'focus') { try { Focus-Spotify } catch { } } elseif ($s) {
					switch ($cmdText) {
						'toggle' { [void](Await ($s.TryTogglePlayPauseAsync()) ([bool])) }
						'next' { [void](Await ($s.TrySkipNextAsync()) ([bool])) }
						'prev' { [void](Await ($s.TrySkipPreviousAsync()) ([bool])) }
					}
				}
			}
			$cmdTask = $stdin.ReadLineAsync()
		}

		# Spotify.exe exactly. A leftover updater or crash-reporter process is not the player.
		# The pids double as the volume lookup: only the desktop app's own audio session counts.
		[int[]]$spotifyPids = @(Get-Process -Name Spotify -ErrorAction SilentlyContinue | ForEach-Object { $_.Id })
		$out.running = $spotifyPids.Count -gt 0
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
			# Local volume for the slider: the desktop app's own audio session, when it has one.
			# Nothing local to turn up (remote playback, no session yet) leaves volume null.
			if ($VolumeOK) {
				try {
					$level = [SpotifyVolume]::GetVolume($spotifyPids)
					if ($level -ge 0) { $out.volume = [Math]::Max(0.0, [Math]::Min(1.0, $level)) }
				} catch {
					# keep the last reported volume; silence here must not fail the pass
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
