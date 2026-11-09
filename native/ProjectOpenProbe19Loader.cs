using System;
using System.ComponentModel;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;

namespace CubaseAiMcp
{
    // Fixed, explicitly approved diagnostic. Not an MCP execution backend.
    public static class ProjectOpenProbe19Loader
    {
        public sealed class Result
        {
            public int ProcessId;
            public string ModulePath;
            public string Stage = "validate";
            public string Error;
            public string Execution = "not_started";
            public bool ModuleLoaded;
            public bool EntryCompleted;
            public uint? EntryReturnCode;
            public string PendingPathAllocation;
            public bool FixtureMatched;
            public ProjectOpenJobAudit19.Result JobAudit;
        }

        [DllImport("kernel32.dll", SetLastError = true)] static extern IntPtr OpenProcess(uint access, bool inherit, uint pid);
        [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr handle);
        [DllImport("kernel32.dll", CharSet = CharSet.Unicode)] static extern IntPtr GetModuleHandleW(string name);
        [DllImport("kernel32.dll", CharSet = CharSet.Ansi, ExactSpelling = true)] static extern IntPtr GetProcAddress(IntPtr module, string name);
        [DllImport("kernel32.dll", SetLastError = true)] static extern bool GetModuleHandleExW(uint flags, IntPtr address, out IntPtr module);
        [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)] static extern uint GetModuleFileNameW(IntPtr module, StringBuilder name, int size);
        [DllImport("kernel32.dll", SetLastError = true)] static extern IntPtr VirtualAllocEx(IntPtr process, IntPtr address, UIntPtr size, uint type, uint protection);
        [DllImport("kernel32.dll", SetLastError = true)] static extern bool VirtualFreeEx(IntPtr process, IntPtr address, UIntPtr size, uint type);
        [DllImport("kernel32.dll", SetLastError = true)] static extern bool WriteProcessMemory(IntPtr process, IntPtr address, byte[] data, UIntPtr size, out UIntPtr written);
        [DllImport("kernel32.dll", SetLastError = true)] static extern IntPtr CreateRemoteThread(IntPtr process, IntPtr attributes, UIntPtr stack, IntPtr start, IntPtr parameter, uint flags, out uint id);
        [DllImport("kernel32.dll", SetLastError = true)] static extern uint WaitForSingleObject(IntPtr handle, uint milliseconds);
        [DllImport("kernel32.dll", SetLastError = true)] static extern bool GetExitCodeThread(IntPtr handle, out uint code);
        [DllImport("kernel32.dll", SetLastError = true)] static extern bool IsWow64Process(IntPtr process, out bool wow64);
        [DllImport("kernel32.dll", SetLastError = true)] static extern bool GetProcessTimes(IntPtr process, out long creation, out long exit, out long kernel, out long user);

        static void Need(bool ok, string message)
        {
            if (!ok) throw new Win32Exception(Marshal.GetLastWin32Error(), message);
        }

        static int Header(byte[] image)
        {
            if (image.Length < 256 || BitConverter.ToUInt16(image, 0) != 0x5a4d) throw new InvalidDataException("Invalid DOS image.");
            int pe = BitConverter.ToInt32(image, 0x3c);
            if (pe < 64 || pe > image.Length - 256 || BitConverter.ToUInt32(image, pe) != 0x4550 ||
                BitConverter.ToUInt16(image, pe + 4) != 0x8664 || BitConverter.ToUInt16(image, pe + 24) != 0x20b)
                throw new InvalidDataException("An AMD64 PE32+ image is required.");
            return pe;
        }

