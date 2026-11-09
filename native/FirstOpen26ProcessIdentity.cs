using System;
using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Text;

namespace CubaseAiMcp {
 public static class FirstOpen26ProcessIdentity {
  [StructLayout(LayoutKind.Sequential,CharSet=CharSet.Unicode)] struct Entry {
   public uint Size,Usage,ProcessId; public UIntPtr DefaultHeap; public uint ModuleId,Threads,ParentId; public int Priority; public uint Flags;
   [MarshalAs(UnmanagedType.ByValTStr,SizeConst=260)] public string Exe;
  }
  [DllImport("kernel32.dll",SetLastError=true)] static extern IntPtr CreateToolhelp32Snapshot(uint flags,uint pid);
  [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern bool Process32FirstW(IntPtr snapshot,ref Entry entry);
  [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern bool Process32NextW(IntPtr snapshot,ref Entry entry);
  [DllImport("kernel32.dll",SetLastError=true)] static extern bool CloseHandle(IntPtr h);
  [DllImport("kernel32.dll",SetLastError=true)] static extern uint GetProcessId(IntPtr h);
  [DllImport("kernel32.dll",SetLastError=true)] static extern bool GetProcessTimes(IntPtr h,out long creation,out long exit,out long kernel,out long user);
  [DllImport("kernel32.dll")] static extern uint WaitForSingleObject(IntPtr h,uint milliseconds);
  [DllImport("ntdll.dll")] static extern int NtQueryInformationProcess(IntPtr process,int kind,IntPtr buffer,int length,out int returned);
  static void Check(IntPtr h,int pid,long creation) {
   long c,e,k,u;
   if(h==IntPtr.Zero || pid<=0 || GetProcessId(h)!=(uint)pid || !GetProcessTimes(h,out c,out e,out k,out u) || c!=creation || WaitForSingleObject(h,0)!=0x102) throw new InvalidOperationException("Process identity changed or exited.");
  }
  static uint Parent(int pid) {
   IntPtr snapshot=CreateToolhelp32Snapshot(2,0);
   if(snapshot==new IntPtr(-1)) throw new Win32Exception(Marshal.GetLastWin32Error());
   try {
    Entry e=new Entry(); e.Size=(uint)Marshal.SizeOf(typeof(Entry));
    if(!Process32FirstW(snapshot,ref e)) throw new Win32Exception(Marshal.GetLastWin32Error());
    do {if(e.ProcessId==(uint)pid)return e.ParentId;} while(Process32NextW(snapshot,ref e));
    throw new InvalidOperationException("Process missing from snapshot.");
   } finally {CloseHandle(snapshot);}
  }
  static string Command(IntPtr h) {
   const int capacity=65536;
   IntPtr buffer=Marshal.AllocHGlobal(capacity);
   try {
    int returned; int status=NtQueryInformationProcess(h,60,buffer,capacity,out returned);
    if(status!=0 || returned<16 || returned>capacity) throw new InvalidOperationException("Command line query failed or returned an invalid length.");
    int length=unchecked((ushort)Marshal.ReadInt16(buffer,0)); int maximum=unchecked((ushort)Marshal.ReadInt16(buffer,2));
    IntPtr text=Marshal.ReadIntPtr(buffer,IntPtr.Size==8?8:4);
    long start=buffer.ToInt64(), address=text.ToInt64(), end=checked(start+returned);
    if((length&1)!=0 || maximum<length || address<start || address>end || (long)length>end-address) throw new InvalidOperationException("Command line buffer is invalid.");
    return length==0 ? String.Empty : Marshal.PtrToStringUni(text,length/2);
   } finally {Marshal.FreeHGlobal(buffer);}
  }
  public sealed class Result {public int ProcessId; public uint ParentProcessId; public string CommandLine;}
  public static Result Read(IntPtr process,int pid,long creation) {
   Check(process,pid,creation); uint p1=Parent(pid); string c1=Command(process);
   Check(process,pid,creation); uint p2=Parent(pid); string c2=Command(process); Check(process,pid,creation);
   if(p1!=p2 || !String.Equals(c1,c2,StringComparison.Ordinal)) throw new InvalidOperationException("Process identity sample changed.");
   return new Result{ProcessId=pid,ParentProcessId=p1,CommandLine=c1};
  }
 }
}
