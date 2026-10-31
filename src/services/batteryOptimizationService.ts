import { Platform, Linking } from 'react-native';
import * as Notifications from 'expo-notifications';
import { nativeAlarmService } from './nativeAlarmService';
import type { NativeRecoveryReport } from './nativeAlarmService';

export interface OEMStep {
  title: string;
  description: string;
}

export interface OEMGuide {
  id: string;
  name: string;
  subname: string;
  description: string;
  badgeColor: string;
  steps: OEMStep[];
}

export interface ReliabilityStatus {
  notificationPermission: boolean;
  isIgnoringBatteryOptimizations: boolean;
  canScheduleExactAlarms: boolean;
  canUseFullScreenIntent: boolean;
  manufacturer: string;
  detectedOemId: string;
  androidVersion?: number;
  isOptimal: boolean;
  lastRecoveryReport: NativeRecoveryReport | null;
}

export const OEM_GUIDES: OEMGuide[] = [
  {
    id: 'samsung',
    name: 'Samsung',
    subname: 'OneUI',
    description: 'Samsung OneUI puts inactive apps into Deep Sleep, cancelling scheduled alarms.',
    badgeColor: '#1259D3',
    steps: [
      {
        title: '1. Set Battery to Unrestricted',
        description:
          'Go to Settings > Apps > HealthMate > Battery and choose "Unrestricted" (not Optimized).',
      },
      {
        title: '2. Prevent Auto-Sleeping',
        description:
          'Go to Settings > Battery > Background usage limits > Never auto-sleeping apps and add HealthMate.',
      },
      {
        title: '3. Allow Exact Alarms',
        description: 'Ensure Alarms & Reminders is enabled under App Info > Alarms & Reminders.',
      },
    ],
  },
  {
    id: 'xiaomi',
    name: 'Xiaomi / Redmi / Poco',
    subname: 'MIUI / HyperOS',
    description:
      'MIUI aggressively terminates background processes unless Autostart and No Restrictions are enabled.',
    badgeColor: '#FF6900',
    steps: [
      {
        title: '1. Enable Autostart',
        description:
          'Open Security app (or Settings) > Manage Apps > HealthMate > Toggle ON "Autostart".',
      },
      {
        title: '2. Disable Battery Restrictions',
        description:
          'In the same app info screen, tap "Battery Saver" and select "No restrictions".',
      },
      {
        title: '3. Lock App in Recent Apps',
        description:
          'Open recent apps view, long-press HealthMate, and tap the padlock icon so it is never cleared.',
      },
    ],
  },
  {
    id: 'huawei',
    name: 'Huawei / Honor',
    subname: 'EMUI / MagicOS',
    description: 'EMUI kills services aggressively to save battery life during standby.',
    badgeColor: '#CF0A2C',
    steps: [
      {
        title: '1. Manual App Launch',
        description:
          'Go to Settings > Battery > App Launch. Find HealthMate, switch from "Manage automatically" to "Manage manually".',
      },
      {
        title: '2. Allow Background Activity',
        description: 'Enable "Auto-launch", "Secondary launch", and "Run in background".',
      },
      {
        title: '3. Exclude from Battery Optimization',
        description:
          'Go to Settings > Apps > Special access > Battery optimization > Select "All apps" > HealthMate > "Don\'t allow".',
      },
    ],
  },
  {
    id: 'oppo_oneplus',
    name: 'Oppo / OnePlus / Realme',
    subname: 'ColorOS / OxygenOS',
    description:
      'ColorOS restricts background alarms unless background activity and auto-launch permissions are granted.',
    badgeColor: '#00875A',
    steps: [
      {
        title: '1. Allow Background Activity',
        description:
          'Go to Settings > Apps > HealthMate > Battery usage > Turn ON "Allow background activity".',
      },
      {
        title: '2. Allow Auto-Launch',
        description: 'Turn ON "Allow auto-launch" and "Allow foreground activities".',
      },
      {
        title: '3. Turn Off Sleep Optimization',
        description:
          'Go to Settings > Battery > More settings > Optimize battery use > HealthMate > Select "Don\'t optimize".',
      },
    ],
  },
  {
    id: 'vivo',
    name: 'Vivo / iQOO',
    subname: 'FuntouchOS / OriginOS',
    description: 'FuntouchOS limits high background power usage unless explicitly permitted.',
    badgeColor: '#415FFF',
    steps: [
      {
        title: '1. High Background Power Usage',
        description:
          'Go to Settings > Battery > Background power consumption management > HealthMate > Select "High background power usage".',
      },
      {
        title: '2. Enable Autostart',
        description:
          'Go to Settings > More Settings > Applications > Autostart > Enable HealthMate.',
      },
    ],
  },
  {
    id: 'stock',
    name: 'Google Pixel / Stock Android / Motorola',
    subname: 'Pure Android',
    description:
      'Standard Android Doze mode can defer notifications unless unrestricted battery is selected.',
    badgeColor: '#34A853',
    steps: [
      {
        title: '1. Set App Battery to Unrestricted',
        description:
          'Go to Settings > Apps > HealthMate > App battery usage > Select "Unrestricted".',
      },
      {
        title: '2. Allow Alarms & Reminders',
        description:
          'Go to Settings > Apps > HealthMate > Alarms & reminders > Toggle ON "Allow setting alarms".',
      },
    ],
  },
];

