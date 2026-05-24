[Console]::OutputEncoding = [Text.Encoding]::UTF8
Add-Type @'
using System;
using System.Runtime.InteropServices;
using System.Text;
public class WinAPI {
    [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int count);
    [DllImport("user32.dll")] public static extern int GetWindowTextLength(IntPtr hWnd);
}
'@
$h = [WinAPI]::GetForegroundWindow()
$len = [WinAPI]::GetWindowTextLength($h)
$sb = New-Object System.Text.StringBuilder($len + 1)
[WinAPI]::GetWindowText($h, $sb, $sb.Capacity)
Write-Output $sb.ToString()
