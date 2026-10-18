$ErrorActionPreference = 'Stop'

Add-Type -MemberDefinition '[System.Runtime.InteropServices.DllImport("user32.dll")] public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, System.UIntPtr dwExtraInfo);' -Name TismaMediaKeys -Namespace Tisma

$audioInterop = @'
using System;
using System.Runtime.InteropServices;

namespace TismaAudio {
  enum DataFlow { Render = 0, Capture = 1, All = 2 }
  enum DeviceRole { Console = 0, Multimedia = 1, Communications = 2 }

  [ComImport, Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IMMDeviceEnumerator {
    [PreserveSig] int EnumAudioEndpoints(DataFlow flow, uint stateMask, out IntPtr devices);
    [PreserveSig] int GetDefaultAudioEndpoint(DataFlow flow, DeviceRole role, out IMMDevice device);
    [PreserveSig] int GetDevice([MarshalAs(UnmanagedType.LPWStr)] string id, out IMMDevice device);
    [PreserveSig] int RegisterEndpointNotificationCallback(IntPtr callback);
    [PreserveSig] int UnregisterEndpointNotificationCallback(IntPtr callback);
  }

  [ComImport, Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IMMDevice {
    [PreserveSig] int Activate(ref Guid iid, uint classContext, IntPtr activationParams, [MarshalAs(UnmanagedType.IUnknown)] out object instance);
    [PreserveSig] int OpenPropertyStore(uint access, out IntPtr properties);
    [PreserveSig] int GetId(out IntPtr id);
    [PreserveSig] int GetState(out uint state);
  }

  [ComImport, Guid("5CDF2C82-841E-4546-9722-0CF74078229A"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IAudioEndpointVolume {
    [PreserveSig] int RegisterControlChangeNotify(IntPtr notify);
    [PreserveSig] int UnregisterControlChangeNotify(IntPtr notify);
    [PreserveSig] int GetChannelCount(out uint channelCount);
    [PreserveSig] int SetMasterVolumeLevel(float level, ref Guid eventContext);
    [PreserveSig] int SetMasterVolumeLevelScalar(float level, ref Guid eventContext);
    [PreserveSig] int GetMasterVolumeLevel(out float level);
    [PreserveSig] int GetMasterVolumeLevelScalar(out float level);
    [PreserveSig] int SetChannelVolumeLevel(uint channel, float level, ref Guid eventContext);
    [PreserveSig] int SetChannelVolumeLevelScalar(uint channel, float level, ref Guid eventContext);
    [PreserveSig] int GetChannelVolumeLevel(uint channel, out float level);
    [PreserveSig] int GetChannelVolumeLevelScalar(uint channel, out float level);
    [PreserveSig] int SetMute([MarshalAs(UnmanagedType.Bool)] bool mute, ref Guid eventContext);
    [PreserveSig] int GetMute([MarshalAs(UnmanagedType.Bool)] out bool mute);
    [PreserveSig] int GetVolumeStepInfo(out uint step, out uint stepCount);
    [PreserveSig] int VolumeStepUp(ref Guid eventContext);
    [PreserveSig] int VolumeStepDown(ref Guid eventContext);
    [PreserveSig] int QueryHardwareSupport(out uint hardwareSupportMask);
    [PreserveSig] int GetVolumeRange(out float minimum, out float maximum, out float increment);
  }

  [ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E"), ClassInterface(ClassInterfaceType.None)]
  class MMDeviceEnumeratorClass { }

  public static class Endpoint {
    static IAudioEndpointVolume endpoint;
    static IAudioEndpointVolume GetEndpoint() {
      if (endpoint != null) return endpoint;
      IMMDeviceEnumerator enumerator = (IMMDeviceEnumerator)new MMDeviceEnumeratorClass();
      IMMDevice device;
      Marshal.ThrowExceptionForHR(enumerator.GetDefaultAudioEndpoint(DataFlow.Render, DeviceRole.Multimedia, out device));
      Guid iid = typeof(IAudioEndpointVolume).GUID;
      object instance;
      Marshal.ThrowExceptionForHR(device.Activate(ref iid, 23, IntPtr.Zero, out instance));
      endpoint = (IAudioEndpointVolume)instance;
      return endpoint;
    }
    public static float GetLevel() {
      float value; Marshal.ThrowExceptionForHR(GetEndpoint().GetMasterVolumeLevelScalar(out value)); return value;
    }
    public static bool GetMuted() {
      bool value; Marshal.ThrowExceptionForHR(GetEndpoint().GetMute(out value)); return value;
    }
    public static void SetLevel(float value) {
      value = Math.Max(0f, Math.Min(1f, value)); Guid context = Guid.Empty;
      Marshal.ThrowExceptionForHR(GetEndpoint().SetMasterVolumeLevelScalar(value, ref context));
    }
    public static void ToggleMute() {
      bool current = GetMuted(); Guid context = Guid.Empty;
      Marshal.ThrowExceptionForHR(GetEndpoint().SetMute(!current, ref context));
    }
  }
}
'@

Add-Type -TypeDefinition $audioInterop -Language CSharp

$keyCodes = @{ previous = 0xB1; playPause = 0xB3; next = 0xB0 }

function Send-VolumeState {
  try {
    $state = @{ type = 'volume'; level = [int][Math]::Round([TismaAudio.Endpoint]::GetLevel() * 100); muted = [TismaAudio.Endpoint]::GetMuted() }
  } catch {
    $state = @{ type = 'volume'; unavailable = $true; message = $_.Exception.Message }
  }
  [Console]::Out.WriteLine(($state | ConvertTo-Json -Compress))
}

Send-VolumeState
while ($null -ne ($line = [Console]::In.ReadLine())) {
  if ($keyCodes.ContainsKey($line)) {
    $virtualKey = $keyCodes[$line]
    [Tisma.TismaMediaKeys]::keybd_event($virtualKey, 0, 0, [UIntPtr]::Zero)
    [Tisma.TismaMediaKeys]::keybd_event($virtualKey, 0, 2, [UIntPtr]::Zero)
    continue
  }
  try {
    $request = $line | ConvertFrom-Json
    switch ($request.command) {
      'volume:set' { [TismaAudio.Endpoint]::SetLevel([float]$request.value); Send-VolumeState }
      'volume:toggle-mute' { [TismaAudio.Endpoint]::ToggleMute(); Send-VolumeState }
      'volume:get' { Send-VolumeState }
    }
  } catch {
    [Console]::Out.WriteLine((@{ type = 'volume'; unavailable = $true; message = $_.Exception.Message } | ConvertTo-Json -Compress))
  }
}
