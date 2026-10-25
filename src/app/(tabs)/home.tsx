import React, { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Spacing } from '../../theme/tokens';
import { AppScreen } from '../../components/ui/AppScreen';
import { HomeHeader } from '../../components/home/HomeHeader';
import { DailyAdherenceCard } from '../../components/home/DailyAdherenceCard';
import { AssistantPromoCard } from '../../components/home/AssistantPromoCard';
import { NextMedicationCard } from '../../components/home/NextMedicationCard';
import { TodayTimeline } from '../../components/home/TodayTimeline';
import { QuickActionRow } from '../../components/home/QuickActionRow';
import { MedicalDisclaimer } from '../../components/ui/MedicalDisclaimer';
import { useAppStore } from '../../store/appStore';
import { useReminderStore } from '../../store/reminderStore';

export default function HomeScreen() {
  const router = useRouter();
  const { profile, selectedDate, preferences } = useAppStore();
  const { doses, daySummary, loadDosesForDate, markDoseStatus } = useReminderStore();

  useEffect(() => {
    loadDosesForDate(selectedDate);
  }, [selectedDate, loadDosesForDate]);

  const rawName = profile?.name?.trim() || 'Alex Morgan';
  const firstName = rawName.split(' ')[0] || 'Alex';
  const userInitials = rawName
    .split(' ')
    .filter(Boolean)
    .map((p) => p[0])
    .join('')
    .slice(0, 2)
    .toUpperCase() || 'AM';

  const getTimeGreeting = () => {
    const hour = new Date().getHours();
    if (hour < 12) return 'Good morning';
    if (hour < 17) return 'Good afternoon';
    return 'Good evening';
  };

  const getFormattedDate = (dateStr: string) => {
    if (!dateStr) return 'Wednesday, April 22';
    const [year, month, day] = dateStr.split('-').map(Number);
    if (!year || !month || !day) return 'Wednesday, April 22';
    const d = new Date(year, month - 1, day);
    return d.toLocaleDateString('en-US', {
      weekday: 'long',
      month: 'long',
      day: 'numeric',
    });
  };

  const nextUpcomingDose = doses.find((d) => d.status === 'upcoming');

  return (
    <AppScreen scrollable contentContainerStyle={styles.scrollContent}>
      {/* 1. Header with branding, profile initials, greeting, date, and status pills */}
      <HomeHeader
        greeting={getTimeGreeting()}
        userName={firstName}
        dateText={getFormattedDate(selectedDate)}
        avatarText={userInitials}
        streakCount={preferences.streakCount}
        onAvatarPress={() => router.push('/(tabs)/profile')}
      />

      <View style={styles.content}>
        {/* 2. Today's Adherence Card */}
        <DailyAdherenceCard
          percentage={daySummary?.percentage ?? 0}
          taken={daySummary?.taken ?? 0}
          total={daySummary?.total ?? 0}
          remaining={daySummary?.remaining ?? 0}
          missed={daySummary?.missed ?? 0}
          skipped={daySummary?.skipped ?? 0}
          onDetailsPress={() => router.push('/health-adherence')}
        />

        {/* 3. HealthMate AI Mode Card */}
        <AssistantPromoCard
          onAskPress={() => router.push('/ai-assistant')}
        />

        {/* 4. Next Up Card */}
        {nextUpcomingDose ? (
          <NextMedicationCard
            dose={nextUpcomingDose}
            onMarkAsTaken={(dose) =>
              markDoseStatus(dose, 'taken', selectedDate)
            }
          />
        ) : null}

        {/* 5. Today's Timeline Card */}
        <TodayTimeline
          doses={doses}
          onViewAllPress={() => router.push('/(tabs)/calendar')}
        />

        {/* 6. Shortcuts: Your health, organized */}
        <QuickActionRow
          onInsightsPress={() => router.push('/health-adherence')}
          onScanPress={() => router.push('/(tabs)/scan')}
          onCalendarPress={() => router.push('/(tabs)/calendar')}
        />

        {/* 7. Medical Disclaimer & Fictional Data Notice */}
        <MedicalDisclaimer />
      </View>
    </AppScreen>
  );
}

const styles = StyleSheet.create({
  scrollContent: {
    paddingBottom: 110,
  },
  content: {
    paddingHorizontal: Spacing.screenPaddingHorizontal,
  },
});
