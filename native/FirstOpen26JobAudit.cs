using System;
using System.ComponentModel;
using System.Diagnostics;
using System.Runtime.InteropServices;

namespace CubaseAiMcp
{
    // Bounded handle-table snapshot; only job handles held by the fixed launcher are inspected.
    public static class FirstOpen26JobAudit
    {
        const int HandleSnapshotBytes = 32 * 1024 * 1024;

        public sealed class Result
        {
            public int TargetProcessId, HolderProcessId, HolderJobHandles, MatchingJobs;
            public uint UiFlags, LimitFlags;
            public bool Verified;
        }

        [DllImport("ntdll.dll")] static extern int NtQuerySystemInformation(int informationClass, IntPtr buffer, int length, out int required);
        [DllImport("kernel32.dll", SetLastError = true)] static extern IntPtr CreateJobObjectW(IntPtr attributes, string name);
        [DllImport("kernel32.dll")] static extern IntPtr GetCurrentProcess();
        [DllImport("kernel32.dll", SetLastError = true)] static extern uint GetProcessId(IntPtr process);
        [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr handle);
        [DllImport("kernel32.dll", SetLastError = true)] static extern bool DuplicateHandle(IntPtr sourceProcess, IntPtr source,
            IntPtr targetProcess, out IntPtr target, uint access, bool inherit, uint options);
        [DllImport("kernel32.dll", SetLastError = true)] static extern bool IsProcessInJob(IntPtr process, IntPtr job, [MarshalAs(UnmanagedType.Bool)] out bool member);
        [DllImport("kernel32.dll", SetLastError = true)] static extern bool QueryInformationJobObject(IntPtr job, int informationClass,
            IntPtr information, uint length, out uint returned);
        [DllImport("kernel32.dll", SetLastError = true)] static extern bool GetProcessTimes(IntPtr process, out long creation,
            out long exit, out long kernel, out long user);
        [DllImport("kernel32.dll", SetLastError = true)] static extern uint WaitForSingleObject(IntPtr handle, uint milliseconds);

        static void Need(bool condition, string message)
        {
            if (!condition) throw new Win32Exception(Marshal.GetLastWin32Error(), message);
        }

        static void CheckCreation(IntPtr process, long expected)
        {
            long creation, exit, kernel, user;
            Need(GetProcessTimes(process, out creation, out exit, out kernel, out user), "Process lifetime query failed.");
            if (creation != expected || WaitForSingleObject(process, 0) != 0x102)
                throw new InvalidOperationException("Process identity or lifetime changed.");
        }

        public static Result Verify(IntPtr target, int targetPid, long targetCreation, IntPtr holder, int holderPid, long holderCreation)
        {
            if (IntPtr.Size != 8) throw new InvalidOperationException("An AMD64 audit process is required.");
            IntPtr marker = IntPtr.Zero, buffer = IntPtr.Zero, info = IntPtr.Zero;
            try
            {
                if (target == IntPtr.Zero || holder == IntPtr.Zero || targetPid <= 0 || holderPid <= 0 || targetPid == holderPid || GetProcessId(target) != (uint)targetPid || GetProcessId(holder) != (uint)holderPid) throw new ArgumentException("Invalid process handles or identities.");
                CheckCreation(holder, holderCreation);
                CheckCreation(target, targetCreation);
                marker = CreateJobObjectW(IntPtr.Zero, null);
                Need(marker != IntPtr.Zero, "Creating the local marker job failed.");
                int required;
                int length = HandleSnapshotBytes;
                buffer = Marshal.AllocHGlobal(length);
                int status = NtQuerySystemInformation(64, buffer, length, out required);
                if (status != 0) throw new InvalidOperationException("Handle-table snapshot failed: status 0x" +
                    unchecked((uint)status).ToString("x8") + ", buffer " + length + ", required " + required + ".");
                long count = Marshal.ReadInt64(buffer, 0);
                if (count < 1 || count > (length - 16) / 40) throw new InvalidOperationException("Invalid handle-table count.");
                int ownPid;
                using (Process current = Process.GetCurrentProcess()) ownPid = current.Id;
                ushort jobType = 0;
                for (long index = 0; index < count; index++)
                {
                    IntPtr entry = IntPtr.Add(buffer, checked(16 + (int)(index * 40)));
                    if (Marshal.ReadInt64(entry, 8) == ownPid && Marshal.ReadInt64(entry, 16) == marker.ToInt64())
                    {
                        jobType = unchecked((ushort)Marshal.ReadInt16(entry, 30));
                        break;
                    }
                }
                if (jobType == 0) throw new InvalidOperationException("The local job handle was not found.");
                Result result = new Result { TargetProcessId = targetPid, HolderProcessId = holderPid };
                info = Marshal.AllocHGlobal(144);
                for (long index = 0; index < count; index++)
                {
                    IntPtr entry = IntPtr.Add(buffer, checked(16 + (int)(index * 40)));
                    if (Marshal.ReadInt64(entry, 8) != holderPid || unchecked((ushort)Marshal.ReadInt16(entry, 30)) != jobType) continue;
                    result.HolderJobHandles++;
                    IntPtr job;
                    if (!DuplicateHandle(holder, new IntPtr(Marshal.ReadInt64(entry, 16)), GetCurrentProcess(), out job, 0x0004, false, 0)) continue;
                    try
                    {
                        bool member;
                        if (!IsProcessInJob(target, job, out member) || !member) continue;
                        uint returned;
                        if (!QueryInformationJobObject(job, 4, info, 4, out returned)) continue;
                        uint ui = unchecked((uint)Marshal.ReadInt32(info, 0));
                        if (!QueryInformationJobObject(job, 9, info, 144, out returned)) continue;
                        uint flags = unchecked((uint)Marshal.ReadInt32(info, 16));
                        if (ui != 64 || flags != 8192) continue;
                        result.MatchingJobs++;
                        result.UiFlags = ui;
                        result.LimitFlags = flags;
                    }
                    finally { Need(CloseHandle(job), "Closing the duplicated Job handle failed."); }
                }
                CheckCreation(holder, holderCreation);
                CheckCreation(target, targetCreation);
                if (result.MatchingJobs != 1) throw new InvalidOperationException("Expected exactly one matching restricted holder job.");
                result.Verified = true;
                return result;
            }
            finally
            {
                if (info != IntPtr.Zero) Marshal.FreeHGlobal(info);
                if (buffer != IntPtr.Zero) Marshal.FreeHGlobal(buffer);
                if (marker != IntPtr.Zero) Need(CloseHandle(marker), "Closing the marker Job handle failed.");
            }
        }
    }
}
