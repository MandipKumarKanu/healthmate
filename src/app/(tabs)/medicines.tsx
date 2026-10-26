import React, { useEffect, useState } from "react";
import {
  StyleSheet,
  View,
  Text,
  TextInput,
  TouchableOpacity,
} from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { Colors } from "../../theme/colors";
import { Radius, Spacing, Typography } from "../../theme/tokens";
import { AppScreen } from "../../components/ui/AppScreen";
import { AppHeader } from "../../components/ui/AppHeader";
import { MedicineCard } from "../../components/ui/MedicineCard";
import { SectionHeader } from "../../components/ui/SectionHeader";
import { MedicalDisclaimer } from "../../components/ui/MedicalDisclaimer";
import { useMedicineStore } from "../../store/medicineStore";
import { scheduleRepository } from "../../database/repositories/scheduleRepository";
import { ReminderSchedule } from "../../types";

export default function MedicinesScreen() {
  const router = useRouter();
  const {
    medicines,
    searchQuery,
    expiryFilter,
    reminderFilter,
    loadMedicines,
    setSearchQuery,
    setExpiryFilter,
    setReminderFilter,
  } = useMedicineStore();

  const [schedulesMap, setSchedulesMap] = useState<
    Map<string, ReminderSchedule>
  >(new Map());

  useEffect(() => {
    loadMedicines();
    const schedules = scheduleRepository.getAll();
    const map = new Map<string, ReminderSchedule>();
    for (const s of schedules) {
      map.set(s.medicineId, s);
    }
    setSchedulesMap(map);
  }, [loadMedicines]);

  return (
    <AppScreen scrollable contentContainerStyle={styles.scrollContent}>
      {/* Header */}
      <AppHeader
        title="My Medicines"
        subtitle="A little order for your medicine cabinet"
        brandText="HealthMate AI"
        onAddPress={() => router.push("/medicines/add")}
      />

      <View style={styles.body}>
        {/* Search Bar */}
        <View style={styles.searchContainer}>
          <Ionicons
            name="search"
            size={18}
            color={Colors.textTertiary}
            style={styles.searchIcon}
          />
          <TextInput
            style={styles.searchInput}
            placeholder="Name or ingredient"
            placeholderTextColor={Colors.textTertiary}
            value={searchQuery}
            onChangeText={setSearchQuery}
            clearButtonMode="while-editing"
          />
          {searchQuery.length > 0 && (
            <TouchableOpacity
              style={styles.clearSearchButton}
              onPress={() => setSearchQuery("")}
              accessibilityRole="button"
              accessibilityLabel="Clear search text"
              activeOpacity={0.7}
            >
              <Ionicons
                name="close-circle"
                size={18}
                color={Colors.textTertiary}
              />
            </TouchableOpacity>
          )}
        </View>

        {/* Filter Segment 1: All / Active / Expired */}
        <View style={styles.segmentControl}>
          {(["all", "active", "expired"] as const).map((filter) => {
            const isActive = expiryFilter === filter;
            const label = filter.charAt(0).toUpperCase() + filter.slice(1);
            return (
              <TouchableOpacity
                key={filter}
                style={[
                  styles.segmentButton,
                  isActive && styles.segmentButtonActive,
                ]}
                onPress={() => setExpiryFilter(filter)}
                activeOpacity={0.7}
              >
                <Text
                  style={[
                    styles.segmentText,
                    isActive && styles.segmentTextActive,
                  ]}
                >
                  {label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>

        {/* Filter Row 2: With Reminders / Without Reminders */}
        <View style={styles.reminderFilterRow}>
          <TouchableOpacity
            style={[
              styles.pillFilter,
              reminderFilter === "with" && styles.pillFilterActive,
            ]}
            onPress={() =>
              setReminderFilter(reminderFilter === "with" ? "all" : "with")
            }
            activeOpacity={0.7}
          >
            <Text
              style={[
                styles.pillFilterText,
                reminderFilter === "with" && styles.pillFilterTextActive,
              ]}
            >
              With Reminders
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[
              styles.pillFilter,
              reminderFilter === "without" && styles.pillFilterActive,
            ]}
            onPress={() =>
              setReminderFilter(
                reminderFilter === "without" ? "all" : "without",
              )
            }
            activeOpacity={0.7}
          >
            <Text
              style={[
                styles.pillFilterText,
                reminderFilter === "without" && styles.pillFilterTextActive,
              ]}
            >
              Without Reminders
            </Text>
          </TouchableOpacity>
        </View>

        {/* Section Header */}
        <SectionHeader title="In your cabinet" count={medicines.length} />

        {/* Medicines List */}
        {medicines.map((medicine) => (
          <MedicineCard
            key={medicine.id}
            medicine={medicine}
            schedule={schedulesMap.get(medicine.id)}
            onPress={() => router.push(`/medicines/${medicine.id}`)}
          />
        ))}

        {medicines.length === 0 ? (
          <View style={styles.emptyContainer}>
            <Text style={styles.emptyTitle}>No medicines found</Text>
            <Text style={styles.emptySubtitle}>
              Try adjusting your search or filters, or tap + Add to add a new
              medicine.
            </Text>
          </View>
        ) : null}

        {/* Medical Disclaimer */}
        <MedicalDisclaimer
          text="These are fictional example records. Review package details and expiry dates yourself. Reminder times are not dosing advice."
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
  searchContainer: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#E5E4EA",
    borderRadius: Radius.pill,
    paddingHorizontal: 12,
    height: 42,
    marginBottom: Spacing.md,
  },
  searchIcon: {
    marginRight: 8,
  },
  searchInput: {
    flex: 1,
    fontSize: 15,
    color: Colors.textPrimary,
  },
  clearSearchButton: {
    padding: 4,
  },
  segmentControl: {
    flexDirection: "row",
    backgroundColor: "#E4E3E8",
    borderRadius: Radius.pill,
    padding: 3,
    marginBottom: Spacing.sm,
  },
  segmentButton: {
    flex: 1,
    paddingVertical: 6,
    alignItems: "center",
    borderRadius: Radius.pill,
  },
  segmentButtonActive: {
    backgroundColor: "#FFFFFF",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 2,
  },
  segmentText: {
    fontSize: 13,
    fontWeight: "500",
    color: Colors.textSecondary,
  },
  segmentTextActive: {
    color: Colors.textPrimary,
    fontWeight: "700",
  },
  reminderFilterRow: {
    flexDirection: "row",
    gap: 8,
    marginBottom: Spacing.lg,
  },
  pillFilter: {
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: Radius.pill,
    backgroundColor: Colors.primaryLight,
  },
  pillFilterActive: {
    backgroundColor: Colors.primary,
  },
  pillFilterText: {
    fontSize: 13,
    fontWeight: "600",
    color: Colors.primary,
  },
  pillFilterTextActive: {
    color: Colors.textInverse,
  },
  emptyContainer: {
    alignItems: "center",
    paddingVertical: 40,
  },
  emptyTitle: {
    ...Typography.heading3,
    color: Colors.textPrimary,
    marginBottom: 6,
  },
  emptySubtitle: {
    ...Typography.bodyMedium,
    color: Colors.textSecondary,
    textAlign: "center",
    paddingHorizontal: 20,
  },
});