        static int Offset(byte[] image, int pe, uint rva, int count, bool executable = false)
        {
            int sections = BitConverter.ToUInt16(image, pe + 6);
            int table = pe + 24 + BitConverter.ToUInt16(image, pe + 20);
            if (sections < 1 || sections > 96 || table > image.Length - sections * 40) throw new InvalidDataException("Invalid sections.");
            for (int i = 0; i < sections; i++)
            {
                int s = table + i * 40;
                uint va = BitConverter.ToUInt32(image, s + 12), size = BitConverter.ToUInt32(image, s + 16), raw = BitConverter.ToUInt32(image, s + 20);
                if (executable && (BitConverter.ToUInt32(image, s + 36) & 0x20000000) == 0) continue;
                if (rva < va || (ulong)rva - va + (uint)count > size) continue;
                ulong offset = (ulong)raw + rva - va;
                if (offset + (uint)count > (ulong)image.Length) throw new InvalidDataException("Section exceeds file.");
                return checked((int)offset);
            }
            throw new InvalidDataException("Export is outside file-backed sections.");
        }

        static uint EntryRva(string path, string wanted)
        {
            if (wanted != "StartProjectOpenProbe19")
                throw new InvalidDataException("Unknown fixed diagnostic entry.");
            if (new FileInfo(path).Length > 16 * 1024 * 1024) throw new InvalidDataException("Probe image exceeds the bound.");
            byte[] image = File.ReadAllBytes(path);
            int pe = Header(image);
            uint exports = BitConverter.ToUInt32(image, pe + 136), exportSize = BitConverter.ToUInt32(image, pe + 140);
            int e = Offset(image, pe, exports, 40);
            uint functions = BitConverter.ToUInt32(image, e + 20), names = BitConverter.ToUInt32(image, e + 24);
            if (functions > 4096 || names > 4096) throw new InvalidDataException("Export count exceeds the bound.");
            uint functionsRva = BitConverter.ToUInt32(image, e + 28), namesRva = BitConverter.ToUInt32(image, e + 32), ordinalsRva = BitConverter.ToUInt32(image, e + 36);
            for (uint i = 0; i < names; i++)
            {
                uint nameRva = BitConverter.ToUInt32(image, Offset(image, pe, namesRva + i * 4, 4));
                int name = Offset(image, pe, nameRva, wanted.Length + 1);
                if (Encoding.ASCII.GetString(image, name, wanted.Length) != wanted || image[name + wanted.Length] != 0) continue;
                ushort ordinal = BitConverter.ToUInt16(image, Offset(image, pe, ordinalsRva + i * 2, 2));
                if (ordinal >= functions) throw new InvalidDataException("Invalid export ordinal.");
                uint rva = BitConverter.ToUInt32(image, Offset(image, pe, functionsRva + ordinal * 4U, 4));
                if (rva >= exports && (ulong)rva < (ulong)exports + exportSize) throw new InvalidDataException("Forwarded probe entry is not accepted.");
                Offset(image, pe, rva, 1, true);
                return rva;
            }
            throw new InvalidDataException("Fixed diagnostic export is absent.");
        }

        static IntPtr TargetLoadLibrary(Process target)
        {
            IntPtr function = GetProcAddress(GetModuleHandleW("kernel32.dll"), "LoadLibraryW"), owner = IntPtr.Zero;
            Need(function != IntPtr.Zero && GetModuleHandleExW(6, function, out owner), "System export lookup failed.");
            StringBuilder path = new StringBuilder(32768);
            Need(GetModuleFileNameW(owner, path, path.Capacity) > 0, "System export owner path failed.");
            long rva = function.ToInt64() - owner.ToInt64();
            foreach (ProcessModule module in target.Modules)
                if (String.Equals(module.FileName, path.ToString(), StringComparison.OrdinalIgnoreCase))
                {
                    if (rva < 0 || rva >= module.ModuleMemorySize) throw new InvalidDataException("System export exceeds its module.");
                    return new IntPtr(module.BaseAddress.ToInt64() + rva);
                }
            throw new InvalidOperationException("Target does not contain the matching system module.");
        }

        public static Result LoadAndStartProjectOpen19(int processId, long expectedCreationFileTime, string workspaceRoot)
        {
            return LoadAndStartFixed(processId, expectedCreationFileTime, workspaceRoot, 3);
        }

