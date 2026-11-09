using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Threading;

namespace CubaseAiMcp
{
    public sealed class MidiPortHost : IDisposable
    {
        private const string Library = "teVirtualMIDI64.dll";
        private readonly List<IntPtr> ports = new List<IntPtr>();
        private readonly ManualResetEvent failed = new ManualResetEvent(false);
        private readonly MidiCallback callback;
        private string failure;
        private int stopping;

        [UnmanagedFunctionPointer(CallingConvention.StdCall)]
        private delegate void MidiCallback(IntPtr port, IntPtr data, uint length, UIntPtr context);

        [DllImport(Library, CharSet = CharSet.Unicode, ExactSpelling = true, SetLastError = true)]
        [DefaultDllImportSearchPaths(DllImportSearchPath.System32)]
        private static extern IntPtr virtualMIDICreatePortEx2(string name, MidiCallback handler, UIntPtr context, uint maxSysex, uint flags);

        [DllImport(Library, ExactSpelling = true, SetLastError = true)]
        [DefaultDllImportSearchPaths(DllImportSearchPath.System32)]
        [return: MarshalAs(UnmanagedType.Bool)]
        private static extern bool virtualMIDISendData(IntPtr port, IntPtr data, uint length);

        [DllImport(Library, ExactSpelling = true)]
        [DefaultDllImportSearchPaths(DllImportSearchPath.System32)]
        private static extern void virtualMIDIClosePort(IntPtr port);

        [DllImport(Library, ExactSpelling = true, SetLastError = true)]
        [DefaultDllImportSearchPaths(DllImportSearchPath.System32)]
        [return: MarshalAs(UnmanagedType.Bool)]
        private static extern bool virtualMIDIGetProcesses(IntPtr port, [Out] ulong[] processIds, ref uint length);

        [DllImport(Library, ExactSpelling = true)]
        [DefaultDllImportSearchPaths(DllImportSearchPath.System32)]
        private static extern IntPtr virtualMIDIGetDriverVersion(out ushort major, out ushort minor, out ushort release, out ushort build);

        public string DriverVersion { get; private set; }

        public MidiPortHost(string[] names)
        {
            if (IntPtr.Size != 8) throw new PlatformNotSupportedException("The MIDI port host requires 64-bit Windows.");
            if (names == null || names.Length != 2 || String.IsNullOrWhiteSpace(names[0]) ||
                String.IsNullOrWhiteSpace(names[1]) || names[0] == names[1])
                throw new ArgumentException("Two distinct MIDI port names are required.");
            callback = Forward;
            ushort major, minor, release, build;
            IntPtr version = virtualMIDIGetDriverVersion(out major, out minor, out release, out build);
            if (version == IntPtr.Zero) throw new InvalidOperationException("The installed virtualMIDI driver did not report its version.");
            DriverVersion = Marshal.PtrToStringUni(version);
            try
            {
                foreach (string name in names)
                {
                    IntPtr port = virtualMIDICreatePortEx2(name, callback, UIntPtr.Zero, 65535, 15);
                    if (port == IntPtr.Zero) throw new Win32Exception(Marshal.GetLastWin32Error(), "Cannot create MIDI port: " + name);
                    ports.Add(port);
                }
            }
            catch
            {
                Dispose();
                throw;
            }
        }

        private void Forward(IntPtr port, IntPtr data, uint length, UIntPtr context)
        {
            if (Interlocked.CompareExchange(ref stopping, 0, 0) != 0) return;
            try
            {
                if (data == IntPtr.Zero || length == 0)
                    throw new InvalidOperationException("The MIDI driver disconnected.");
                if (length > 65535) throw new InvalidOperationException("MIDI packet exceeds the configured limit.");
                if (!virtualMIDISendData(port, data, length))
                    throw new Win32Exception(Marshal.GetLastWin32Error(), "MIDI loopback forwarding failed.");
            }
            catch (Exception error)
            {
                Interlocked.CompareExchange(ref failure, error.Message, null);
                failed.Set();
            }
        }

        public ulong[][] GetClientProcessIds()
        {
            if (Interlocked.CompareExchange(ref stopping, 0, 0) != 0)
                throw new ObjectDisposedException("MidiPortHost");
            ulong[][] result = new ulong[ports.Count][];
            for (int i = 0; i < ports.Count; i++)
            {
                ulong[] processIds = new ulong[17];
                uint bytes = (uint)(processIds.Length * sizeof(ulong));
                if (!virtualMIDIGetProcesses(ports[i], processIds, ref bytes))
                    throw new Win32Exception(Marshal.GetLastWin32Error(), "MIDI client snapshot failed.");
                if (bytes > processIds.Length * sizeof(ulong) || bytes % sizeof(ulong) != 0)
                    throw new InvalidOperationException("MIDI driver returned an invalid client-list length.");
                Array.Resize(ref processIds, (int)(bytes / sizeof(ulong)));
                result[i] = processIds;
            }
            return result;
        }

        public void Wait(EventWaitHandle stop, EventWaitHandle inspection, Action inspect)
        {
            if (stop == null) throw new ArgumentNullException("stop");
            if (inspection == null) throw new ArgumentNullException("inspection");
            if (inspect == null) throw new ArgumentNullException("inspect");
            while (true)
            {
                int signal = WaitHandle.WaitAny(new WaitHandle[] { stop, failed, inspection });
                if (signal == 0) return;
                if (signal == 1) throw new InvalidOperationException(failure ?? "MIDI port host failed.");
                inspect();
            }
        }

        public void Dispose()
        {
            if (Interlocked.Exchange(ref stopping, 1) != 0) return;
            foreach (IntPtr port in ports) virtualMIDIClosePort(port);
            ports.Clear();
            GC.KeepAlive(callback);
            failed.Dispose();
        }
    }
}
