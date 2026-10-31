import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  StyleSheet,
  View,
  Text,
  Animated,
  Vibration,
  Platform,
  useColorScheme,
  TouchableOpacity,
  ScrollView,
  BackHandler,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { nativeAlarmService } from '../services/nativeAlarmService';
import { adherenceRepository } from '../database/repositories/adherenceRepository';
import { scheduleRepository } from '../database/repositories/scheduleRepository';
import { medicineRepository } from '../database/repositories/medicineRepository';
import { useAppStore } from '../store/appStore';
import { Colors } from '../theme/colors';
import { Radius, Shadows, Spacing } from '../theme/tokens';

export interface ActiveDoseItem {
  id: string;
  scheduleId: string;
  medicineId: string;
  medicineName: string;
  amount: string;
  doseTime: string;
  doseLabel: string;
  dosageForm?: string;
  instanceId?: string;
  sourceScheduleId?: string;
  status: 'pending' | 'taken' | 'snoozed' | 'skipped';
}

function resolveDoseItem(
  scheduleId: string,
  sourceScheduleId?: string,
  medicineName?: string,
  amount?: string,
  doseTime?: string,
  doseLabel?: string,
  instanceId?: string,
): ActiveDoseItem {
  const sId = sourceScheduleId || scheduleId || '';
  let mName = medicineName ?? 'Medication';
  let amt = amount ?? '1 dose';
  let dTime = doseTime ?? '';
  let dLabel = doseLabel ?? '';
  let mId = '';
  let dForm = '';

  if (sId) {
    const sched = scheduleRepository.getById(sId);
    if (sched) {
      mId = sched.medicineId;
      const med = medicineRepository.getById(sched.medicineId);
      if (med) {
        mName = med.name;
        dForm = med.dosageForm || '';
        if (med.strength) amt = `${med.strength} · ${amt}`;
      }
      if (!dTime && sched.times.length > 0) {
        dTime = sched.times[0].time;
        dLabel = sched.times[0].label ?? dLabel;
      }
    }
  }

  if (!mId && mName) {
    const matched = medicineRepository
      .getAll()
      .find((m) => m.name.toLowerCase() === mName.toLowerCase());
    if (matched) {
      mId = matched.id;
      if (!dForm) dForm = matched.dosageForm || '';
    }
  }

  const id = `${sId || mId || mName}_${dTime || '00:00'}_${instanceId || ''}`;

  return {
    id,
    scheduleId: sId,
    medicineId: mId,
    medicineName: mName,
    amount: amt,
    doseTime: dTime,
    doseLabel: dLabel,
    dosageForm: dForm,
    instanceId,
    sourceScheduleId,
    status: 'pending',
  };
}

