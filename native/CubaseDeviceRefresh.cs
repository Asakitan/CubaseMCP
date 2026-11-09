using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;

namespace CubaseAiMcp
{
    public static class CubaseDeviceRefresh
    {
        public sealed class Result
        {
            public int ProcessId;
            public string Window;
            public string ForegroundBefore;
            public string ForegroundAfter;
            public string Action = "WM_DEVICECHANGE/DBT_DEVNODES_CHANGED";
            public bool Delivered;
            public bool DriverReloadVerified = false;
        }

        private delegate bool EnumWindow(IntPtr window, IntPtr data);
        [DllImport("user32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
        private static extern IntPtr OpenDesktopW(string name, uint flags, bool inherit, uint access);
        [DllImport("user32.dll", SetLastError = true)]
        private static extern bool CloseDesktop(IntPtr desktop);
        [DllImport("user32.dll", SetLastError = true)]
        private static extern bool EnumDesktopWindows(IntPtr desktop, EnumWindow callback, IntPtr data);
        [DllImport("user32.dll", CharSet = CharSet.Unicode)]
        private static extern int GetClassNameW(IntPtr window, StringBuilder text, int length);
        [DllImport("user32.dll")]
        private static extern uint GetWindowThreadProcessId(IntPtr window, out uint processId);
        [DllImport("user32.dll")]
        private static extern IntPtr GetForegroundWindow();
        [DllImport("kernel32.dll")]
        private static extern uint GetCurrentThreadId();
        [DllImport("user32.dll")]
        private static extern IntPtr GetThreadDesktop(uint threadId);
        [DllImport("user32.dll", SetLastError = true)]
        private static extern bool SetThreadDesktop(IntPtr desktop);
        [DllImport("user32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
        private static extern IntPtr SendMessageTimeoutW(IntPtr window, uint message, UIntPtr wParam,
            IntPtr lParam, uint flags, uint milliseconds, out UIntPtr result);

        public static Result Notify(int processId)
        {
            using (Process process = Process.GetProcessById(processId))
            {
                if (!String.Equals(process.ProcessName, "Cubase 16", StringComparison.OrdinalIgnoreCase))
                    throw new InvalidOperationException("The target is not the expected Cubase process.");
            }
            IntPtr foreground = GetForegroundWindow();
            Result result = null;
            Exception failure = null;
            Thread worker = new Thread(delegate() {
                try { result = NotifyOnIsolatedDesktop(processId); }
                catch (Exception error) { failure = error; }
            });
            worker.SetApartmentState(ApartmentState.STA);
            worker.Start();
            worker.Join();
            if (failure != null) throw failure;
            result.ForegroundBefore = foreground.ToInt64().ToString("x");
            result.ForegroundAfter = GetForegroundWindow().ToInt64().ToString("x");
            return result;
        }

        private static Result NotifyOnIsolatedDesktop(int processId)
        {
            IntPtr originalDesktop = GetThreadDesktop(GetCurrentThreadId());
            IntPtr desktop = OpenDesktopW("CubaseAI_MCP", 0, false, 0x00ff);
            if (desktop == IntPtr.Zero) throw new Win32Exception(Marshal.GetLastWin32Error());
            try
            {
                if (!SetThreadDesktop(desktop)) throw new Win32Exception(Marshal.GetLastWin32Error());
                List<IntPtr> listeners = new List<IntPtr>();
                EnumWindow callback = delegate(IntPtr window, IntPtr data) {
                    uint owner;
                    GetWindowThreadProcessId(window, out owner);
                    if (owner != (uint)processId) return true;
                    StringBuilder name = new StringBuilder(256);
                    GetClassNameW(window, name, name.Capacity);
                    if (name.ToString() == "USB Change Listener") listeners.Add(window);
                    return true;
                };
                if (!EnumDesktopWindows(desktop, callback, IntPtr.Zero))
                    throw new Win32Exception(Marshal.GetLastWin32Error());
                GC.KeepAlive(callback);
                if (listeners.Count != 1)
                    throw new InvalidOperationException("Expected exactly one isolated Cubase device listener.");
                UIntPtr result;
                // Fixed documented device-list notification; no UI command, input or focus operation.
                IntPtr delivered = SendMessageTimeoutW(listeners[0], 0x0219, new UIntPtr(7),
                    IntPtr.Zero, 0x0023, 2000, out result);
                if (delivered == IntPtr.Zero)
                    throw new Win32Exception(Marshal.GetLastWin32Error(), "Device-change notification was not delivered.");
                return new Result { ProcessId = processId, Window = listeners[0].ToInt64().ToString("x"),
                    Delivered = true };
            }
            finally { SetThreadDesktop(originalDesktop); CloseDesktop(desktop); }
        }
    }
}
