using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Text;

namespace CubaseAiMcp
{
    public static class FactoryProbe
    {
        [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
        private static extern IntPtr LoadLibraryEx(string filename, IntPtr file, uint flags);

        [DllImport("kernel32.dll", CharSet = CharSet.Ansi, ExactSpelling = true, SetLastError = true)]
        private static extern IntPtr GetProcAddress(IntPtr module, string name);

        [DllImport("kernel32.dll", SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        private static extern bool FreeLibrary(IntPtr module);

        [UnmanagedFunctionPointer(CallingConvention.StdCall)]
        [return: MarshalAs(UnmanagedType.I1)]
        private delegate bool ModuleEntry();

        [UnmanagedFunctionPointer(CallingConvention.StdCall)]
        private delegate IntPtr GetFactory();

        [UnmanagedFunctionPointer(CallingConvention.StdCall)]
        private delegate uint ReleaseObject(IntPtr instance);

        [UnmanagedFunctionPointer(CallingConvention.StdCall)]
        private delegate int GetInfo(IntPtr instance, IntPtr info);

        [UnmanagedFunctionPointer(CallingConvention.StdCall)]
        private delegate int CountClasses(IntPtr instance);

        [UnmanagedFunctionPointer(CallingConvention.StdCall)]
        private delegate int GetClassInfo(IntPtr instance, int index, IntPtr info);

        [UnmanagedFunctionPointer(CallingConvention.StdCall)]
        private delegate int CreateInstance(IntPtr instance, IntPtr cid, IntPtr iid, out IntPtr result);

        [UnmanagedFunctionPointer(CallingConvention.StdCall)]
        private delegate int EmptyServiceRequest(IntPtr instance, IntPtr input, IntPtr output, IntPtr status);

        public sealed class ClassRecord
        {
            public string CidBytes;
            public string CidGuid;
            public int Cardinality;
            public string Category;
            public string Name;
        }

        public sealed class Report
        {
            public string Module;
            public string Stage;
            public string Error;
            public string Vendor;
            public int Flags;
            public int ClassCount;
            public bool BusinessObjectsCreated;
            public bool ServiceProbeAttempted;
            public int? ServiceResult;
            public bool EmptyRequestAttempted;
            public int? EmptyRequestResult;
            public int? EmptyRequestStatus;
            public string ServiceIidBytes;
            public ClassRecord ObservedServiceClass;
            public List<string> FactoryMethodRvas = new List<string>();
            public List<string> ServiceMethodRvas = new List<string>();
            public List<ClassRecord> Classes = new List<ClassRecord>();
        }

        private static T Method<T>(IntPtr instance, int slot) where T : class
        {
            IntPtr table = Marshal.ReadIntPtr(instance);
            IntPtr address = Marshal.ReadIntPtr(table, slot * IntPtr.Size);
            if (address == IntPtr.Zero) throw new InvalidOperationException("Null factory method");
            return (T)(object)Marshal.GetDelegateForFunctionPointer(address, typeof(T));
        }

        private static string Text(byte[] data, int offset, int length)
        {
            int end = offset;
            while (end < offset + length && data[end] != 0) end++;
            return Encoding.UTF8.GetString(data, offset, end - offset);
        }

        public static Report Inspect(string filename)
        {
            return InspectCore(filename, false, false);
        }

        public static Report InspectProjectService(string filename)
        {
            if (!String.Equals(System.IO.Path.GetFileName(filename), "projectplugin.dll", StringComparison.OrdinalIgnoreCase))
                throw new ArgumentException("The service probe only accepts the observed project component.");
            return InspectCore(filename, true, false);
        }

        public static Report InspectEmptyProjectRequest(string filename)
        {
            if (!String.Equals(System.IO.Path.GetFileName(filename), "projectplugin.dll", StringComparison.OrdinalIgnoreCase))
                throw new ArgumentException("The request probe only accepts the observed project component.");
            return InspectCore(filename, true, true);
        }

        private static Report InspectCore(string filename, bool probeProjectService, bool probeEmptyRequest)
        {
            if (IntPtr.Size != 8) throw new PlatformNotSupportedException("Requires a 64-bit probe process");
            Report report = new Report { Module = filename, Stage = "load" };
            IntPtr module = IntPtr.Zero;
            IntPtr factory = IntPtr.Zero;
            IntPtr buffer = IntPtr.Zero;
            IntPtr service = IntPtr.Zero;
            IntPtr empty = IntPtr.Zero;
            IntPtr input = IntPtr.Zero;
            IntPtr requestStatus = IntPtr.Zero;
            bool initialized = false;
            try
            {
                module = LoadLibraryEx(filename, IntPtr.Zero, 0x100 | 0x800);
                if (module == IntPtr.Zero) throw new Win32Exception(Marshal.GetLastWin32Error());
                report.Stage = "initialize";
                IntPtr entry = GetProcAddress(module, "InitDll");
                if (entry != IntPtr.Zero)
                {
                    initialized = ((ModuleEntry)Marshal.GetDelegateForFunctionPointer(entry, typeof(ModuleEntry)))();
                    if (!initialized) throw new InvalidOperationException("InitDll returned false");
                }
                report.Stage = "factory";
                IntPtr export = GetProcAddress(module, "GetPluginFactory");
                if (export == IntPtr.Zero) throw new InvalidOperationException("GetPluginFactory is absent");
                factory = ((GetFactory)Marshal.GetDelegateForFunctionPointer(export, typeof(GetFactory)))();
                if (factory == IntPtr.Zero) throw new InvalidOperationException("Factory is null");
                IntPtr table = Marshal.ReadIntPtr(factory);
                for (int slot = 0; slot < 7; slot++)
                    report.FactoryMethodRvas.Add("0x" + (Marshal.ReadIntPtr(table, slot * IntPtr.Size).ToInt64() - module.ToInt64()).ToString("x"));
                report.Stage = "factory-info";
                buffer = Marshal.AllocHGlobal(452);
                if (Method<GetInfo>(factory, 3)(factory, buffer) != 0)
                    throw new InvalidOperationException("getFactoryInfo failed");
                byte[] info = new byte[452];
                Marshal.Copy(buffer, info, 0, info.Length);
                report.Vendor = Text(info, 0, 64);
                report.Flags = BitConverter.ToInt32(info, 448);
                report.ClassCount = Method<CountClasses>(factory, 4)(factory);
                if (report.ClassCount < 0 || report.ClassCount > 256)
                    throw new InvalidOperationException("Factory class count is out of bounds");
                report.Stage = "classes";
                for (int index = 0; index < report.ClassCount; index++)
                {
                    if (Method<GetClassInfo>(factory, 5)(factory, index, buffer) != 0)
                        throw new InvalidOperationException("getClassInfo failed at index " + index);
                    byte[] data = new byte[116];
                    Marshal.Copy(buffer, data, 0, data.Length);
                    byte[] cid = new byte[16];
                    Array.Copy(data, cid, cid.Length);
                    report.Classes.Add(new ClassRecord { CidBytes = BitConverter.ToString(cid).Replace("-", ""),
                        CidGuid = new Guid(cid).ToString(), Cardinality = BitConverter.ToInt32(data, 16),
                        Category = Text(data, 20, 32), Name = Text(data, 52, 64) });
                }
                if (probeProjectService)
                {
                    report.Stage = "observed-class-metadata";
                    if (Method<GetClassInfo>(factory, 5)(factory, 0, buffer) != 0)
                        throw new InvalidOperationException("The observed registered class is not available.");
                    byte[] expectedCid = new byte[] { 0x81, 0x18, 0xfa, 0x7c, 0x4d, 0xe5, 0x50, 0x4e,
                        0x8a, 0x01, 0xde, 0x63, 0xb1, 0x64, 0xf7, 0x42 };
                    byte[] observedCid = new byte[16];
                    Marshal.Copy(buffer, observedCid, 0, observedCid.Length);
                    for (int i = 0; i < expectedCid.Length; i++)
                        if (expectedCid[i] != observedCid[i])
                            throw new InvalidOperationException("The registered class differs from the inspected build.");
                    byte[] observedInfo = new byte[116];
                    Marshal.Copy(buffer, observedInfo, 0, observedInfo.Length);
                    report.ObservedServiceClass = new ClassRecord {
                        CidBytes = BitConverter.ToString(observedCid).Replace("-", ""),
                        CidGuid = new Guid(observedCid).ToString(), Cardinality = BitConverter.ToInt32(observedInfo, 16),
                        Category = Text(observedInfo, 20, 32), Name = Text(observedInfo, 52, 64) };
                    byte[] iid = new byte[] { 0xba, 0x81, 0x0b, 0xe2, 0x39, 0x5d, 0x49, 0x49,
                        0x9c, 0x8e, 0xe9, 0x69, 0x38, 0x72, 0xde, 0xf6 };
                    Marshal.Copy(expectedCid, 0, buffer, expectedCid.Length);
                    Marshal.Copy(iid, 0, IntPtr.Add(buffer, 16), iid.Length);
                    report.ServiceIidBytes = BitConverter.ToString(iid).Replace("-", "");
                    report.Stage = "create-observed-service-interface";
                    report.ServiceProbeAttempted = true;
                    report.ServiceResult = Method<CreateInstance>(factory, 6)(factory, buffer, IntPtr.Add(buffer, 16), out service);
                    if (report.ServiceResult != 0 || service == IntPtr.Zero)
                        throw new InvalidOperationException("The component did not expose the observed service interface.");
                    report.BusinessObjectsCreated = true;
                    IntPtr serviceTable = Marshal.ReadIntPtr(service);
                    for (int slot = 0; slot < 4; slot++)
                        report.ServiceMethodRvas.Add("0x" + (Marshal.ReadIntPtr(serviceTable, slot * IntPtr.Size).ToInt64() - module.ToInt64()).ToString("x"));
                    if (probeEmptyRequest)
                    {
                        if (Marshal.ReadIntPtr(serviceTable, 3 * IntPtr.Size).ToInt64() - module.ToInt64() != 0x11ef0)
                            throw new InvalidOperationException("The service request entry differs from the inspected build.");
                        empty = Marshal.AllocHGlobal(1);
                        input = Marshal.AllocHGlobal(IntPtr.Size);
                        requestStatus = Marshal.AllocHGlobal(sizeof(int));
                        Marshal.WriteByte(empty, 0);
                        Marshal.WriteIntPtr(input, empty);
                        Marshal.WriteInt32(requestStatus, -1);
                        report.Stage = "empty-service-request";
                        report.EmptyRequestAttempted = true;
                        report.EmptyRequestResult = Method<EmptyServiceRequest>(service, 3)(service, input, IntPtr.Zero, requestStatus);
                        report.EmptyRequestStatus = Marshal.ReadInt32(requestStatus);
                        if (report.EmptyRequestResult != 1 || report.EmptyRequestStatus != 4)
                            throw new InvalidOperationException("The empty request returned an unexpected result or status.");
                    }
                }
                report.Stage = "complete";
            }
            catch (Exception error) { report.Error = error.Message; }
            finally
            {
                if (requestStatus != IntPtr.Zero) Marshal.FreeHGlobal(requestStatus);
                if (input != IntPtr.Zero) Marshal.FreeHGlobal(input);
                if (empty != IntPtr.Zero) Marshal.FreeHGlobal(empty);
                if (service != IntPtr.Zero) Method<ReleaseObject>(service, 2)(service);
                if (buffer != IntPtr.Zero) Marshal.FreeHGlobal(buffer);
                if (factory != IntPtr.Zero) Method<ReleaseObject>(factory, 2)(factory);
                if (module != IntPtr.Zero)
                {
                    IntPtr exit = GetProcAddress(module, "ExitDll");
                    if (initialized && exit != IntPtr.Zero)
                        ((ModuleEntry)Marshal.GetDelegateForFunctionPointer(exit, typeof(ModuleEntry)))();
                    FreeLibrary(module);
                }
            }
            return report;
        }
    }
}
