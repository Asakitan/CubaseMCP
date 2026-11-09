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
        private const uint JobUiLimitDesktop = 0x00000040;
        private const uint JobLimitKillOnClose = 0x00002000;
        private const uint CreationFlags = 0x01000014; // Break away, create suspended, and create a private console.
        private static IntPtr heldDesktop = IntPtr.Zero;
        private static IntPtr heldProcess = IntPtr.Zero;
        private static IntPtr heldJob = IntPtr.Zero;

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

        [StructLayout(LayoutKind.Sequential)]
        private struct JobUiRestrictions
        {
            public uint flags;
        }

        [StructLayout(LayoutKind.Sequential)]
        private struct JobBasicLimits
        {
            public long perProcessUserTime, perJobUserTime;
            public uint flags;
            public UIntPtr minimumWorkingSet, maximumWorkingSet;
            public uint activeProcessLimit;
            public UIntPtr affinity;
            public uint priorityClass, schedulingClass;
        }

        [StructLayout(LayoutKind.Sequential)]
        private struct IoCounters
        {
            public ulong readOperations, writeOperations, otherOperations;
            public ulong readBytes, writeBytes, otherBytes;
        }

        [StructLayout(LayoutKind.Sequential)]
        private struct JobExtendedLimits
        {
            public JobBasicLimits basic;
            public IoCounters io;
            public UIntPtr processMemoryLimit, jobMemoryLimit, peakProcessMemory, peakJobMemory;
        }

        public sealed class LaunchResult
        {
            public uint ProcessId;
            public string Desktop;
            public string ForegroundBefore;
            public string ForegroundAfter;
            public string InputDesktopBefore;
            public string InputDesktopBeforeResume;
            public string InputDesktopAfter;
            public bool DesktopSwitchRestricted;
            public bool JobKillsOnLastHandleClose;
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
        private static extern IntPtr OpenInputDesktop(uint flags, bool inherit, uint access);
        [DllImport("user32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
        private static extern bool GetUserObjectInformationW(IntPtr handle, int index, StringBuilder information, uint length, out uint needed);
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
        [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
        private static extern IntPtr CreateJobObjectW(IntPtr attributes, string name);
        [DllImport("kernel32.dll", EntryPoint = "SetInformationJobObject", SetLastError = true)]
        private static extern bool SetJobUiRestrictions(IntPtr job, int informationClass, ref JobUiRestrictions restrictions, uint length);
        [DllImport("kernel32.dll", EntryPoint = "SetInformationJobObject", SetLastError = true)]
        private static extern bool SetJobExtendedLimits(IntPtr job, int informationClass, ref JobExtendedLimits limits, uint length);
        [DllImport("kernel32.dll", EntryPoint = "QueryInformationJobObject", SetLastError = true)]
        private static extern bool QueryJobUiRestrictions(IntPtr job, int informationClass, out JobUiRestrictions restrictions, uint length, out uint returnedLength);
        [DllImport("kernel32.dll", EntryPoint = "QueryInformationJobObject", SetLastError = true)]
        private static extern bool QueryJobExtendedLimits(IntPtr job, int informationClass, out JobExtendedLimits limits, uint length, out uint returnedLength);
        [DllImport("kernel32.dll", SetLastError = true)]
        private static extern bool AssignProcessToJobObject(IntPtr job, IntPtr process);
        [DllImport("kernel32.dll", SetLastError = true)]
        private static extern bool IsProcessInJob(IntPtr process, IntPtr job, [MarshalAs(UnmanagedType.Bool)] out bool result);
        [DllImport("kernel32.dll", SetLastError = true)]
        private static extern uint ResumeThread(IntPtr thread);
        [DllImport("kernel32.dll", SetLastError = true)]
        private static extern bool TerminateProcess(IntPtr process, uint exitCode);

        private static string InputDesktopName()
        {
            IntPtr input = OpenInputDesktop(0, false, 0x0001);
            if (input == IntPtr.Zero) throw new Win32Exception(Marshal.GetLastWin32Error(), "Cannot inspect the input desktop.");
            try
            {
                StringBuilder name = new StringBuilder(256);
                uint needed;
                if (!GetUserObjectInformationW(input, 2, name, (uint)(name.Capacity * 2), out needed))
                    throw new Win32Exception(Marshal.GetLastWin32Error(), "Cannot read the input desktop name.");
                if (name.Length == 0) throw new InvalidOperationException("The input desktop name is empty.");
                return name.ToString();
            }
            finally { CloseDesktop(input); }
        }

        private static string NonTargetInputDesktop(string desktopName)
        {
            string input = InputDesktopName();
            if (String.Equals(input, desktopName, StringComparison.OrdinalIgnoreCase))
                throw new InvalidOperationException("The isolated desktop is the current input desktop.");
            return input;
        }

        public static uint StartDetachedHolder(string powershell, string script, string project, string stdout, string stderr, string directory)
        {
            string[] arguments = { powershell, script, stdout, stderr, directory };
            foreach (string argument in arguments)
                if (String.IsNullOrEmpty(argument) || argument.IndexOf('"') >= 0)
                    throw new ArgumentException("Invalid holder path.");
            if (project != null && project.IndexOf('"') >= 0) throw new ArgumentException("Invalid project path.");
            StartupInfo startup = new StartupInfo();
            startup.cb = (uint)Marshal.SizeOf(typeof(StartupInfo));
            startup.flags = 0x00000001;
            startup.showWindow = 0;
            StringBuilder command = new StringBuilder("\"" + powershell + "\" -NoProfile -NonInteractive -ExecutionPolicy Bypass -File \"" + script +
                "\" -HolderStdoutPath \"" + stdout + "\" -HolderStderrPath \"" + stderr + "\"");
            if (!String.IsNullOrEmpty(project)) command.Append(" -ProjectPath \"").Append(project).Append("\"");
            ProcessInformation information;
            // No inherited handles: a long-lived holder must not keep the caller's capture pipe open.
            if (!CreateProcessW(powershell, command, IntPtr.Zero, IntPtr.Zero, false, 0x08000000,
                IntPtr.Zero, directory, ref startup, out information))
                throw new Win32Exception(Marshal.GetLastWin32Error(), "Cannot start the background holder.");
            CloseHandle(information.thread);
            CloseHandle(information.process);
            return information.processId;
        }

        public static LaunchResult Start(string executable, string project, string directory, string desktopName)
        {
            if (String.IsNullOrEmpty(project)) throw new ArgumentException("A project path is required.", "project");
            return StartCore(executable, project, directory, desktopName);
        }

        public static LaunchResult StartEmpty(string executable, string directory, string desktopName)
        {
            return StartCore(executable, null, directory, desktopName);
        }

        private static LaunchResult StartCore(string executable, string project, string directory, string desktopName)
        {
            if (String.IsNullOrEmpty(executable) || executable.IndexOf('"') >= 0 ||
                (project != null && project.IndexOf('"') >= 0)) throw new ArgumentException("Invalid path quoting.");
            if (heldProcess != IntPtr.Zero) throw new InvalidOperationException("This host already owns a Cubase process.");
            string inputBefore = NonTargetInputDesktop(desktopName);
            IntPtr foreground = GetForegroundWindow();
            IntPtr desktop = CreateDesktopW(desktopName, IntPtr.Zero, IntPtr.Zero, 0, DesktopAccess, IntPtr.Zero);
            if (desktop == IntPtr.Zero) throw new Win32Exception(Marshal.GetLastWin32Error(), "Cannot create the isolated desktop.");
            IntPtr job = IntPtr.Zero;
            ProcessInformation information = new ProcessInformation();
            try
            {
                job = CreateJobObjectW(IntPtr.Zero, null);
                if (job == IntPtr.Zero) throw new Win32Exception(Marshal.GetLastWin32Error(), "Cannot create the isolated job.");
                JobUiRestrictions restrictions = new JobUiRestrictions { flags = JobUiLimitDesktop };
                if (!SetJobUiRestrictions(job, 4, ref restrictions, (uint)Marshal.SizeOf(typeof(JobUiRestrictions))))
                    throw new Win32Exception(Marshal.GetLastWin32Error(), "Cannot restrict desktop switching.");
                JobExtendedLimits limits = new JobExtendedLimits();
                limits.basic.flags = JobLimitKillOnClose;
                if (!SetJobExtendedLimits(job, 9, ref limits, (uint)Marshal.SizeOf(typeof(JobExtendedLimits))))
                    throw new Win32Exception(Marshal.GetLastWin32Error(), "Cannot bind the isolated job lifetime.");
                StartupInfo startup = new StartupInfo();
                startup.cb = (uint)Marshal.SizeOf(typeof(StartupInfo));
                startup.desktop = "winsta0\\" + desktopName;
                startup.flags = 0x00000001;
                startup.showWindow = 0;
                StringBuilder command = new StringBuilder("\"" + executable + "\"");
                if (project != null) command.Append(" \"").Append(project).Append("\"");
                // Assign the suspended process to the restricted job before any application code runs.
                if (!CreateProcessW(executable, command, IntPtr.Zero, IntPtr.Zero, false, CreationFlags,
                    IntPtr.Zero, directory, ref startup, out information))
                    throw new Win32Exception(Marshal.GetLastWin32Error(), "Cubase could not be started.");
                if (!AssignProcessToJobObject(job, information.process))
                    throw new Win32Exception(Marshal.GetLastWin32Error(), "Cannot assign the isolated process to its job.");
                bool member;
                if (!IsProcessInJob(information.process, job, out member))
                    throw new Win32Exception(Marshal.GetLastWin32Error(), "Cannot verify isolated job membership.");
                if (!member) throw new InvalidOperationException("The process is not in the restricted job.");
                JobUiRestrictions observed;
                uint returnedLength;
                if (!QueryJobUiRestrictions(job, 4, out observed, (uint)Marshal.SizeOf(typeof(JobUiRestrictions)), out returnedLength))
                    throw new Win32Exception(Marshal.GetLastWin32Error(), "Cannot verify desktop restrictions.");
                if ((observed.flags & JobUiLimitDesktop) == 0)
                    throw new InvalidOperationException("Desktop-switch restriction is absent.");
                JobExtendedLimits observedLimits;
                if (!QueryJobExtendedLimits(job, 9, out observedLimits, (uint)Marshal.SizeOf(typeof(JobExtendedLimits)), out returnedLength))
                    throw new Win32Exception(Marshal.GetLastWin32Error(), "Cannot verify the isolated job lifetime.");
                if ((observedLimits.basic.flags & JobLimitKillOnClose) == 0)
                    throw new InvalidOperationException("The isolated job lifetime limit is absent.");
                string inputBeforeResume = NonTargetInputDesktop(desktopName);
                uint previousSuspendCount = ResumeThread(information.thread);
                if (previousSuspendCount == 0xffffffff)
                    throw new Win32Exception(Marshal.GetLastWin32Error(), "Cannot resume the isolated process.");
                if (previousSuspendCount != 1)
                    throw new InvalidOperationException("Unexpected initial process suspension count.");
                string inputAfter = NonTargetInputDesktop(desktopName);
                CloseHandle(information.thread);
                information.thread = IntPtr.Zero;
                heldDesktop = desktop;
                heldProcess = information.process;
                heldJob = job;
                return new LaunchResult {
                    ProcessId = information.processId, Desktop = startup.desktop,
                    ForegroundBefore = foreground.ToInt64().ToString("x"),
                    ForegroundAfter = GetForegroundWindow().ToInt64().ToString("x"),
                    InputDesktopBefore = inputBefore, InputDesktopBeforeResume = inputBeforeResume, InputDesktopAfter = inputAfter,
                    DesktopSwitchRestricted = true, JobKillsOnLastHandleClose = true
                };
            }
            catch
            {
                if (information.process != IntPtr.Zero)
                {
                    TerminateProcess(information.process, 1);
                    WaitForSingleObject(information.process, 5000);
                    CloseHandle(information.process);
                }
                if (information.thread != IntPtr.Zero) CloseHandle(information.thread);
                if (job != IntPtr.Zero) CloseHandle(job);
                CloseDesktop(desktop);
                throw;
            }
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
                CloseHandle(heldJob);
                CloseDesktop(heldDesktop);
                heldProcess = IntPtr.Zero;
                heldJob = IntPtr.Zero;
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
