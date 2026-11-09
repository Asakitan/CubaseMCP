using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Text;

namespace CubaseAiMcp
{
    public static class CubaseDesktop
    {
        private const uint DesktopAccess = 0x00ff;
        private static IntPtr heldDesktop = IntPtr.Zero;
        private static IntPtr heldProcess = IntPtr.Zero;

        [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
        private struct StartupInfo
        {
            public uint cb;
            public string reserved;
            public string desktop;
            public string title;
            public uint x, y, xSize, ySize, xCountChars, yCountChars, fillAttribute, flags;
            public ushort showWindow, reservedSize;
            public IntPtr reservedBytes, stdInput, stdOutput, stdError;
        }

        [StructLayout(LayoutKind.Sequential)]
        private struct ProcessInformation
        {
            public IntPtr process, thread;
            public uint processId, threadId;
        }

        public sealed class LaunchResult
        {
            public uint ProcessId;
            public string Desktop;
            public string ForegroundBefore;
            public string ForegroundAfter;
        }

        public sealed class WindowInfo
        {
            public uint ProcessId;
            public string Handle;
            public string ClassName;
            public string Title;
            public bool Visible;
        }

        private delegate bool EnumWindow(IntPtr window, IntPtr data);

        [DllImport("user32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
        private static extern IntPtr CreateDesktopW(string name, IntPtr device, IntPtr devMode, uint flags, uint access, IntPtr security);
        [DllImport("user32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
        private static extern IntPtr OpenDesktopW(string name, uint flags, bool inherit, uint access);
        [DllImport("user32.dll", SetLastError = true)]
        private static extern bool CloseDesktop(IntPtr desktop);
        [DllImport("user32.dll", SetLastError = true)]
        private static extern bool EnumDesktopWindows(IntPtr desktop, EnumWindow callback, IntPtr data);
        [DllImport("user32.dll", CharSet = CharSet.Unicode)]
        private static extern int GetWindowTextW(IntPtr window, StringBuilder text, int length);
        [DllImport("user32.dll", CharSet = CharSet.Unicode)]
        private static extern int GetClassNameW(IntPtr window, StringBuilder text, int length);
        [DllImport("user32.dll")]
        private static extern uint GetWindowThreadProcessId(IntPtr window, out uint processId);
        [DllImport("user32.dll")]
        [return: MarshalAs(UnmanagedType.Bool)]
        private static extern bool IsWindowVisible(IntPtr window);
        [DllImport("user32.dll")]
        private static extern IntPtr GetForegroundWindow();
        [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
        private static extern bool CreateProcessW(string application, StringBuilder command, IntPtr processAttributes,
            IntPtr threadAttributes, bool inheritHandles, uint creationFlags, IntPtr environment,
            string directory, ref StartupInfo startup, out ProcessInformation information);
        [DllImport("kernel32.dll")]
        private static extern bool CloseHandle(IntPtr handle);
        [DllImport("kernel32.dll", SetLastError = true)]
        private static extern uint WaitForSingleObject(IntPtr handle, uint milliseconds);
        [DllImport("kernel32.dll", SetLastError = true)]
        private static extern bool GetExitCodeProcess(IntPtr process, out uint exitCode);

        public static LaunchResult Start(string executable, string project, string directory, string desktopName)
        {
            if (executable.IndexOf('"') >= 0 || project.IndexOf('"') >= 0) throw new ArgumentException("Invalid path quoting.");
            if (heldProcess != IntPtr.Zero) throw new InvalidOperationException("This host already owns a Cubase process.");
            IntPtr foreground = GetForegroundWindow();
            IntPtr desktop = CreateDesktopW(desktopName, IntPtr.Zero, IntPtr.Zero, 0, DesktopAccess, IntPtr.Zero);
            if (desktop == IntPtr.Zero) throw new Win32Exception(Marshal.GetLastWin32Error(), "Cannot create the isolated desktop.");
            try
            {
                StartupInfo startup = new StartupInfo();
                startup.cb = (uint)Marshal.SizeOf(typeof(StartupInfo));
                startup.desktop = "winsta0\\" + desktopName;
                startup.flags = 0x00000001;
                startup.showWindow = 0;
                ProcessInformation information;
                StringBuilder command = new StringBuilder("\"" + executable + "\" \"" + project + "\"");
                // Keep the console and all application windows on the private desktop.
                if (!CreateProcessW(executable, command, IntPtr.Zero, IntPtr.Zero, false, 0x00000010,
                    IntPtr.Zero, directory, ref startup, out information))
                    throw new Win32Exception(Marshal.GetLastWin32Error(), "Cubase could not be started.");
                CloseHandle(information.thread);
                heldDesktop = desktop;
                heldProcess = information.process;
                return new LaunchResult {
                    ProcessId = information.processId, Desktop = startup.desktop,
                    ForegroundBefore = foreground.ToInt64().ToString("x"),
                    ForegroundAfter = GetForegroundWindow().ToInt64().ToString("x")
                };
            }
            catch { CloseDesktop(desktop); throw; }
        }

        public static uint WaitForExit()
        {
            if (heldProcess == IntPtr.Zero) throw new InvalidOperationException("No owned Cubase process.");
            try
            {
                if (WaitForSingleObject(heldProcess, 0xffffffff) != 0)
                    throw new Win32Exception(Marshal.GetLastWin32Error(), "Cannot wait for Cubase.");
                uint exitCode;
                if (!GetExitCodeProcess(heldProcess, out exitCode))
                    throw new Win32Exception(Marshal.GetLastWin32Error(), "Cannot read Cubase exit code.");
                return exitCode;
            }
            finally
            {
                CloseHandle(heldProcess);
                CloseDesktop(heldDesktop);
                heldProcess = IntPtr.Zero;
                heldDesktop = IntPtr.Zero;
            }
        }

        public static WindowInfo[] Inspect(string desktopName)
        {
            IntPtr desktop = OpenDesktopW(desktopName, 0, false, 0x0041);
            if (desktop == IntPtr.Zero) throw new Win32Exception(Marshal.GetLastWin32Error(), "The isolated desktop is unavailable.");
            try
            {
                List<WindowInfo> windows = new List<WindowInfo>();
                EnumWindow callback = delegate(IntPtr window, IntPtr data) {
                    uint processId;
                    GetWindowThreadProcessId(window, out processId);
                    StringBuilder title = new StringBuilder(2048);
                    StringBuilder className = new StringBuilder(256);
                    GetWindowTextW(window, title, title.Capacity);
                    GetClassNameW(window, className, className.Capacity);
                    windows.Add(new WindowInfo { ProcessId = processId, Handle = window.ToInt64().ToString("x"),
                        ClassName = className.ToString(), Title = title.ToString(), Visible = IsWindowVisible(window) });
                    return true;
                };
                if (!EnumDesktopWindows(desktop, callback, IntPtr.Zero))
                    throw new Win32Exception(Marshal.GetLastWin32Error(), "Cannot inspect the isolated desktop.");
                GC.KeepAlive(callback);
                return windows.ToArray();
            }
            finally { CloseDesktop(desktop); }
        }
    }
}
