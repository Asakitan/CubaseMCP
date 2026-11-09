using System;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
public static class EmptyStartProbe {
    [DllImport("kernel32.dll", SetLastError=true)] static extern bool IsProcessInJob(IntPtr process, IntPtr job, out bool member);
    [DllImport("kernel32.dll", SetLastError=true)] static extern bool QueryInformationJobObject(IntPtr job, int kind, out uint info, uint size, out uint returned);
    public static int Main(string[] args) {
        string report = Environment.GetEnvironmentVariable("CUBASE_EMPTY_SYNTH_REPORT");
        if (String.IsNullOrEmpty(report)) return 2;
        bool member; uint flags, returned;
        if (!IsProcessInJob(Process.GetCurrentProcess().Handle, IntPtr.Zero, out member) ||
            !QueryInformationJobObject(IntPtr.Zero, 4, out flags, 4, out returned)) return 3;
        File.WriteAllText(report, "{\"argCount\":" + args.Length + ",\"inJob\":" + (member ? "true" : "false") + ",\"uiFlags\":" + flags + "}");
        return 0;
    }
}
