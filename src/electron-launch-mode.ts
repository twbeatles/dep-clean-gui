export interface LaunchModeInput {
  argv: string[];
  wasOpenedAtLogin: boolean;
}

export function shouldLaunchToTray(input: LaunchModeInput): boolean {
  return input.argv.includes('--launch-tray') || input.wasOpenedAtLogin;
}
