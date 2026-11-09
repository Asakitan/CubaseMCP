[CmdletBinding()]
param([Parameter(Mandatory=$true)][ValidateRange(1,2147483647)][int]$TargetProcessId)
$ErrorActionPreference='Stop'
$result=[ordered]@{pid=$TargetProcessId;timestampUtc=[DateTime]::UtcNow.ToString('o');status='error';error=$null;project=$null;root=$null;rootF8=$null;rootF8Vtable=$null;tempoSubobjectVtable=$null;stable=$false;limitation='Unpinned point-in-time read; does not establish active arrangement, object lifetime or thread safety.'}
$src=@'
using System; using System.ComponentModel; using System.Runtime.InteropServices;
public static class DawRootFieldReader {
 [DllImport("kernel32.dll",SetLastError=true)] static extern IntPtr OpenProcess(uint a,bool i,int pid);
 [DllImport("kernel32.dll",SetLastError=true)] static extern bool ReadProcessMemory(IntPtr p,IntPtr a,byte[] b,int n,out IntPtr got);
 [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr h);
 static ulong Q(IntPtr p,ulong a){var b=new byte[8];IntPtr n;if(a==0||!ReadProcessMemory(p,(IntPtr)(long)a,b,8,out n)||n.ToInt64()!=8)throw new Win32Exception(Marshal.GetLastWin32Error(),"ReadProcessMemory");return BitConverter.ToUInt64(b,0);}
 public static string[] Read(int pid){const ulong b=0x140000000;var p=OpenProcess(0x410,false,pid);if(p==IntPtr.Zero)throw new Win32Exception(Marshal.GetLastWin32Error(),"OpenProcess");try{ulong g=Q(p,b+0x59110d0);if(g==0||Q(p,g)!=b+0x447d378)throw new InvalidOperationException("MProject vtable mismatch");ulong root=Q(p,g+0xf8);if(root==0||Q(p,root)!=b+0x4471c40||Q(p,root+0x98)!=b+0x4472130)throw new InvalidOperationException("MRoot vtable mismatch");ulong child=Q(p,root+0xf8),vt=child==0?0:Q(p,child),sub=0;if(vt==b+0x4475ca8){sub=Q(p,child+0x1a8);if(sub!=b+0x4476318)throw new InvalidOperationException("tempo subobject vtable mismatch");}if(Q(p,b+0x59110d0)!=g||Q(p,g)!=b+0x447d378||Q(p,g+0xf8)!=root||Q(p,root)!=b+0x4471c40||Q(p,root+0x98)!=b+0x4472130||Q(p,root+0xf8)!=child||(child!=0&&Q(p,child)!=vt)||(sub!=0&&Q(p,child+0x1a8)!=sub))throw new InvalidOperationException("snapshot changed");return new[]{"0x"+g.ToString("x"),"0x"+root.ToString("x"),"0x"+child.ToString("x"),child==0?null:"0x"+vt.ToString("x"),sub==0?null:"0x"+sub.ToString("x")};}finally{CloseHandle(p);}}
}
'@
try {
 $before=Get-Process -Id $TargetProcessId;$start=$before.StartTime.ToUniversalTime()
 $guardJson=& (Join-Path $PSScriptRoot 'Read-DawprojectHostContext.ps1') -TargetProcessId $TargetProcessId
 $guard=$guardJson|ConvertFrom-Json;if($guard.status -ne 'observed' -or -not $guard.stable){throw 'Host context snapshot not stable.'}
 Add-Type -TypeDefinition $src;$v=[DawRootFieldReader]::Read($TargetProcessId)
 if($v[0] -ne $guard.project -or $v[1] -ne $guard.context){throw 'Project or root changed between validations.'}
 if((Get-Process -Id $TargetProcessId).StartTime.ToUniversalTime() -ne $start){throw 'Process changed.'}
 $result.project=$v[0];$result.root=$v[1];$result.rootF8=$v[2];$result.rootF8Vtable=$v[3];$result.tempoSubobjectVtable=$v[4];$result.stable=$true;$result.status='observed'
}catch{$result.error=$_.Exception.Message}
$result|ConvertTo-Json -Depth 4
if($result.status -ne 'observed'){exit 1}
