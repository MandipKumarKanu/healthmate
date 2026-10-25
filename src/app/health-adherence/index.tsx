import React, { useEffect, useState } from 'react';
import { StyleSheet, View, Text } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons, Feather } from '@expo/vector-icons';
import { Colors } from '../../theme/colors';
import { Radius, Spacing, Typography } from '../../theme/tokens';
import { AppScreen } from '../../components/ui/AppScreen';
import { AppHeader } from '../../components/ui/AppHeader';
import { AppCard } from '../../components/ui/AppCard';
import { SectionHeader } from '../../components/ui/SectionHeader';
import { MedicalDisclaimer } from '../../components/ui/MedicalDisclaimer';
import { useAppStore } from '../../store/appStore';
import { adherenceRepository } from '../../database/repositories/adherenceRepository';
import { medicineRepository } from '../../database/repositories/medicineRepository';
import { scheduleRepository } from '../../database/repositories/scheduleRepository';
import { DayAdherenceSummary } from '../../types';

export default function HealthAdherenceScreen() {
  const router = useRouter();
  const { selectedDate, preferences } = useAppStore();

  const [todaySummary, setTodaySummary] = useState<DayAdherenceSummary | null>(null);
  const [weeklySummaries, setWeeklySummaries] = useState<DayAdherenceSummary[]>([]);
  const [totalMedicines, setTotalMedicines] = useState(0);
  const [activeSchedulesCount, setActiveSchedulesCount] = useState(0);

  useEffect(() => {
    const summary = adherenceRepository.getDayAdherenceSummary(selectedDate);
    setTodaySummary(summary);

    const week = adherenceRepository.getWeeklyAdherenceSummaries(selectedDate);
    setWeeklySummaries(week);

    const meds = medicineRepository.getAll();
    setTotalMedicines(meds.length);

    const scheds = scheduleRepository.getAll().filter((s) => s.enabled);
    setActiveSchedulesCount(scheds.length);
  }, [selectedDate]);

  const percentage = todaySummary?.percentage ?? 50;

  return (
    <AppScreen scrollable contentContainerStyle={styles.scrollContent}>
      <AppHeader
        title="Health & Adherence"
        subtitle="Tracking consistency, not clinical assessment"
        brandText="HealthMate AI"
        onBackPress={() => router.back()}
      />

      <View style={styles.body}>
        {/* Today's Progress Card */}
        <AppCard style={styles.progressCard}>
          <Text style={styles.cardHeaderTitle}>TODAY'S PROGRESS</Text>

          <View style={styles.circleContainer}>
            <View style={styles.ringOuter}>
              <View style={styles.ringInner}>
                <Text style={styles.circlePercentage}>{percentage}%</Text>
                <Text style={styles.circleLabel}>Adherence</Text>
              </View>
            </View>
          </View>

          {/* 4 Counts Breakdown */}
          <View style={styles.breakdownRow}>
            <View style={styles.breakdownCol}>
              <Text style={[styles.breakdownVal, { color: Colors.success }]}>
                {todaySummary?.taken ?? 3}
              </Text>
              <Text style={styles.breakdownLabel}>Taken</Text>
            </View>

            <View style={styles.breakdownCol}>
              <Text style={[styles.breakdownVal, { color: Colors.primary }]}>
                {todaySummary?.remaining ?? 1}
              </Text>
              <Text style={styles.breakdownLabel}>Remaining</Text>
            </View>

            <View style={styles.breakdownCol}>
              <Text style={[styles.breakdownVal, { color: Colors.error }]}>
                {todaySummary?.missed ?? 1}
              </Text>
              <Text style={styles.breakdownLabel}>Missed</Text>
            </View>

            <View style={styles.breakdownCol}>
              <Text style={[styles.breakdownVal, { color: Colors.textSecondary }]}>
                {todaySummary?.skipped ?? 1}
              </Text>
              <Text style={styles.breakdownLabel}>Skipped</Text>
            </View>
          </View>
        </AppCard>

        {/* Weekly Adherence 7-Day Chart */}
        <SectionHeader title="Weekly Adherence Trend" />
        <AppCard style={styles.weeklyCard}>
          <View style={styles.barsContainer}>
            {weeklySummaries.map((day, idx) => {
              const dateObj = new Date(day.date);
              const dayInitial = ['S', 'M', 'T', 'W', 'T', 'F', 'S'][
                dateObj.getDay()
              ];
              const barHeight = Math.max(day.percentage * 1.2, 8);

              return (
                <View key={day.date} style={styles.barCol}>
                  <Text style={styles.barPercentage}>{day.percentage}%</Text>
                  <View style={styles.barTrack}>
                    <View
                      style={[
                        styles.barFill,
                        {
                          height: barHeight,
                          backgroundColor:
                            day.percentage >= 80
                              ? Colors.success
                              : day.percentage > 0
                              ? Colors.primary
                              : '#E5E4EA',
                        },
                      ]}
                    />
                  </View>
                  <Text style={styles.barDayLabel}>{dayInitial}</Text>
                </View>
              );
            })}
          </View>
        </AppCard>

        {/* Overview Stats Grid */}
        <SectionHeader title="Cabinet Overview" />
        <View style={styles.statsGrid}>
          <AppCard style={styles.gridCard}>
            <Feather name="package" size={24} color={Colors.primary} />
            <Text style={styles.gridValue}>{totalMedicines}</Text>
            <Text style={styles.gridLabel}>Saved Medicines</Text>
          </AppCard>

          <AppCard style={styles.gridCard}>
            <Feather name="bell" size={24} color={Colors.success} />
            <Text style={styles.gridValue}>{activeSchedulesCount}</Text>
            <Text style={styles.gridLabel}>Active Schedules</Text>
          </AppCard>

          <AppCard style={styles.gridCard}>
            <Feather name="award" size={24} color="#D97706" />
            <Text style={styles.gridValue}>{preferences.streakCount} days</Text>
            <Text style={styles.gridLabel}>Logging Streak</Text>
          </AppCard>
        </View>

        {/* Medical Disclaimer */}
        <MedicalDisclaimer
          text="Adherence rates reflect self-reported medication logs. This is an organizational tool, not a measure of health outcomes or clinical efficacy."
          subtext=""
        />
      </View>
    </AppScreen>
  );
}

