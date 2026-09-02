param(
  [Parameter(Mandatory = $true)][string]$SenderSerial,
  [Parameter(Mandatory = $true)][string]$ReceiverSerial,
  [Parameter(Mandatory = $true)][string]$SenderChatName,
  [switch]$IncludeCall
)

$ErrorActionPreference = 'Stop'
$adb = Join-Path $env:ANDROID_HOME 'platform-tools\adb.exe'
if (-not (Test-Path -LiteralPath $adb)) { throw 'ADB was not found under ANDROID_HOME.' }

# Prefer a PATH installation, but also support Maestro's standard per-user
# install location so the harness works in a fresh PowerShell session.
$maestroCommand = (Get-Command maestro -ErrorAction SilentlyContinue).Source
if (-not $maestroCommand) {
  $maestroCandidates = @(
    (Join-Path $env:USERPROFILE '.maestro\maestro\bin\maestro.bat'),
    (Join-Path $env:USERPROFILE '.maestro\bin\maestro.bat')
  )
  $maestroCommand = $maestroCandidates | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
}
if (-not $maestroCommand) { throw 'Maestro is not installed. Install it before running the two-device suite.' }

# Maestro needs Java 17+. Reuse JAVA_HOME when available, otherwise discover
# the JDK already installed by Gradle on this development machine.
if (-not $env:JAVA_HOME) {
  $jdkRoot = Join-Path $env:USERPROFILE '.gradle\jdks'
  $jdk = Get-ChildItem -LiteralPath $jdkRoot -Directory -Filter 'eclipse_adoptium-17-*' -ErrorAction SilentlyContinue |
    Where-Object { Test-Path -LiteralPath (Join-Path $_.FullName 'bin\java.exe') } |
    Select-Object -First 1
  if ($jdk) { $env:JAVA_HOME = $jdk.FullName }
}
$env:MAESTRO_CLI_NO_ANALYTICS = '1'
if (-not $env:MAESTRO_OPTS) { $env:MAESTRO_OPTS = "-Duser.home=$env:USERPROFILE" }

function Invoke-MaestroFlow {
  param([Parameter(Mandatory = $true)][string[]]$Arguments)

  & $maestroCommand @Arguments
  if ($LASTEXITCODE -ne 0) {
    throw "Maestro flow failed with exit code $LASTEXITCODE."
  }
}

$devices = & $adb devices
foreach ($serial in @($SenderSerial, $ReceiverSerial)) {
  if (-not ($devices -match "(?m)^$([regex]::Escape($serial))\s+device$")) {
    throw "Android device $serial is not connected and ready."
  }
  $installed = & $adb -s $serial shell pm path com.axonic
  if (-not ($installed -match '^package:')) { throw "com.axonic is not installed on $serial." }
}

function Wait-ForNotificationMatch {
  param(
    [Parameter(Mandatory = $true)][string]$Serial,
    [Parameter(Mandatory = $true)][string]$Pattern,
    [int]$TimeoutSeconds = 45
  )

  $deadline = [DateTimeOffset]::UtcNow.AddSeconds($TimeoutSeconds)
  do {
    $dump = (& $adb -s $Serial shell dumpsys notification --noredact) -join "`n"
    if ($dump -match $Pattern) { return $true }
    Start-Sleep -Seconds 1
  } while ([DateTimeOffset]::UtcNow -lt $deadline)

  return $false
}

function Move-ExpoToolsBubbleFromCallButton {
  param([Parameter(Mandatory = $true)][string]$Serial)

  # Expo's development-client Tools bubble defaults to the top-right corner,
  # directly over Axonic's voice-call button. It is absent from production.
  # Move it only when Android reports the bubble in that overlapping region.
  & $adb -s $Serial shell uiautomator dump /sdcard/axonic-smoke-ui.xml | Out-Null
  $hierarchy = (& $adb -s $Serial shell cat /sdcard/axonic-smoke-ui.xml) -join ''
  $match = [regex]::Match(
    $hierarchy,
    'content-desc="Tools"[^>]*bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"'
  )
  if (-not $match.Success) { return }

  $left = [int]$match.Groups[1].Value
  $top = [int]$match.Groups[2].Value
  $right = [int]$match.Groups[3].Value
  $bottom = [int]$match.Groups[4].Value
  if ($left -lt 850 -or $top -gt 250) { return }

  $centerX = [int](($left + $right) / 2)
  $centerY = [int](($top + $bottom) / 2)
  & $adb -s $Serial shell input swipe $centerX $centerY 100 1000 750 | Out-Null
  Start-Sleep -Milliseconds 750
}

$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$message = "Axonic-smoke-$stamp"

# Warm the receiver first. A cold development client can still be compiling or
# loading Metro when Android backgrounds it; in that state its saved FCM token
# may be stale and the test measures the emulator rather than Axonic delivery.
Invoke-MaestroFlow -Arguments @(
  'test', '--device', $ReceiverSerial,
  '.maestro/warm-receiver.yaml'
)

# Background delivery exercises the FCM/Notifee notification floor only after
# the receiver has completed authentication and refreshed its push endpoint.
& $adb -s $ReceiverSerial shell input keyevent KEYCODE_HOME

Invoke-MaestroFlow -Arguments @(
  'test', '--device', $SenderSerial,
  '-e', "CHAT_NAME=$SenderChatName",
  '-e', "MESSAGE_TEXT=$message",
  '.maestro/send-message.yaml'
)

if (-not (Wait-ForNotificationMatch -Serial $ReceiverSerial -Pattern ([regex]::Escape($message)))) {
  throw 'The receiver did not expose the expected message in Android notification state.'
}

Invoke-MaestroFlow -Arguments @(
  'test', '--device', $ReceiverSerial,
  '-e', "MESSAGE_TEXT=$message",
  '.maestro/assert-message.yaml'
)

if ($IncludeCall) {
  # Exercise the same Android background/killed-process notification floor for
  # calls; the preceding message assertion leaves the receiver foregrounded.
  & $adb -s $ReceiverSerial shell input keyevent KEYCODE_HOME
  Move-ExpoToolsBubbleFromCallButton -Serial $SenderSerial
  Invoke-MaestroFlow -Arguments @(
    'test', '--device', $SenderSerial,
    '-e', "CHAT_NAME=$SenderChatName",
    '.maestro/start-voice-call.yaml'
  )
  if (-not (Wait-ForNotificationMatch -Serial $ReceiverSerial -Pattern 'incoming-call|Incoming.*call|is calling')) {
    throw 'The receiver did not expose an incoming-call notification.'
  }
  Invoke-MaestroFlow -Arguments @('test', '--device', $SenderSerial, '.maestro/end-call.yaml')
}

Write-Host "Two-device smoke test passed for message $message"
