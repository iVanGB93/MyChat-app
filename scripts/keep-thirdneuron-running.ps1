# A foreground WSL process keeps the Ubuntu instance alive. systemd services
# alone do not prevent WSL idle shutdown. No data, settings or credentials read.
$ErrorActionPreference = 'Stop'
while ($true) {
    & "$env:WINDIR\System32\wsl.exe" --distribution Ubuntu --exec /bin/sleep infinity
    Start-Sleep -Seconds 10
}
