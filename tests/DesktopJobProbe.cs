using System;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;

public static class DesktopJobProbe
{
    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool IsProcessInJob(IntPtr process, IntPtr job, [MarshalAs(UnmanagedType.Bool)] out bool result);
    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool QueryInformationJobObject(IntPtr job, int informationClass, out uint flags, uint length, out uint returnedLength);
    [DllImport("user32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern IntPtr CreateDesktopW(string name, IntPtr device, IntPtr devMode, uint flags, uint access, IntPtr security);
    [DllImport("user32.dll")]
    private static extern bool CloseDesktop(IntPtr desktop);

    public static int Main(string[] args)
    {
        if (args.Length != 1) return 2;
        bool inJob;
        if (!IsProcessInJob(Process.GetCurrentProcess().Handle, IntPtr.Zero, out inJob)) return 3;
        uint flags, returned;
        if (!QueryInformationJobObject(IntPtr.Zero, 4, out flags, 4, out returned)) return 4;
        IntPtr desktop = CreateDesktopW("CubaseMcpJobProbe_" + Process.GetCurrentProcess().Id,
            IntPtr.Zero, IntPtr.Zero, 0, 0x00ff, IntPtr.Zero);
        int error = desktop == IntPtr.Zero ? Marshal.GetLastWin32Error() : 0;
        if (desktop != IntPtr.Zero) CloseDesktop(desktop);
        File.WriteAllText(args[0], "{\"inJob\":" + (inJob ? "true" : "false") +
            ",\"uiFlags\":" + flags + ",\"desktopCreated\":" + (desktop != IntPtr.Zero ? "true" : "false") +
            ",\"desktopError\":" + error + "}");
        return 0;
    }
}
