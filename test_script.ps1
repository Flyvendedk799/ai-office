
$gps = Get-Process | Select-Object Id, MainWindowTitle
$titles = @{}
foreach ($p in $gps) {
    if ([string]::IsNullOrWhiteSpace($p.MainWindowTitle) -eq $false) {
        $titles[$p.Id] = $p.MainWindowTitle
    }
}
Get-CimInstance Win32_Process | Select-Object -First 10 | ForEach-Object {
    [pscustomobject]@{
        pid = [int]$_.ProcessId
        title = if ($titles.Contains($_.ProcessId)) { $titles[$_.ProcessId] } else { "" }
    }
} | ConvertTo-Json

