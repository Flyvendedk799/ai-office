
$gps = Get-Process | Select-Object Id, MainWindowTitle
$titles = @{}
foreach ($p in $gps) {
    if ([string]::IsNullOrWhiteSpace($p.MainWindowTitle) -eq $false) {
        $titles[$p.Id] = $p.MainWindowTitle
    }
}
Get-CimInstance Win32_Process | ForEach-Object {
    [pscustomobject]@{
        pid = [int]$_.ProcessId
        title = if ($titles.Contains($_.ProcessId)) { $titles[$_.ProcessId] } else { "" }
    }
} | Where-Object { $_.title -ne "" } | Select-Object -First 5 | ConvertTo-Json

