import { spawnSync } from "node:child_process";

export type FolderPickerSpec = {
  cmd: string;
  args: readonly string[];
};

const WINDOWS_DIRECTORY_PICKER_SCRIPT =
  "$ErrorActionPreference = 'Stop'; Add-Type -AssemblyName System.Windows.Forms; $dialog = New-Object System.Windows.Forms.FolderBrowserDialog; $dialog.Description = 'Select a project folder'; $dialog.ShowNewFolderButton = $true; if ($dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) { [Console]::Out.Write($dialog.SelectedPath) }";

export function folderPickerSpec(platform: string): FolderPickerSpec {
  if (platform === "win32") {
    return {
      cmd: "powershell.exe",
      args: [
        "-NoProfile",
        "-ExecutionPolicy",
        "Bypass",
        "-STA",
        "-Command",
        WINDOWS_DIRECTORY_PICKER_SCRIPT,
      ],
    };
  }
  if (platform === "darwin") {
    return {
      cmd: "osascript",
      args: ["-e", 'POSIX path of (choose folder with prompt "Select a project folder")'],
    };
  }
  return {
    cmd: "zenity",
    args: ["--file-selection", "--directory", "--title=Select project folder"],
  };
}

export function parseFolderPickerStdout(stdout: string): string | null {
  const trimmed = stdout.trim();
  if (trimmed.length === 0) {
    return null;
  }
  return trimmed;
}

export function pickFolderPath(platform: string): string | null {
  const spec = folderPickerSpec(platform);
  const args: string[] = [];
  for (const arg of spec.args) {
    args.push(arg);
  }
  const result = spawnSync(spec.cmd, args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  if (result.error !== undefined) {
    throw result.error;
  }
  if (result.status !== 0) {
    return null;
  }
  return parseFolderPickerStdout(result.stdout);
}