const styles = StyleSheet.create({
  scrollContent: {
    paddingBottom: 60,
  },
  body: {
    paddingHorizontal: Spacing.screenPaddingHorizontal,
  },
  progressCard: {
    alignItems: 'center',
    marginBottom: Spacing.lg,
    paddingVertical: Spacing.xl,
  },
  cardHeaderTitle: {
    fontSize: 12,
    fontWeight: '700',
    color: Colors.textSecondary,
    letterSpacing: 0.5,
    marginBottom: 16,
  },
  circleContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 20,
  },
  ringOuter: {
    width: 140,
    height: 140,
    borderRadius: 70,
    borderWidth: 10,
    borderColor: '#E8F4FF',
    borderTopColor: Colors.primary,
    borderRightColor: Colors.primary,
    justifyContent: 'center',
    alignItems: 'center',
    transform: [{ rotate: '45deg' }],
  },
  ringInner: {
    transform: [{ rotate: '-45deg' }],
    alignItems: 'center',
  },
  circlePercentage: {
    fontSize: 32,
    fontWeight: '800',
    color: Colors.primary,
  },
  circleLabel: {
    fontSize: 12,
    color: Colors.textSecondary,
    fontWeight: '500',
  },
  breakdownRow: {
    flexDirection: 'row',
    width: '100%',
    justifyContent: 'space-between',
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: Colors.borderLight,
  },
  breakdownCol: {
    flex: 1,
    alignItems: 'center',
  },
  breakdownVal: {
    fontSize: 20,
    fontWeight: '800',
    marginBottom: 2,
  },
  breakdownLabel: {
    fontSize: 12,
    color: Colors.textSecondary,
    fontWeight: '500',
  },
  weeklyCard: {
    marginBottom: Spacing.lg,
    paddingVertical: Spacing.lg,
  },
  barsContainer: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    alignItems: 'flex-end',
    height: 160,
    paddingBottom: 10,
  },
  barCol: {
    alignItems: 'center',
    width: 32,
  },
  barPercentage: {
    fontSize: 10,
    color: Colors.textTertiary,
    marginBottom: 6,
  },
  barTrack: {
    width: 14,
    height: 120,
    backgroundColor: '#F0EFEF',
    borderRadius: Radius.pill,
    justifyContent: 'flex-end',
    overflow: 'hidden',
  },
  barFill: {
    width: '100%',
    borderRadius: Radius.pill,
  },
  barDayLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: Colors.textPrimary,
    marginTop: 8,
  },
  statsGrid: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: Spacing.lg,
  },
  gridCard: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 8,
  },
  gridValue: {
    fontSize: 18,
    fontWeight: '800',
    color: Colors.textPrimary,
    marginTop: 8,
    marginBottom: 2,
  },
  gridLabel: {
    fontSize: 11,
    color: Colors.textSecondary,
    textAlign: 'center',
  },
});