        static Result LoadAndStartFixed(int processId, long expectedCreationFileTime, string workspaceRoot, int kind)
        {
            if (kind != 3 || processId != 50568 || expectedCreationFileTime != 134387238816771327L ||
                !String.Equals(Path.GetFullPath(workspaceRoot).TrimEnd(Path.DirectorySeparatorChar), @"E:\VC\CubaseMCP", StringComparison.OrdinalIgnoreCase))
                throw new InvalidDataException("Unexpected fixed diagnostic root, process or lifetime.");
            const string directory = "project-open-probe", filename = "CubaseMcpProjectOpenProbe19.dll", entryName = "StartProjectOpenProbe19";
            Result report = new Result { ProcessId = processId, ModulePath = Path.GetFullPath(Path.Combine(workspaceRoot, "artifacts", directory, filename)) };
            IntPtr process = IntPtr.Zero, pathBuffer = IntPtr.Zero, thread = IntPtr.Zero;
            bool loadStarted = false, loadCompleted = false;
            try
            {
                if (IntPtr.Size != 8) throw new InvalidOperationException("An AMD64 loader is required.");
                string fixtureDirectory = Path.Combine(workspaceRoot, "artifacts", directory);
                string sourceDirectory = Path.Combine(workspaceRoot, "artifacts", "live-smoke");
                foreach (string path in new[] { workspaceRoot, Path.Combine(workspaceRoot, "artifacts"), fixtureDirectory, sourceDirectory })
                    if ((File.GetAttributes(path) & FileAttributes.ReparsePoint) != 0) throw new InvalidOperationException("A fixture directory is a reparse point.");
                string fixture = Path.Combine(fixtureDirectory, "Open Probe.cpr");
                string source = Path.Combine(sourceDirectory, "MCP Device Test 20261110.cpr");
                if ((File.GetAttributes(fixture) & (FileAttributes.ReparsePoint | FileAttributes.Directory)) != 0 ||
                    (File.GetAttributes(source) & (FileAttributes.ReparsePoint | FileAttributes.Directory)) != 0)
                    throw new InvalidOperationException("The fixed fixture is not a regular file.");
                byte[] expected = File.ReadAllBytes(source), actual = File.ReadAllBytes(fixture);
                if (expected.Length != 93085 || actual.Length != expected.Length) throw new InvalidOperationException("The fixed fixture length changed.");
                for (int i = 0; i < expected.Length; i++)
                    if (actual[i] != expected[i]) throw new InvalidOperationException("The fixed fixture differs from the copied test project.");
                report.FixtureMatched = true;
                uint entry = EntryRva(report.ModulePath, entryName);
                using (Process target = Process.GetProcessById(processId))
                {
                    if (target.ProcessName != "Cubase 16" || !String.Equals(target.MainModule.FileName,
                        @"C:\Program Files\Steinberg\Cubase 16\Cubase 16.exe", StringComparison.OrdinalIgnoreCase))
                        throw new InvalidOperationException("Target differs from the inspected Cubase installation.");
                    if (target.MainModule.BaseAddress.ToInt64() != 0x140000000L) throw new InvalidOperationException("Target image base changed.");
                    byte[] host = File.ReadAllBytes(target.MainModule.FileName);
                    if (BitConverter.ToUInt32(host, Header(host) + 8) != 0x6adf121b) throw new InvalidOperationException("Target build profile changed.");
                    bool isolated = false;
                    foreach (CubaseDesktop.WindowInfo window in CubaseDesktop.Inspect("CubaseAI_MCP"))
                        if (window.ProcessId == processId) isolated = true;
                    if (!isolated) throw new InvalidOperationException("No window of this target was observed on the private desktop.");
                    foreach (ProcessModule module in target.Modules)
                        if (String.Equals(module.FileName, report.ModulePath, StringComparison.OrdinalIgnoreCase))
                            throw new InvalidOperationException("Probe is already loaded; no replay is allowed.");
                    report.JobAudit = ProjectOpenJobAudit19.Verify();
                    IntPtr load = TargetLoadLibrary(target);
                    process = OpenProcess(0x0010043a, false, (uint)processId);
                    Need(process != IntPtr.Zero, "Opening the approved process failed.");
                    bool wow64;
                    Need(IsWow64Process(process, out wow64), "Architecture query failed.");
                    if (wow64) throw new InvalidOperationException("Target is not native AMD64.");
                    long creation, exit, kernel, user;
                    Need(GetProcessTimes(process, out creation, out exit, out kernel, out user), "Lifetime query failed.");
                    if (creation != expectedCreationFileTime) throw new InvalidOperationException("Target identity changed.");
                    byte[] path = Encoding.Unicode.GetBytes(report.ModulePath + "\0");
                    pathBuffer = VirtualAllocEx(process, IntPtr.Zero, (UIntPtr)path.Length, 0x3000, 0x04);
                    Need(pathBuffer != IntPtr.Zero, "Allocating module path failed.");
                    UIntPtr written;
                    Need(WriteProcessMemory(process, pathBuffer, path, (UIntPtr)path.Length, out written) && written.ToUInt64() == (ulong)path.Length, "Writing module path failed.");
                    report.Stage = "load-module";
                    uint id;
                    thread = CreateRemoteThread(process, IntPtr.Zero, UIntPtr.Zero, load, pathBuffer, 0, out id);
                    Need(thread != IntPtr.Zero, "Starting module load failed.");
                    loadStarted = true;
                    report.Execution = "unknown";
                    if (WaitForSingleObject(thread, 10000) != 0) throw new TimeoutException("Module-load thread is pending; no retry was made.");
                    loadCompleted = true;
                    CloseHandle(thread); thread = IntPtr.Zero;
                    Need(VirtualFreeEx(process, pathBuffer, UIntPtr.Zero, 0x8000), "Releasing module path failed.");
                    pathBuffer = IntPtr.Zero;
                    target.Refresh();
                    ProcessModule loaded = null;
                    foreach (ProcessModule module in target.Modules)
                        if (String.Equals(module.FileName, report.ModulePath, StringComparison.OrdinalIgnoreCase)) loaded = module;
                    if (loaded == null) throw new InvalidOperationException("The fixed module was not loaded.");
                    if (entry >= loaded.ModuleMemorySize) throw new InvalidOperationException("Entry exceeds loaded image.");
                    report.ModuleLoaded = true;
                    report.Stage = "start-probe";
                    thread = CreateRemoteThread(process, IntPtr.Zero, UIntPtr.Zero, new IntPtr(loaded.BaseAddress.ToInt64() + entry), IntPtr.Zero, 0, out id);
                    Need(thread != IntPtr.Zero, "Starting fixed probe entry failed.");
                    if (WaitForSingleObject(thread, 5000) != 0) throw new TimeoutException("Probe entry is pending; no replay was made.");
                    uint code;
                    Need(GetExitCodeThread(thread, out code), "Reading probe entry result failed.");
                    report.EntryReturnCode = code;
                    report.EntryCompleted = true;
                    report.Execution = "submitted";
                    report.Stage = "entry-returned";
                }
            }
            catch (Exception error) { report.Error = error.Message; }
            finally
            {
                if (pathBuffer != IntPtr.Zero)
                {
                    if (!loadStarted || loadCompleted) VirtualFreeEx(process, pathBuffer, UIntPtr.Zero, 0x8000);
                    else report.PendingPathAllocation = "0x" + pathBuffer.ToInt64().ToString("x");
                }
                if (thread != IntPtr.Zero) CloseHandle(thread);
                if (process != IntPtr.Zero) CloseHandle(process);
            }
            return report;
        }
    }
}
