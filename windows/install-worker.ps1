<#
Makes this Windows machine a splates worker: the Linux worker, unchanged,
in a WSL2 distro of its own, joined to a coordinator and started at each
boot, whether or not anyone is signed in.

`splates worker add` and the Workers page hand out the line that runs it,
with a fresh join token; run that in PowerShell as an administrator:

  & ([scriptblock]::Create((irm <this file at the coordinator's release>))) -Coordinator <url> -Join <token> -Version <release>

Run again with a new token to join again or update; it keeps the distro.
It holds no credentials itself: the worker's key goes into a file in the
distro only its user may read (`splates worker join --key-file`).
#>
param(
	# The coordinator's `splates server` URL.
	[Parameter(Mandatory = $true)][string]$Coordinator,
	# A join token from `splates worker add` there, good for 15 minutes.
	[Parameter(Mandatory = $true)][string]$Join,
	# The release of splates to install, the coordinator's own.
	[Parameter(Mandatory = $true)][string]$Version,
	# What the coordinator knows this worker by.
	[string]$Id = $env:COMPUTERNAME.ToLower(),
	# How many agents it runs at once; 0 for what WSL2 has.
	[int]$Slots = 0,
	# How many test runs and the like it runs at once; 0 for one each 8 cores.
	[int]$HeavyJobs = 0,
	# Memory WSL2 may take, in GB; 0 for all but 6 GB, left to Windows.
	[int]$MemoryGB = 0
)

$ErrorActionPreference = 'Stop'
# Invoke-WebRequest crawls while it draws its progress bar.
$ProgressPreference = 'SilentlyContinue'
# wsl.exe writes UTF-16 to a pipe unless told otherwise.
$env:WSL_UTF8 = '1'

$Distro = 'splates'
$User = 'splates'
$Task = 'splates worker'
$Rootfs = 'https://cloud-images.ubuntu.com/wsl/releases/24.04/current'

function Say([string]$what) { Write-Host "splates: $what" }

# Runs `wsl.exe` with $arguments, failing on a nonzero exit.
function Wsl([string[]]$arguments) {
	& wsl.exe @arguments
	if ($LASTEXITCODE -ne 0) { throw "wsl.exe $($arguments -join ' ') exited $LASTEXITCODE" }
}

# Runs shell script $script in the distro as $as, passed as base64 so no
# quoting or line ending of Windows' reaches sh.
function InDistro([string]$as, [string]$script) {
	$encoded = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($script.Replace("`r`n", "`n")))
	Wsl @('-d', $Distro, '-u', $as, '--cd', '/', '--', 'sh', '-c', "echo $encoded | base64 -d | sh")
}

$principal = [Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
	throw 'Run this in PowerShell as an administrator: it turns WSL on and adds a task that starts at boot.'
}

# 1. WSL2 itself. Turning it on for the first time takes a restart.
& wsl.exe --status *> $null
if ($LASTEXITCODE -ne 0) {
	Say 'turning WSL on'
	& wsl.exe --install --no-distribution
	Write-Host ''
	Write-Host 'Restart Windows, make a new join token with `splates worker add`, and run this again.'
	return
}
& wsl.exe --update *> $null
# Run again, the worker it started before stops while this updates it.
Get-ScheduledTask -TaskName $Task -ErrorAction SilentlyContinue | Stop-ScheduledTask

# 2. How much of the machine WSL2 may take: by default half its memory.
$cores = (Get-CimInstance Win32_Processor | Measure-Object -Property NumberOfCores -Sum).Sum
$totalGB = [Math]::Floor((Get-CimInstance Win32_ComputerSystem).TotalPhysicalMemory / 1GB)
if ($MemoryGB -le 0) { $MemoryGB = [Math]::Max(4, $totalGB - 6) }
if ($HeavyJobs -le 0) { $HeavyJobs = [Math]::Max(1, [Math]::Floor($cores / 8)) }
$wslconfig = Join-Path $env:USERPROFILE '.wslconfig'
$config = if (Test-Path $wslconfig) { Get-Content -Raw $wslconfig } else { '' }
if ($config -notmatch '(?m)^\s*memory\s*=') {
	if ($config -match '(?m)^\[wsl2\]\s*$') {
		$config = $config -replace '(?m)^\[wsl2\]\s*$', "[wsl2]`r`nmemory=${MemoryGB}GB"
	} else {
		$config = $config.TrimEnd() + "`r`n[wsl2]`r`nmemory=${MemoryGB}GB`r`n"
	}
	Set-Content -Path $wslconfig -Value $config.TrimStart() -Encoding ASCII
	Say "gave WSL2 ${MemoryGB} GB in $wslconfig; restarting WSL to take it, which stops any distro running"
	& wsl.exe --shutdown
} else {
	Say "keeping the memory $wslconfig gives WSL2"
}

# 3. A distro of its own, so nothing of the user's own WSL changes.
$distros = (& wsl.exe --list --quiet) -split "`r?`n" | ForEach-Object { $_.Trim() }
if ($distros -contains $Distro) {
	& wsl.exe --terminate $Distro *> $null
} else {
	$arch = if ($env:PROCESSOR_ARCHITECTURE -eq 'ARM64') { 'arm64' } else { 'amd64' }
	$file = "ubuntu-noble-wsl-$arch-wsl.rootfs.tar.gz"
	$tar = Join-Path $env:TEMP $file
	Say "downloading Ubuntu 24.04 for WSL"
	Invoke-WebRequest -UseBasicParsing -Uri "$Rootfs/$file" -OutFile $tar
	$sums = (Invoke-WebRequest -UseBasicParsing -Uri "$Rootfs/SHA256SUMS").Content
	$want = ($sums -split "`n" | Where-Object { $_ -match "\s\*?$([regex]::Escape($file))$" } | Select-Object -First 1) -replace '\s.*$', ''
	$got = (Get-FileHash -Algorithm SHA256 $tar).Hash.ToLower()
	if (-not $want -or $got -ne $want.ToLower()) { throw "$file does not match Ubuntu's SHA256SUMS" }
	$home_ = Join-Path $env:LOCALAPPDATA 'splates\wsl'
	New-Item -ItemType Directory -Force -Path $home_ | Out-Null
	Say "making the WSL2 distro $Distro in $home_"
	Wsl @('--import', $Distro, $home_, $tar, '--version', '2')
	Remove-Item $tar
}

# 4. What the worker needs, by the recipe a provisioned worker's snapshot
# is built from (`splates worker recipe`), which this release prints.
Say "installing splates $Version and what it needs in $Distro"
InDistro 'root' @"
set -eu
export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y --no-install-recommends ca-certificates curl git unzip procps iproute2
id $User >/dev/null 2>&1 || useradd --create-home --shell /bin/bash $User
printf '[user]\ndefault=$User\n' >/etc/wsl.conf
su - $User -c 'curl -fsSL https://bun.sh/install | bash'
su - $User -c '`$HOME/.bun/bin/bun add -g @stringsync/splates@$Version'
su - $User -c 'PATH=`$HOME/.bun/bin:`$PATH splates worker recipe' >/tmp/splates-recipe.sh
sh /tmp/splates-recipe.sh
rm /tmp/splates-recipe.sh
su - $User -c 'git config --global user.name splates && git config --global user.email splates@$Id'
"@

# 5. Join, keeping the key in the distro, then the script the task runs.
Say "joining $Coordinator as $Id"
$slotsFlag = if ($Slots -gt 0) { " --slots $Slots" } else { '' }
InDistro $User @"
set -eu
export HOME=/home/$User PATH=/home/$User/.bun/bin:`$PATH
splates worker join --coordinator '$Coordinator' --join '$Join' --id '$Id' --key-file
mkdir -p `$HOME/.splates
cat >`$HOME/.splates/run-worker.sh <<'EOF'
#!/bin/sh
# What the scheduled task "$Task" runs at boot, made by install-worker.ps1.
export HOME=/home/$User PATH="/home/$User/.bun/bin:`$PATH"
export SPLATES_HEAVY_JOBS=$HeavyJobs
exec splates worker run --coordinator '$Coordinator' --id '$Id' --key-file$slotsFlag
EOF
chmod +x `$HOME/.splates/run-worker.sh
"@

# 6. Start it at boot with no one signed in, and again whenever it dies.
# S4U runs it as this user without keeping their password; WSL's distros
# are each user's own, so it must be this user.
$me = "$env:USERDOMAIN\$env:USERNAME"
$action = New-ScheduledTaskAction -Execute 'wsl.exe' -Argument "-d $Distro -u $User --cd ~ -- /home/$User/.splates/run-worker.sh"
$trigger = New-ScheduledTaskTrigger -AtStartup
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
	-StartWhenAvailable -ExecutionTimeLimit ([TimeSpan]::Zero) `
	-RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) -MultipleInstances IgnoreNew
$runAs = New-ScheduledTaskPrincipal -UserId $me -LogonType S4U -RunLevel Limited
Register-ScheduledTask -TaskName $Task -Action $action -Trigger $trigger -Settings $settings `
	-Principal $runAs -Description "Runs the splates worker in WSL2 for $Coordinator." -Force | Out-Null
Start-ScheduledTask -TaskName $Task

# 7. Let a magic packet wake it, so the coordinator wakes it when agents
# queue, on the adapter the worker says waking it takes (the one with a
# default gateway). The BIOS must allow it too, which no script can set.
$nic = (Get-NetIPConfiguration | Where-Object { $_.IPv4DefaultGateway -ne $null -and $_.NetAdapter.Status -eq 'Up' } | Select-Object -First 1).NetAdapter
if ($nic) {
	try {
		Set-NetAdapterPowerManagement -Name $nic.Name -WakeOnMagicPacket Enabled -ErrorAction Stop
		powercfg /deviceenablewake "$($nic.InterfaceDescription)" | Out-Null
		Say "Wake-on-LAN is on for $($nic.Name); turn it on in the BIOS too, if it is not"
	} catch {
		Write-Warning "could not turn Wake-on-LAN on for $($nic.Name): $_. Turn it on in Device Manager, or this PC stays asleep when agents queue"
	}
}

Say "done: $Id runs as the task `"$Task`", at each boot, and shows in ``splates worker list``."
Say 'Windows stays awake while it runs an agent; idle, its own power plan decides, and splates wakes it over the network when agents queue.'