export function mapManufacturerToOemId(manufacturer: string): string {
  const mfr = manufacturer.toLowerCase();
  if (mfr.includes('samsung')) return 'samsung';
  if (mfr.includes('xiaomi') || mfr.includes('redmi') || mfr.includes('poco')) return 'xiaomi';
  if (mfr.includes('huawei') || mfr.includes('honor')) return 'huawei';
  if (mfr.includes('oppo') || mfr.includes('oneplus') || mfr.includes('realme'))
    return 'oppo_oneplus';
  if (mfr.includes('vivo') || mfr.includes('iqoo')) return 'vivo';
  return 'stock';
}

export const batteryOptimizationService = {
  async getReliabilityStatus(): Promise<ReliabilityStatus> {
    if (Platform.OS !== 'android') {
      return {
        notificationPermission: true,
        isIgnoringBatteryOptimizations: true,
        canScheduleExactAlarms: true,
        canUseFullScreenIntent: true,
        manufacturer: 'apple_or_web',
        detectedOemId: 'stock',
        isOptimal: true,
        lastRecoveryReport: null,
      };
    }

    try {
      const [
        notificationPermission,
        isIgnoring,
        canExact,
        canFullScreen,
        mfr,
        lastRecoveryReport,
      ] =
        await Promise.all([
          Notifications.getPermissionsAsync().then(
            (permission) => Boolean(permission.granted || permission.status === 'granted'),
          ),
          nativeAlarmService.isIgnoringBatteryOptimizations(),
          nativeAlarmService.canScheduleExactAlarms(),
          nativeAlarmService.canUseFullScreenIntent(),
          nativeAlarmService.getDeviceManufacturer(),
          nativeAlarmService.getLastRecoveryReport(),
        ]);

      const detectedOemId = mapManufacturerToOemId(mfr);
      const isOptimal = notificationPermission && isIgnoring && canExact && canFullScreen;
      const androidVersion =
        typeof Platform.Version === 'number'
          ? Platform.Version
          : parseInt(String(Platform.Version), 10) || 0;

      return {
        notificationPermission,
        isIgnoringBatteryOptimizations: isIgnoring,
        canScheduleExactAlarms: canExact,
        canUseFullScreenIntent: canFullScreen,
        manufacturer: mfr,
        detectedOemId,
        androidVersion,
        isOptimal,
        lastRecoveryReport,
      };
    } catch (e) {
      console.warn('getReliabilityStatus failed:', e);
      return {
        notificationPermission: false,
        isIgnoringBatteryOptimizations: false,
        canScheduleExactAlarms: false,
        canUseFullScreenIntent: false,
        manufacturer: 'unknown',
        detectedOemId: 'stock',
        isOptimal: false,
        lastRecoveryReport: null,
      };
    }
  },

  async triggerRecovery(): Promise<NativeRecoveryReport | null> {
    return nativeAlarmService.triggerRecovery();
  },

  async requestIgnoreBatteryOptimizations(): Promise<boolean> {
    if (Platform.OS !== 'android') return true;
    try {
      return await nativeAlarmService.requestIgnoreBatteryOptimizations();
    } catch {
      await Linking.openSettings();
      return false;
    }
  },

  async openExactAlarmSettings(): Promise<boolean> {
    if (Platform.OS !== 'android') return true;
    try {
      return await nativeAlarmService.openExactAlarmSettings();
    } catch {
      await Linking.openSettings();
      return false;
    }
  },

  async openFullScreenIntentSettings(): Promise<boolean> {
    if (Platform.OS !== 'android') return true;
    try {
      return await nativeAlarmService.openFullScreenIntentSettings();
    } catch {
      await Linking.openSettings();
      return false;
    }
  },

  async openAppBatterySettings(): Promise<boolean> {
    if (Platform.OS !== 'android') {
      await Linking.openSettings();
      return true;
    }
    try {
      return await nativeAlarmService.openAppBatterySettings();
    } catch {
      await Linking.openSettings();
      return false;
    }
  },

  async openOemAutoStartSettings(): Promise<boolean> {
    if (Platform.OS !== 'android') {
      await Linking.openSettings();
      return true;
    }
    try {
      return await nativeAlarmService.openOemAutoStartSettings();
    } catch {
      await Linking.openSettings();
      return false;
    }
  },

  getGuides(): OEMGuide[] {
    return OEM_GUIDES;
  },

  getGuideById(id: string): OEMGuide {
    return OEM_GUIDES.find((g) => g.id === id) || OEM_GUIDES[OEM_GUIDES.length - 1];
  },
};
