import React, { useEffect } from "react";
import { StyleSheet, View, Text, Alert } from "react-native";
import { useRouter } from "expo-router";
import { Colors } from "../../theme/colors";
import { Spacing, Radius } from "../../theme/tokens";
import { AppScreen } from "../../components/ui/AppScreen";
import { AppHeader } from "../../components/ui/AppHeader";
import { CalendarGrid } from "../../components/ui/CalendarGrid";
import { DayAdherenceSummaryCard } from "../../components/ui/DayAdherenceSummaryCard";
import { SectionHeader } from "../../components/ui/SectionHeader";
import { ReminderCard } from "../../components/ui/ReminderCard";
import { MedicalDisclaimer } from "../../components/ui/MedicalDisclaimer";
import { useAppStore } from "../../store/appStore";
import { useReminderStore } from "../../store/reminderStore";
import { ScheduledDose } from "../../types";
import { adherenceRepository } from "../../database/repositories/adherenceRepository";
import { scheduleRepository } from "../../database/repositories/scheduleRepository";
import { formatScheduleDateLabel } from "../../utils/scheduleRecurrence";

export default function CalendarScreen() {
  const router = useRouter();
  const { selectedDate, setSelectedDate } = useAppStore();
  const { doses, daySummary, loadDosesForDate, markDoseStatus } =
    useReminderStore();

  useEffect(() => {
    loadDosesForDate(selectedDate);
  }, [selectedDate, loadDosesForDate]);

  const handleMorePress = (dose: ScheduledDose) => {
    Alert.alert(
      dose.medicineName,
      `Scheduled for ${dose.time} (${dose.amount})`,
      [
        {
          text: "Mark as Taken",
          onPress: () => markDoseStatus(dose, "taken", selectedDate),
        },
        {
          text: "Mark as Skipped",
          onPress: () => markDoseStatus(dose, "skipped", selectedDate),
        },
        {
          text: "View Medicine Details",
          onPress: () => router.push(`/medicines/${dose.medicineId}`),
        },
        {
          text: "Cancel",
          style: "cancel",
        },
      ],
    );
  };

  return (
    <AppScreen scrollable contentContainerStyle={styles.scrollContent}>
      {/* Header */}
      <AppHeader
        title="Reminders"
        subtitle="Your schedule, one day at a time"
        brandText="HealthMate AI"
        onAddPress={() =>
          router.push({
            pathname: "/reminders/create",
            params: { date: selectedDate },
          })
        }
      />

      <View style={styles.body}>
        {/* Monthly Calendar Widget */}
        <CalendarGrid
          selectedDate={selectedDate}
          schedules={scheduleRepository.getAll()}
          onSelectDate={(date) => {
            setSelectedDate(date);
            const scheduledForDate = adherenceRepository.getDosesForDate(date);
            if (scheduledForDate.length === 0) {
              router.push({ pathname: "/reminders/create", params: { date } });
            }
          }}
        />

        {/* Selected Date Summary Card */}
        {daySummary ? <DayAdherenceSummaryCard summary={daySummary} /> : null}

        {/* Selected Date Schedule Section */}
        <SectionHeader
          title={formatScheduleDateLabel(selectedDate)}
          actionText="+ Add"
          onActionPress={() =>
            router.push({
              pathname: "/reminders/create",
              params: { date: selectedDate },
            })
          }
        />

        {/* Doses List */}
        {doses.map((dose) => (
          <ReminderCard
            key={dose.id}
            dose={dose}
            onMarkTaken={() => markDoseStatus(dose, "taken", selectedDate)}
            onSkip={() => markDoseStatus(dose, "skipped", selectedDate)}
            onMorePress={() => handleMorePress(dose)}
            onPressCard={() => router.push(`/medicines/${dose.medicineId}`)}
          />
        ))}

        {doses.length === 0 ? (
          <View style={styles.emptyContainer}>
            <Text style={styles.emptyTitle}>
              No reminders scheduled for this date
            </Text>
            <Text style={styles.emptySubtitle}>
              Tap + Add to set up a reminder schedule for your medicine.
            </Text>
          </View>
        ) : (
          /* Helper Note */
          <Text style={styles.helperNote}>
            Use the more options button to edit or delete a reminder.
          </Text>
        )}

        {/* Medical Disclaimer */}
        <MedicalDisclaimer
          text="A missed or skipped reminder is a log entry, not advice about your next dose. Check your prescription label or ask your pharmacist what to do."
          subtext=""
        />
      </View>
    </AppScreen>
  );
}

const styles = StyleSheet.create({
  scrollContent: {
    paddingBottom: 110,
  },
  body: {
    paddingHorizontal: Spacing.screenPaddingHorizontal,
  },
  helperNote: {
    fontSize: 12,
    color: Colors.textSecondary,
    textAlign: "center",
    marginTop: Spacing.xs,
    marginBottom: Spacing.xs,
  },
  emptyContainer: {
    backgroundColor: "#FFFFFF",
    borderRadius: Radius.card,
    padding: Spacing.xl,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "#ECEBF0",
    marginTop: Spacing.sm,
    marginBottom: Spacing.md,
  },
  emptyTitle: {
    fontSize: 15,
    fontWeight: "700",
    color: Colors.textPrimary,
    marginBottom: 6,
    textAlign: "center",
  },
  emptySubtitle: {
    fontSize: 13,
    color: Colors.textSecondary,
    textAlign: "center",
    lineHeight: 18,
  },
});
