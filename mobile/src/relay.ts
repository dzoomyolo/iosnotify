import { NativeModules } from 'react-native';

export type InstalledApp = {
  packageName: string;
  label: string;
};

export type RelaySettings = {
  baseUrl: string;
  apiKey: string;
  forwardNotifications: boolean;
  forwardSms: boolean;
  forwardCalls: boolean;
  packages: string[];
};

export type PermissionState = {
  sms: boolean;
  calls: boolean;
  notifications: boolean;
  listener: boolean;
  batteryIgnored: boolean;
  queuedEvents: number;
};

export type AppVersion = {
  version: string;
  versionCode: number;
};

type RelayNative = {
  getAppVersion: () => Promise<AppVersion>;
  getInstalledApps: () => Promise<InstalledApp[]>;
  getSettings: () => Promise<RelaySettings>;
  saveSettings: (settings: RelaySettings) => Promise<string>;
  getPermissionState: () => Promise<PermissionState>;
  openNotificationListenerSettings: () => void;
  openBatterySettings: () => void;
  openAppSettings: () => void;
  sendTest: () => Promise<boolean>;
  startKeeper: () => void;
  flushQueue: () => void;
};

export const relay = NativeModules.Relay as RelayNative | undefined;