export default function FullScreenAlarmScreen() {
  const router = useRouter();
  const colorScheme = useColorScheme();
  const isDark = colorScheme === 'dark';

  const params = useLocalSearchParams<{
    scheduleId?: string;
    medicineName?: string;
    amount?: string;
    time?: string;
    label?: string;
    instanceId?: string;
    sourceScheduleId?: string;
  }>();

  const { preferences } = useAppStore();
  const snoozeMinutes = preferences?.snoozeIntervalMinutes || 10;

  const [completedAction, setCompletedAction] = useState<'taken' | 'snooze' | 'skipped' | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState<boolean>(false);

  // Initialize initial dose from query parameters
  const initialDose = useMemo(() => {
    return resolveDoseItem(
      params.scheduleId || '',
      params.sourceScheduleId,
      params.medicineName,
      params.amount,
      params.time,
      params.label,
      params.instanceId,
    );
  }, [
    params.scheduleId,
    params.sourceScheduleId,
    params.medicineName,
    params.amount,
    params.time,
    params.label,
    params.instanceId,
  ]);

  const [doses, setDoses] = useState<ActiveDoseItem[]>([initialDose]);
  const [selectedIndex, setSelectedIndex] = useState<number>(0);

  // Animation values
  const [chimeScale] = useState(() => new Animated.Value(1));

  // Scoped lockscreen window overlap & back button trapping
  useEffect(() => {
    void nativeAlarmService.setLockScreenOverlap(true);

    const backHandler = BackHandler.addEventListener('hardwareBackPress', () => {
      // Prevent backing into the app or leaving without action while device is locked
      return true;
    });

    return () => {
      backHandler.remove();
      void nativeAlarmService.setLockScreenOverlap(false);
    };
  }, []);

  // Discover and aggregate simultaneous doses
  useEffect(() => {
    let isMounted = true;

    async function loadSimultaneousDoses() {
      const now = new Date();
      const todayStr = [
        now.getFullYear(),
        String(now.getMonth() + 1).padStart(2, '0'),
        String(now.getDate()).padStart(2, '0'),
      ].join('-');

      const doseMap = new Map<string, ActiveDoseItem>();
      doseMap.set(initialDose.id, initialDose);

      // 1. Fetch from active native alarms (AlarmService ringing alarms)
      try {
        const nativeAlarms = await nativeAlarmService.getActiveAlarms();
        for (const na of nativeAlarms) {
          const item = resolveDoseItem(
            na.scheduleId,
            na.sourceScheduleId,
            na.medicineName,
            na.amount,
            na.time,
            na.label,
            na.instanceId,
          );
          if (!doseMap.has(item.id)) {
            doseMap.set(item.id, item);
          }
        }
      } catch (_e) {}

      // 2. Fetch from adherence repository for today at initialDose.doseTime
      if (initialDose.doseTime) {
        try {
          const todayDoses = adherenceRepository.getDosesForDate(todayStr);
          for (const td of todayDoses) {
            if (
              td.time === initialDose.doseTime &&
              td.status !== 'taken' &&
              td.status !== 'skipped'
            ) {
              const item = resolveDoseItem(
                td.scheduleId,
                undefined,
                td.medicineName,
                td.amount,
                td.time,
                undefined,
                undefined,
              );
              if (!doseMap.has(item.id)) {
                doseMap.set(item.id, item);
              }
            }
          }
        } catch (_e) {}
      }

      if (isMounted) {
        setDoses(Array.from(doseMap.values()));
      }
    }

    loadSimultaneousDoses();

    return () => {
      isMounted = false;
    };
  }, [initialDose]);

  const currentDose = doses[selectedIndex] || doses[0];
  const pendingDoses = useMemo(() => doses.filter((d) => d.status === 'pending'), [doses]);

  // Subtle breathing pulse on the primary action button
  useEffect(() => {
    const pulseAnim = Animated.loop(
      Animated.sequence([
        Animated.timing(chimeScale, {
          toValue: 1.05,
          duration: 1200,
          useNativeDriver: true,
        }),
        Animated.timing(chimeScale, {
          toValue: 1,
          duration: 1200,
          useNativeDriver: true,
        }),
      ]),
    );

    pulseAnim.start();

    return () => {
      pulseAnim.stop();
    };
  }, [chimeScale]);

  // Action: Take Dose
  const executeTakeDose = useCallback(async () => {
    if (isProcessing || !currentDose) return;
    setIsProcessing(true);
    setErrorMessage(null);

    try {
      Vibration.vibrate(Platform.OS === 'android' ? [0, 60, 40, 60] : 100);

      // Stop only this specific dose alarm natively, preserving remaining active doses
      await nativeAlarmService.stopAlarm(currentDose.scheduleId, currentDose.doseTime);
      if (currentDose.scheduleId) {
        await nativeAlarmService.cancelSnoozesForSchedule(currentDose.scheduleId);
      }

      // Record dose adherence log independently for this specific medication
      if (currentDose.scheduleId && currentDose.medicineId) {
        const now = new Date();
        const todayStr = [
          now.getFullYear(),
          String(now.getMonth() + 1).padStart(2, '0'),
          String(now.getDate()).padStart(2, '0'),
        ].join('-');

        const targetTime =
          currentDose.doseTime ||
          `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

        try {
          adherenceRepository.logDoseStatus(
            currentDose.scheduleId,
            currentDose.medicineId,
            todayStr,
            targetTime,
            'taken',
          );
        } catch (logErr) {
          console.warn('Could not record dose adherence log:', logErr);
        }
      }

      const updated = doses.map((d) =>
        d.id === currentDose.id ? { ...d, status: 'taken' as const } : d,
      );
      setDoses(updated);

      const remainingPending = updated.filter((d) => d.status === 'pending');
      if (remainingPending.length > 0) {
        const nextIdx = updated.findIndex((d) => d.status === 'pending');
        setSelectedIndex(nextIdx);
        setToastMessage(`${currentDose.medicineName} recorded as taken`);
        setTimeout(() => setToastMessage(null), 2500);
        setIsProcessing(false);
      } else {
        // All simultaneous doses completed
        setCompletedAction('taken');
        await nativeAlarmService.setLockScreenOverlap(false);
        await nativeAlarmService.stopAlarm();
        setTimeout(() => {
          router.replace('/(tabs)/home');
        }, 750);
      }
    } catch (e) {
      console.warn('Failed to record taken dose:', e);
      setErrorMessage('Could not complete action. Please try again.');
      setIsProcessing(false);
    }
  }, [isProcessing, currentDose, doses, router]);

  // Action: Snooze Alarm
  const executeSnooze = useCallback(async () => {
    if (isProcessing || !currentDose) return;
    setIsProcessing(true);
    setErrorMessage(null);

    try {
      Vibration.vibrate(Platform.OS === 'android' ? [0, 40, 40, 80] : 100);
      const snoozeResult = await nativeAlarmService.snoozeAlarm({
        scheduleId: currentDose.scheduleId,
        instanceId: currentDose.instanceId || `${currentDose.scheduleId}:${currentDose.doseTime}`,
        medicineName: currentDose.medicineName,
        amount: currentDose.amount,
        time: currentDose.doseTime,
        label: currentDose.doseLabel,
        minutes: snoozeMinutes,
      });

      if (!snoozeResult.success || !snoozeResult.data || snoozeResult.data <= Date.now()) {
        const errorMsg =
          snoozeResult.error?.code === 'exact_alarm_denied'
            ? 'Alarm permission missing. Cannot snooze.'
            : 'Could not snooze alarm. Please try again.';
        throw new Error(errorMsg);
      }

      await nativeAlarmService.stopAlarm(currentDose.scheduleId, currentDose.doseTime);

      const updated = doses.map((d) =>
        d.id === currentDose.id ? { ...d, status: 'snoozed' as const } : d,
      );
      setDoses(updated);

      const remainingPending = updated.filter((d) => d.status === 'pending');
      if (remainingPending.length > 0) {
        const nextIdx = updated.findIndex((d) => d.status === 'pending');
        setSelectedIndex(nextIdx);
        setToastMessage(`${currentDose.medicineName} snoozed for ${snoozeMinutes}m`);
        setTimeout(() => setToastMessage(null), 2500);
        setIsProcessing(false);
      } else {
        setCompletedAction('snooze');
        await nativeAlarmService.setLockScreenOverlap(false);
        setTimeout(() => {
          router.replace('/(tabs)/home');
        }, 750);
      }
    } catch (e: any) {
      console.warn('Failed to snooze alarm for schedule:', currentDose.scheduleId);
      setErrorMessage(e?.message || 'Could not snooze alarm. Please try again.');
      setIsProcessing(false);
    }
  }, [isProcessing, currentDose, doses, snoozeMinutes, router]);

  // Action: Skip Dose
  const executeSkipDose = useCallback(async () => {
    if (isProcessing || !currentDose) return;
    setIsProcessing(true);
    setErrorMessage(null);

    try {
      Vibration.vibrate(Platform.OS === 'android' ? [0, 35, 35, 35] : 70);
      await nativeAlarmService.stopAlarm(currentDose.scheduleId, currentDose.doseTime);
      if (currentDose.scheduleId) {
        await nativeAlarmService.cancelSnoozesForSchedule(currentDose.scheduleId);
      }

      if (currentDose.scheduleId && currentDose.medicineId) {
        const now = new Date();
        const todayStr = [
          now.getFullYear(),
          String(now.getMonth() + 1).padStart(2, '0'),
          String(now.getDate()).padStart(2, '0'),
        ].join('-');
        const targetTime =
          currentDose.doseTime ||
          `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
        adherenceRepository.logDoseStatus(
          currentDose.scheduleId,
          currentDose.medicineId,
          todayStr,
          targetTime,
          'skipped',
        );
      }

      const updated = doses.map((d) =>
        d.id === currentDose.id ? { ...d, status: 'skipped' as const } : d,
      );
      setDoses(updated);

      const remainingPending = updated.filter((d) => d.status === 'pending');
      if (remainingPending.length > 0) {
        setSelectedIndex(updated.findIndex((d) => d.status === 'pending'));
        setToastMessage(`${currentDose.medicineName} skipped for now`);
        setTimeout(() => setToastMessage(null), 2500);
        setIsProcessing(false);
      } else {
        setCompletedAction('skipped');
        await nativeAlarmService.setLockScreenOverlap(false);
        await nativeAlarmService.stopAlarm();
        setTimeout(() => router.replace('/(tabs)/home'), 750);
      }
    } catch (error) {
      console.warn('Failed to skip dose:', error);
      setErrorMessage('Could not skip this dose. Please try again.');
      setIsProcessing(false);
    }
  }, [isProcessing, currentDose, doses, router]);

  // Action: Take All Pending Simultaneous Doses
  const executeTakeAll = useCallback(async () => {
    if (isProcessing) return;
    setIsProcessing(true);
    setErrorMessage(null);

    try {
      Vibration.vibrate(Platform.OS === 'android' ? [0, 80, 40, 80] : 100);
      const now = new Date();
      const todayStr = [
        now.getFullYear(),
        String(now.getMonth() + 1).padStart(2, '0'),
        String(now.getDate()).padStart(2, '0'),
      ].join('-');

      for (const d of doses) {
        if (d.status === 'pending') {
          await nativeAlarmService.stopAlarm(d.scheduleId, d.doseTime);
          if (d.scheduleId) {
            await nativeAlarmService.cancelSnoozesForSchedule(d.scheduleId);
          }
          if (d.scheduleId && d.medicineId) {
            const targetTime =
              d.doseTime ||
              `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
            try {
              adherenceRepository.logDoseStatus(
                d.scheduleId,
                d.medicineId,
                todayStr,
                targetTime,
                'taken',
              );
            } catch (logErr) {
              console.warn('Could not record dose adherence log for', d.scheduleId, logErr);
            }
          }
        }
      }

      setDoses((prev) => prev.map((d) => ({ ...d, status: 'taken' as const })));
      setCompletedAction('taken');
      await nativeAlarmService.setLockScreenOverlap(false);
      await nativeAlarmService.stopAlarm();
      setTimeout(() => {
        router.replace('/(tabs)/home');
      }, 750);
    } catch (e) {
      console.warn('Failed to take all doses:', e);
      setErrorMessage('Could not take all doses. Please try again.');
      setIsProcessing(false);
    }
  }, [isProcessing, doses, router]);

  const currentSchedule = useMemo(
    () => (currentDose?.scheduleId ? scheduleRepository.getById(currentDose.scheduleId) : null),
    [currentDose],
  );

  // Look for next scheduled medicine today
  const nextDose = useMemo(() => {
    // 1. Any other simultaneous pending dose
    const pendingOther = pendingDoses.find((d) => d.id !== currentDose?.id);
    if (pendingOther) return pendingOther;

    // 2. Or the next upcoming dose in repository
    try {
      const now = new Date();
      const todayStr = [
        now.getFullYear(),
        String(now.getMonth() + 1).padStart(2, '0'),
        String(now.getDate()).padStart(2, '0'),
      ].join('-');
      const todayDoses = adherenceRepository.getDosesForDate(todayStr);
      const currentTimeStr = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
      const upcoming = todayDoses.find(
        (td) => td.time > currentTimeStr && td.status !== 'taken' && td.status !== 'skipped',
      );
      if (upcoming) {
        return resolveDoseItem(
          upcoming.scheduleId,
          undefined,
          upcoming.medicineName,
          upcoming.amount,
          upcoming.time,
        );
      }
    } catch (_e) {}
    return null;
  }, [pendingDoses, currentDose]);

  const doseInstruction = currentDose?.amount?.includes('·')
    ? currentDose.amount.split('·').slice(1).join('·').trim()
    : currentDose?.amount || '1 tablet';

  const recurrenceLabel =
    currentSchedule?.recurrence === 'daily'
      ? 'Every day'
      : currentSchedule?.recurrence === 'weekly'
        ? 'Every week'
        : currentSchedule?.recurrence === 'monthly'
          ? 'Every month'
          : currentSchedule?.recurrence === 'once'
            ? 'One-time reminder'
            : 'Every day';

  const startedLabel = currentSchedule?.startDate
    ? new Date(`${currentSchedule.startDate}T00:00:00`).toLocaleDateString([], {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      })
    : 'Apr 22, 2026';

  const themeColors = {
    bg: isDark ? '#0B111E' : '#F0F6FE',
    card: isDark ? '#151E2E' : '#FFFFFF',
    innerPanel: isDark ? '#1C2638' : '#F8FAFC',
    divider: isDark ? '#26344A' : '#EDF2F7',
    tipBg: isDark ? '#13233A' : '#EFF6FF',
    tipText: isDark ? '#7DD3FC' : '#0369A1',
    textPrimary: isDark ? '#F8FAFC' : '#0F172A',
    textSecondary: isDark ? '#94A3B8' : '#64748B',
    border: isDark ? '#243044' : '#E2E8F0',
    glowRing: isDark ? 'rgba(7, 136, 245, 0.25)' : '#E0F2FE',
    skipBg: isDark ? '#2A1720' : '#FFF1F2',
    skipBorder: isDark ? '#3D202D' : '#FFE4E6',
    haloColor: isDark ? 'rgba(7, 136, 245, 0.15)' : 'rgba(7, 136, 245, 0.08)',
  };

  return (
    <View style={[styles.container, { backgroundColor: themeColors.bg }]}>
      <StatusBar style={isDark ? 'light' : 'dark'} />
      <SafeAreaView style={styles.safeArea}>
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.content}
          showsVerticalScrollIndicator={false}
          bounces={false}
        >
          {/* Subtle concentric halo ripples behind time */}
          <View style={styles.heroWrapper}>
            <View style={[styles.timeHaloLarge, { borderColor: themeColors.haloColor }]} />
            <View style={[styles.timeHaloSmall, { borderColor: themeColors.haloColor }]} />

            <Text style={[styles.screenTitle, { color: themeColors.textSecondary }]}>
              Medicine Reminder
            </Text>

            {/* Time with Ray Ticks */}
            <View style={styles.scheduledTimeRow}>
              <View style={styles.timeRaysLeft}>
                <View style={[styles.timeRay, styles.timeRayTopLeft]} />
                <View style={[styles.timeRay, styles.timeRayMidLeft]} />
                <View style={[styles.timeRay, styles.timeRayBotLeft]} />
              </View>

              <Text style={[styles.scheduledTime, { color: themeColors.textPrimary }]}>
                {currentDose?.doseTime || '08:00'}
              </Text>

              <View style={styles.timeRaysRight}>
                <View style={[styles.timeRay, styles.timeRayTopRight]} />
                <View style={[styles.timeRay, styles.timeRayMidRight]} />
                <View style={[styles.timeRay, styles.timeRayBotRight]} />
              </View>
            </View>

            <Text style={[styles.timeSubtitle, { color: themeColors.textSecondary }]}>
              Time to take your medicine
            </Text>
          </View>

          {/* Simultaneous Doses Pill Selector (when multiple alarms fire together) */}
          {doses.length > 1 && (
            <View style={styles.simultaneousSection}>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.dosePillRow}
              >
                {doses.map((dose, idx) => {
                  const isSelected = idx === selectedIndex;
                  const isTaken = dose.status === 'taken';
                  const isSnoozed = dose.status === 'snoozed';
                  const isSkipped = dose.status === 'skipped';
                  return (
                    <TouchableOpacity
                      key={dose.id}
                      testID={`dose-pill-${dose.scheduleId}`}
                      onPress={() => setSelectedIndex(idx)}
                      activeOpacity={0.75}
                      accessibilityRole="button"
                      accessibilityLabel={`Select ${dose.medicineName} dose`}
                      style={[
                        styles.dosePill,
                        {
                          backgroundColor: isSelected ? Colors.primaryLight : themeColors.card,
                          borderColor: isSelected ? Colors.primary : themeColors.border,
                        },
                      ]}
                    >
                      <Ionicons
                        name={
                          isTaken
                            ? 'checkmark-circle'
                            : isSnoozed
                              ? 'alarm'
                              : isSkipped
                                ? 'close-circle'
                                : 'medical-outline'
                        }
                        size={15}
                        color={
                          isTaken
                            ? Colors.success
                            : isSnoozed
                              ? Colors.warning
                              : isSkipped
                                ? Colors.textTertiary
                                : Colors.primary
                        }
                      />
                      <Text
                        style={[
                          styles.dosePillText,
                          { color: isSelected ? Colors.primaryDark : themeColors.textPrimary },
                        ]}
                        numberOfLines={1}
                      >
                        {dose.medicineName}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>
            </View>
          )}

          {/* Main Floating Medicine Card */}
          <View style={[styles.medicineCard, { backgroundColor: themeColors.card }]}>
            {/* Header: Icon, Name/Amount, Badge */}
            <View style={styles.cardHeader}>
              <View style={styles.pillIconBox}>
                <MaterialCommunityIcons
                  name="pill"
                  size={24}
                  color={Colors.primary}
                  style={styles.pillIcon}
                />
              </View>

              <View style={styles.cardHeading}>
                <Text
                  style={[styles.medicineName, { color: themeColors.textPrimary }]}
                  numberOfLines={1}
                >
                  {currentDose?.medicineName || 'Metformin'}
                </Text>
                <Text
                  style={[styles.medicineAmount, { color: themeColors.textSecondary }]}
                  numberOfLines={1}
                >
                  {currentDose?.amount || '500 mg · 1 tablet'}
                </Text>
              </View>

              <View style={styles.doseBadge}>
                <Text style={styles.doseBadgeText}>
                  {currentDose?.doseLabel || 'Morning Dose'}
                </Text>
              </View>
            </View>

            {/* Inner Details Container */}
            <View style={[styles.detailsPanel, { backgroundColor: themeColors.innerPanel }]}>
              {/* Row 1: Recurrence */}
              <View style={styles.detailRow}>
                <Ionicons name="calendar-outline" size={18} color={themeColors.textSecondary} />
                <View style={styles.detailCopy}>
                  <Text style={[styles.detailTitle, { color: themeColors.textPrimary }]}>
                    {recurrenceLabel}
                  </Text>
                  <Text style={[styles.detailSubtitle, { color: themeColors.textSecondary }]}>
                    Started {startedLabel}
                  </Text>
                </View>
              </View>

              <View style={[styles.detailDivider, { backgroundColor: themeColors.divider }]} />

              {/* Row 2: Instructions */}
              <View style={styles.detailRow}>
                <Ionicons name="document-text-outline" size={18} color={themeColors.textSecondary} />
                <View style={styles.detailCopy}>
                  <Text style={[styles.detailTitle, { color: themeColors.textPrimary }]}>
                    Take {doseInstruction}
                  </Text>
                  <Text style={[styles.detailSubtitle, { color: themeColors.textSecondary }]}>
                    As directed on your label
                  </Text>
                </View>
              </View>

              <View style={[styles.detailDivider, { backgroundColor: themeColors.divider }]} />

              {/* Row 3: Schedule notice */}
              <View style={styles.detailRow}>
                <Ionicons
                  name="information-circle-outline"
                  size={19}
                  color={themeColors.textSecondary}
                />
                <View style={styles.detailCopy}>
                  <Text style={[styles.detailTitle, { color: themeColors.textPrimary }]}>
                    From your saved schedule
                  </Text>
                  <Text style={[styles.detailSubtitle, { color: themeColors.textSecondary }]}>
                    Follow your doctor’s instructions
                  </Text>
                </View>
              </View>
            </View>
          </View>

          {/* Routine Consistency Tip Banner */}
          <View style={[styles.tipBanner, { backgroundColor: themeColors.tipBg }]}>
            <Ionicons name="sparkles" size={17} color={Colors.primary} />
            <Text style={[styles.tipBannerText, { color: themeColors.tipText }]}>
              Keeping your routine consistent helps you stay on track.
            </Text>
          </View>

          {/* Feedback & Error Alerts */}
          {toastMessage && (
            <View style={[styles.feedbackBanner, { backgroundColor: themeColors.tipBg }]}>
              <Ionicons name="information-circle-outline" size={18} color={Colors.primary} />
              <Text style={[styles.feedbackText, { color: themeColors.tipText }]}>
                {toastMessage}
              </Text>
            </View>
          )}

          {completedAction && (
            <View style={[styles.feedbackBanner, styles.completedBanner]}>
              <Ionicons
                name={
                  completedAction === 'taken'
                    ? 'checkmark-circle'
                    : completedAction === 'snooze'
                      ? 'alarm'
                      : 'close-circle'
                }
                size={18}
                color={completedAction === 'taken' ? Colors.success : Colors.warning}
              />
              <Text style={styles.completedText}>
                {completedAction === 'taken'
                  ? 'All doses recorded as taken'
                  : completedAction === 'snooze'
                    ? `Snoozed for ${snoozeMinutes} minutes`
                    : 'Dose skipped for now'}
              </Text>
            </View>
          )}

          {errorMessage && (
            <View style={styles.errorBanner}>
              <Ionicons name="alert-circle-outline" size={18} color={Colors.error} />
              <Text style={styles.errorText}>{errorMessage}</Text>
            </View>
          )}

          {/* Action Row: Snooze (Left), Mark as Taken (Center), Skip (Right) */}
          <View style={styles.actionsRow}>
            {/* Snooze */}
            <TouchableOpacity
              style={styles.sideAction}
              onPress={executeSnooze}
              disabled={isProcessing}
              accessibilityRole="button"
              accessibilityLabel={`Snooze for ${snoozeMinutes} minutes`}
              accessibilityState={{ disabled: isProcessing }}
              activeOpacity={0.7}
            >
              <View
                style={[
                  styles.sideActionCircle,
                  { backgroundColor: themeColors.card, borderColor: themeColors.divider },
                ]}
              >
                <MaterialCommunityIcons
                  name="alarm-snooze"
                  size={24}
                  color={themeColors.textPrimary}
                />
              </View>
              <Text style={[styles.actionTitle, { color: themeColors.textPrimary }]}>Snooze</Text>
              <Text style={[styles.actionSubtitle, { color: themeColors.textSecondary }]}>
                {snoozeMinutes} minutes
              </Text>
            </TouchableOpacity>

            {/* Mark as Taken (Center Hero Button) */}
            <TouchableOpacity
              style={styles.primaryAction}
              onPress={executeTakeDose}
              disabled={isProcessing}
              accessibilityRole="button"
              accessibilityLabel="Mark as Taken"
              accessibilityState={{ disabled: isProcessing }}
              activeOpacity={0.82}
            >
              <View style={[styles.primaryActionRing, { backgroundColor: themeColors.glowRing }]}>
                <Animated.View
                  style={[
                    styles.primaryActionCircle,
                    { transform: [{ scale: chimeScale }] },
                  ]}
                >
                  <Ionicons name="checkmark" size={36} color="#FFFFFF" />
                </Animated.View>
              </View>
              <Text style={[styles.primaryActionTitle, { color: themeColors.textPrimary }]}>
                Mark as Taken
              </Text>
            </TouchableOpacity>

            {/* Skip */}
            <TouchableOpacity
              style={styles.sideAction}
              onPress={executeSkipDose}
              disabled={isProcessing}
              accessibilityRole="button"
              accessibilityLabel="Skip this dose for now"
              accessibilityState={{ disabled: isProcessing }}
              activeOpacity={0.7}
            >
              <View
                style={[
                  styles.sideActionCircle,
                  {
                    backgroundColor: themeColors.skipBg,
                    borderColor: themeColors.skipBorder,
                  },
                ]}
              >
                <Ionicons name="close" size={24} color={Colors.error} />
              </View>
              <Text style={[styles.actionTitle, { color: themeColors.textPrimary }]}>Skip</Text>
              <Text style={[styles.actionSubtitle, { color: themeColors.textSecondary }]}>
                For now
              </Text>
            </TouchableOpacity>
          </View>

          {/* Take All Button (Only when multiple simultaneous doses are active) */}
          {pendingDoses.length > 1 && (
            <TouchableOpacity
              testID="take-all-button"
              style={styles.takeAllButton}
              onPress={executeTakeAll}
              disabled={isProcessing}
              accessibilityRole="button"
              accessibilityLabel={`Mark all ${pendingDoses.length} due medications as taken`}
              accessibilityState={{ disabled: isProcessing }}
              activeOpacity={0.8}
            >
              <Ionicons name="checkmark-done" size={18} color={Colors.primary} />
              <Text style={styles.takeAllButtonText}>
                Mark all {pendingDoses.length} doses as taken
              </Text>
            </TouchableOpacity>
          )}

          {/* Next Medicine Preview Bar */}
          {nextDose && (
            <View
              style={[
                styles.nextCard,
                { backgroundColor: themeColors.card, borderColor: themeColors.divider },
              ]}
            >
              <View style={styles.nextIconBox}>
                <Ionicons name="document-text-outline" size={18} color={Colors.primary} />
              </View>
              <View style={styles.nextCopy}>
                <Text style={[styles.nextTitle, { color: themeColors.textPrimary }]}>
                  Next: {nextDose.medicineName}
                </Text>
                <Text style={[styles.nextSubtitle, { color: themeColors.textSecondary }]}>
                  {nextDose.doseTime || '08:00'} · {nextDose.amount || '1 dose'}
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={16} color={themeColors.textSecondary} />
            </View>
          )}
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  safeArea: {
    flex: 1,
  },
  scroll: {
    flex: 1,
  },
  content: {
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 28,
  },

  // ---------------------------------------------------------------------------
  // Hero Clock & Halo
  // ---------------------------------------------------------------------------
  heroWrapper: {
    width: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: 8,
    paddingBottom: 12,
    position: 'relative',
    overflow: 'hidden',
  },
  timeHaloLarge: {
    position: 'absolute',
    width: 320,
    height: 320,
    borderRadius: 160,
    borderWidth: 1,
    top: -30,
  },
  timeHaloSmall: {
    position: 'absolute',
    width: 230,
    height: 230,
    borderRadius: 115,
    borderWidth: 1,
    top: 15,
  },
  screenTitle: {
    fontSize: 15,
    fontWeight: '500',
    letterSpacing: 0.2,
    marginBottom: 8,
  },
  scheduledTimeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  scheduledTime: {
    fontSize: 58,
    fontWeight: '800',
    letterSpacing: -1.5,
    fontVariant: ['tabular-nums'],
    lineHeight: 68,
  },
  timeRaysLeft: {
    justifyContent: 'space-between',
    height: 36,
    alignItems: 'flex-end',
    width: 20,
    marginRight: 12,
  },
  timeRaysRight: {
    justifyContent: 'space-between',
    height: 36,
    alignItems: 'flex-start',
    width: 20,
    marginLeft: 12,
  },
  timeRay: {
    height: 3,
    backgroundColor: '#0788F5',
    borderRadius: 2,
  },
  timeRayTopLeft: { width: 13, transform: [{ rotate: '-35deg' }] },
  timeRayMidLeft: { width: 16, transform: [{ rotate: '0deg' }] },
  timeRayBotLeft: { width: 13, transform: [{ rotate: '35deg' }] },
  timeRayTopRight: { width: 13, transform: [{ rotate: '35deg' }] },
  timeRayMidRight: { width: 16, transform: [{ rotate: '0deg' }] },
  timeRayBotRight: { width: 13, transform: [{ rotate: '-35deg' }] },
  timeSubtitle: {
    fontSize: 14,
    fontWeight: '400',
    marginTop: 4,
  },

  // ---------------------------------------------------------------------------
  // Simultaneous Doses
  // ---------------------------------------------------------------------------
  simultaneousSection: {
    width: '100%',
    marginBottom: 10,
    marginTop: 4,
    alignItems: 'center',
  },
  dosePillRow: {
    gap: 8,
    paddingHorizontal: 4,
    paddingVertical: 2,
  },
  dosePill: {
    minHeight: 36,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    borderRadius: Radius.pill,
    borderWidth: 1,
  },
  dosePillText: {
    fontSize: 12.5,
    fontWeight: '600',
    maxWidth: 140,
  },

  // ---------------------------------------------------------------------------
  // Main Medicine Card
  // ---------------------------------------------------------------------------
  medicineCard: {
    width: '100%',
    borderRadius: 24,
    padding: 18,
    marginTop: 6,
    ...Shadows.card,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  pillIconBox: {
    width: 48,
    height: 48,
    borderRadius: 14,
    backgroundColor: '#EFF6FF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  pillIcon: {
    transform: [{ rotate: '-45deg' }],
  },
  cardHeading: {
    flex: 1,
    marginLeft: 14,
    paddingRight: 8,
  },
  medicineName: {
    fontSize: 19,
    fontWeight: '700',
    letterSpacing: -0.2,
  },
  medicineAmount: {
    fontSize: 13.5,
    fontWeight: '400',
    marginTop: 2,
  },
  doseBadge: {
    backgroundColor: '#EFF6FF',
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  doseBadgeText: {
    color: '#0284C7',
    fontSize: 11.5,
    fontWeight: '600',
  },

  // ---------------------------------------------------------------------------
  // Inner Details Panel
  // ---------------------------------------------------------------------------
  detailsPanel: {
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 6,
    marginTop: 14,
  },
  detailRow: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 6,
  },
  detailCopy: {
    flex: 1,
    marginLeft: 12,
  },
  detailTitle: {
    fontSize: 13.5,
    fontWeight: '600',
  },
  detailSubtitle: {
    fontSize: 12,
    fontWeight: '400',
    marginTop: 1,
  },
  detailDivider: {
    height: 1,
    marginLeft: 30,
  },

  // ---------------------------------------------------------------------------
  // Tip Banner
  // ---------------------------------------------------------------------------
  tipBanner: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderRadius: 14,
    paddingHorizontal: 16,
    paddingVertical: 12,
    marginTop: 12,
  },
  tipBannerText: {
    flex: 1,
    fontSize: 12.5,
    lineHeight: 18,
    fontWeight: '500',
  },

  // ---------------------------------------------------------------------------
  // Action Buttons
  // ---------------------------------------------------------------------------
  actionsRow: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
    marginTop: 22,
    paddingHorizontal: 8,
  },
  sideAction: {
    alignItems: 'center',
    width: 80,
  },
  sideActionCircle: {
    width: 62,
    height: 62,
    borderRadius: 31,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    ...Shadows.subtle,
  },
  actionTitle: {
    fontSize: 13.5,
    fontWeight: '700',
    marginTop: 8,
  },
  actionSubtitle: {
    fontSize: 11,
    marginTop: 1,
  },
  primaryAction: {
    alignItems: 'center',
    width: 116,
  },
  primaryActionRing: {
    width: 92,
    height: 92,
    borderRadius: 46,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryActionCircle: {
    width: 68,
    height: 68,
    borderRadius: 34,
    backgroundColor: Colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    ...Shadows.floating,
    elevation: 6,
  },
  primaryActionTitle: {
    fontSize: 14,
    fontWeight: '700',
    marginTop: 8,
    textAlign: 'center',
  },

  // ---------------------------------------------------------------------------
  // Take All (Multiple Doses)
  // ---------------------------------------------------------------------------
  takeAllButton: {
    width: '100%',
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    borderRadius: Radius.pill,
    backgroundColor: '#EFF6FF',
    borderWidth: 1,
    borderColor: '#BAE6FD',
    marginTop: 14,
  },
  takeAllButtonText: {
    color: '#0284C7',
    fontSize: 13,
    fontWeight: '700',
  },

  // ---------------------------------------------------------------------------
  // Next Medicine Preview Card
  // ---------------------------------------------------------------------------
  nextCard: {
    width: '100%',
    minHeight: 64,
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 16,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 10,
    marginTop: 16,
    ...Shadows.subtle,
  },
  nextIconBox: {
    width: 32,
    height: 32,
    borderRadius: 8,
    backgroundColor: '#EFF6FF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  nextCopy: {
    flex: 1,
    marginLeft: 12,
  },
  nextTitle: {
    fontSize: 13,
    fontWeight: '600',
  },
  nextSubtitle: {
    fontSize: 11.5,
    marginTop: 1,
  },

  // ---------------------------------------------------------------------------
  // Banners & Notifications
  // ---------------------------------------------------------------------------
  feedbackBanner: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 10,
    marginTop: 10,
  },
  feedbackText: {
    flex: 1,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '500',
  },
  completedBanner: {
    backgroundColor: Colors.successLight,
  },
  completedText: {
    flex: 1,
    color: Colors.successDark,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '700',
  },
  errorBanner: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: Colors.errorLight,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 10,
    marginTop: 10,
  },
  errorText: {
    flex: 1,
    color: Colors.errorDark,
    fontSize: 12.5,
    lineHeight: 18,
    fontWeight: '600',
  },
});
