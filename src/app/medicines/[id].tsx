import React, { useState } from "react";
import { StyleSheet, View, Text, TouchableOpacity, Alert } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Ionicons, Feather, MaterialCommunityIcons } from "@expo/vector-icons";
import { Colors } from "../../theme/colors";
import { Radius, Spacing, Typography } from "../../theme/tokens";
import { AppScreen } from "../../components/ui/AppScreen";
import { AppHeader } from "../../components/ui/AppHeader";
import { AppCard } from "../../components/ui/AppCard";
import { AppButton } from "../../components/ui/AppButton";
import { MedicineIcon } from "../../components/ui/MedicineIcon";
import { SectionHeader } from "../../components/ui/SectionHeader";
import { MedicalDisclaimer } from "../../components/ui/MedicalDisclaimer";
import { ConfirmDialog } from "../../components/ui/ConfirmDialog";
import { medicineRepository } from "../../database/repositories/medicineRepository";
import { scheduleRepository } from "../../database/repositories/scheduleRepository";
import { useMedicineStore } from "../../store/medicineStore";

export default function MedicineDetailsScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { deleteMedicine } = useMedicineStore();

  const [expandedSection, setExpandedSection] = useState<string | null>(null);
  const [showDeleteModal, setShowDeleteModal] = useState(false);

  const storeMedicine = useMedicineStore((s) =>
    s.medicines.find((m) => m.id === id),
  );
  const medicine = storeMedicine || medicineRepository.getById(id || "");
  const schedule = id ? scheduleRepository.getByMedicineId(id) : null;

  if (!medicine) {
    return (
      <AppScreen scrollable contentContainerStyle={styles.container}>
        <AppHeader title="Medicine Details" onBackPress={() => router.back()} />
        <View style={styles.notFoundContainer}>
          <Text style={styles.notFoundText}>Medicine not found.</Text>
          <AppButton
            title="Go back"
            onPress={() => router.back()}
            variant="outline"
            size="md"
            style={{ marginTop: 16 }}
          />
        </View>
      </AppScreen>
    );
  }

  const toggleExpand = (section: string) => {
    setExpandedSection(expandedSection === section ? null : section);
  };

  const handleMenuPress = () => {
    Alert.alert(medicine.name, "Choose an action for this medication", [
      {
        text: "Edit Medicine Details",
        onPress: () => router.push(`/medicines/add?editId=${medicine.id}`),
      },
      {
        text: "Set / Edit Reminder",
        onPress: () =>
          router.push(`/reminders/create?medicineId=${medicine.id}`),
      },
      {
        text: "Delete Medicine",
        style: "destructive",
        onPress: () => setShowDeleteModal(true),
      },
      {
        text: "Cancel",
        style: "cancel",
      },
    ]);
  };

  const confirmDelete = async () => {
    try {
      const deleted = await deleteMedicine(medicine.id);
      if (!deleted) {
        Alert.alert(
          "Could not delete medicine",
          "This medicine may already have been removed.",
        );
        return;
      }
      setShowDeleteModal(false);
      router.back();
    } catch (error) {
      console.error("Could not delete medicine:", error);
      Alert.alert(
        "Could not delete medicine",
        "Please try again. Your record has not been confirmed as deleted.",
      );
    }
  };

  const formatScheduleText = () => {
    if (!schedule || !schedule.enabled || schedule.times.length === 0) {
      return "No reminder schedule set";
    }
    const times = schedule.times.map((t) => t.time).join(" & ");
    const recurrenceStr =
      schedule.recurrence === "daily"
        ? "Every day"
        : schedule.recurrence.charAt(0).toUpperCase() +
          schedule.recurrence.slice(1);
    return `${times} · ${recurrenceStr}`;
  };

  const scheduleDoseNote = schedule?.times[0]?.amount
    ? `${schedule.times[0].amount} per reminder · Confirm against your prescription`
    : "No saved dose amount";

  return (
    <AppScreen scrollable contentContainerStyle={styles.scrollContent}>
      {/* Header */}
      <AppHeader
        title="Medicine Details"
        brandText="HealthMate AI"
        onBackPress={() => router.back()}
        onMenuPress={handleMenuPress}
      />

      <View style={styles.body}>
        {/* Card 1: Medicine Hero Summary */}
        <AppCard style={styles.heroCard}>
          <View style={styles.heroTopRow}>
            <MedicineIcon
              form={medicine.dosageForm}
              name={medicine.name}
              size={52}
            />
            <View style={styles.heroInfo}>
              <View style={styles.heroNameRow}>
                <Text style={styles.heroName}>{medicine.name}</Text>
                <TouchableOpacity
                  style={styles.editBadgeButton}
                  onPress={() =>
                    router.push(`/medicines/add?editId=${medicine.id}`)
                  }
                  accessibilityRole="button"
                  accessibilityLabel="Edit medicine details"
                  activeOpacity={0.7}
                >
                  <Feather name="edit-2" size={13} color={Colors.primary} />
                  <Text style={styles.editBadgeButtonText}>Edit</Text>
                </TouchableOpacity>
              </View>
              <Text style={styles.heroSub}>
                {medicine.strength} ·{" "}
                {medicine.dosageForm.charAt(0).toUpperCase() +
                  medicine.dosageForm.slice(1)}
                s · {medicine.category}
              </Text>
            </View>
          </View>

          <View style={styles.exampleTag}>
            <Text style={styles.exampleTagText}>
              {medicine.isSample
                ? "Fictional demonstration data · Not real medication data"
                : medicine.packageDetails.originalPackageChecked
                  ? "Marked as reviewed by you · Not independently verified"
                  : medicine.informationSource?.toLowerCase().includes("scan")
                    ? "OCR-extracted draft · Verify every field against the package"
                    : "User-entered details · Not independently verified"}
            </Text>
          </View>

          <Text style={styles.addedDateText}>
            Added{" "}
            {Number.isNaN(Date.parse(medicine.createdAt))
              ? "date unavailable"
              : new Date(medicine.createdAt).toLocaleDateString()}{" "}
            · HealthMate has not clinically verified this record
          </Text>
        </AppCard>

        {/* Warning Banner: Your prescription comes first */}
        <View style={styles.warningBanner}>
          <View style={styles.warningHeader}>
            <Ionicons name="warning-outline" size={18} color="#D97706" />
            <Text style={styles.warningTitle}>
              Your prescription comes first
            </Text>
          </View>
          <Text style={styles.warningBody}>
            Only your healthcare professional or prescription label can confirm
            why this medicine was prescribed for you and the dose you should
            take. Do not change medication based on this app.
          </Text>
        </View>

        {/* Section: From your package */}
        <SectionHeader title="From your package" />
        <AppCard style={styles.packageCard}>
          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>Medicine name</Text>
            <Text style={styles.infoValue}>{medicine.name}</Text>
          </View>

          <View style={styles.rowDivider} />

          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>Strength</Text>
            <Text style={styles.infoValue}>{medicine.strength}</Text>
          </View>

          <View style={styles.rowDivider} />

          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>Form</Text>
            <Text style={styles.infoValue}>
              {medicine.dosageForm.charAt(0).toUpperCase() +
                medicine.dosageForm.slice(1)}
            </Text>
          </View>

          <View style={styles.rowDivider} />

          <TouchableOpacity
            style={styles.originalPackageRow}
            onPress={() => router.push("/(tabs)/scan")}
            activeOpacity={0.7}
          >
            <Ionicons name="scan-outline" size={20} color={Colors.primary} />
            <View style={styles.originalPackageTextContainer}>
              <Text style={styles.originalPackageTitle}>Original package</Text>
              <Text style={styles.originalPackageSub}>
                Check all details against your label
              </Text>
            </View>
            <Ionicons
              name="chevron-forward"
              size={16}
              color={Colors.textTertiary}
            />
          </TouchableOpacity>
        </AppCard>

        {/* Section: General educational information */}
        <SectionHeader title="General educational information" />
        <AppCard style={styles.educationCard}>
          <Text style={styles.eduQuestion}>What is it used for?</Text>
          <Text style={styles.eduBody}>
            No reviewed patient leaflet is linked to this record. This screen
            does not establish why you take this medicine or whether it is
            appropriate for you. Check the leaflet for your exact product or ask
            a pharmacist.
          </Text>

          {/* Action pills: Explain simply / Why prescribed? */}
          <View style={styles.pillActionRow}>
            <TouchableOpacity
              style={styles.explainButton}
              onPress={() =>
                router.push({
                  pathname: "/ai-assistant",
                  params: { query: `Explain ${medicine.name} simply` },
                })
              }
              activeOpacity={0.7}
            >
              <Text style={styles.explainButtonText}>Explain simply</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.whyButton}
              onPress={() =>
                router.push({
                  pathname: "/ai-assistant",
                  params: { query: `Why is ${medicine.name} prescribed?` },
                })
              }
              activeOpacity={0.7}
            >
              <Text style={styles.whyButtonText}>Why prescribed?</Text>
            </TouchableOpacity>
          </View>

          {/* Expandable Educational Accordion Items */}
          <View style={styles.accordionContainer}>
            {/* How does it work? */}
            <TouchableOpacity
              style={styles.accordionRow}
              onPress={() => toggleExpand("how")}
            >
              <Text style={styles.accordionTitle}>How does it work?</Text>
              <Ionicons
                name={
                  expandedSection === "how" ? "chevron-up" : "chevron-forward"
                }
                size={16}
                color={Colors.textTertiary}
              />
            </TouchableOpacity>
            {expandedSection === "how" ? (
              <Text style={styles.accordionBody}>
                No medicine-specific mechanism information has been verified for
                this record. Check the official patient leaflet for your exact
                product or ask a pharmacist.
              </Text>
            ) : null}

            <View style={styles.rowDivider} />

            {/* Common uses */}
            <TouchableOpacity
              style={styles.accordionRow}
              onPress={() => toggleExpand("uses")}
            >
              <Text style={styles.accordionTitle}>Common uses</Text>
              <Ionicons
                name={
                  expandedSection === "uses" ? "chevron-up" : "chevron-forward"
                }
                size={16}
                color={Colors.textTertiary}
              />
            </TouchableOpacity>
            {expandedSection === "uses" ? (
              <Text style={styles.accordionBody}>
                Uses depend on the active ingredient, formulation, and your
                clinical circumstances. This record does not contain a reviewed
                list of approved uses.
              </Text>
            ) : null}

            <View style={styles.rowDivider} />

            {/* Important safety information */}
            <TouchableOpacity
              style={styles.accordionRow}
              onPress={() => toggleExpand("safety")}
            >
              <View style={styles.safetyRow}>
                <Ionicons
                  name="shield-outline"
                  size={16}
                  color={Colors.primary}
                  style={{ marginRight: 6 }}
                />
                <Text style={styles.accordionTitle}>
                  Important safety information
                </Text>
              </View>
              <Ionicons
                name={
                  expandedSection === "safety"
                    ? "chevron-up"
                    : "chevron-forward"
                }
                size={16}
                color={Colors.textTertiary}
              />
            </TouchableOpacity>
            {expandedSection === "safety" ? (
              <Text style={styles.accordionBody}>
                Storage and precautions vary by product. Follow the instructions
                on the original package and patient leaflet, and ask a
                pharmacist if they are unclear.
              </Text>
            ) : null}

            <View style={styles.rowDivider} />

            {/* Common side effects */}
            <TouchableOpacity
              style={styles.accordionRow}
              onPress={() => toggleExpand("effects")}
            >
              <Text style={styles.accordionTitle}>Common side effects</Text>
              <Ionicons
                name={
                  expandedSection === "effects"
                    ? "chevron-up"
                    : "chevron-forward"
                }
                size={16}
                color={Colors.textTertiary}
              />
            </TouchableOpacity>
            {expandedSection === "effects" ? (
              <Text style={styles.accordionBody}>
                No reviewed product-specific side-effect list is linked to this
                record. Check the patient leaflet for your exact product or ask
                a pharmacist about concerns.
              </Text>
            ) : null}
          </View>
        </AppCard>

        {/* Section: Your schedule */}
        <SectionHeader
          title="Your schedule"
          actionText="+ Add Dose"
          onActionPress={() =>
            router.push(`/reminders/create?medicineId=${medicine.id}`)
          }
        />
        <AppCard style={styles.scheduleCard}>
          <Text style={styles.scheduleTitle}>{formatScheduleText()}</Text>
          <Text style={styles.scheduleNote}>{scheduleDoseNote}</Text>

          <TouchableOpacity
            style={styles.setReminderButton}
            onPress={() =>
              router.push(`/reminders/create?medicineId=${medicine.id}`)
            }
            activeOpacity={0.7}
          >
            <Text style={styles.setReminderButtonText}>Set Reminder</Text>
          </TouchableOpacity>
        </AppCard>

        {/* Section: Package details */}
        <SectionHeader title="Package details" />
        <AppCard style={styles.packageDetailsCard}>
          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>Manufacturer</Text>
            <Text style={styles.infoValue}>
              {medicine.packageDetails.manufacturer ?? "Fictional data"}
            </Text>
          </View>

          <View style={styles.rowDivider} />

          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>Expiry</Text>
            <Text style={styles.infoValue}>
              {medicine.packageDetails.expiryDate ?? "N/A"}
            </Text>
          </View>

          <View style={styles.rowDivider} />

          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>Batch</Text>
            <Text style={styles.infoValue}>
              {medicine.packageDetails.batchNumber ?? "DEMO-001"}
            </Text>
          </View>

          <View style={styles.rowDivider} />

          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>Package details</Text>
            <Text style={styles.infoValue}>
              {medicine.packageDetails.packageDetailsText ??
                "Example values, not a verified scan"}
            </Text>
          </View>
        </AppCard>

        {/* Section: Information Source */}
        <SectionHeader title="Information Source" />
        <AppCard style={styles.sourceCard}>
          <Text style={styles.sourceTitle}>
            Example package record entered for this design.
          </Text>
          <Text style={styles.sourceBody}>
            {medicine.informationSource ||
              "No verified clinical reference is attached. Educational sections are not a substitute for the package leaflet or professional advice."}
          </Text>
        </AppCard>

        {/* Medical Disclaimer */}
        <MedicalDisclaimer />
      </View>

      {/* Delete Confirmation Modal */}
      <ConfirmDialog
        visible={showDeleteModal}
        title="Delete Medicine"
        message={`Are you sure you want to remove ${medicine.name} from your cabinet? Associated schedules will also be removed.`}
        confirmText="Delete"
        destructive
        onConfirm={confirmDelete}
        onCancel={() => setShowDeleteModal(false)}
      />
    </AppScreen>
  );
}

const styles = StyleSheet.create({
  scrollContent: {
    paddingBottom: 60,
  },
  container: {
    paddingBottom: 40,
  },
  body: {
    paddingHorizontal: Spacing.screenPaddingHorizontal,
  },
  notFoundContainer: {
    alignItems: "center",
    padding: Spacing.xl,
  },
  notFoundText: {
    ...Typography.heading2,
    color: Colors.textPrimary,
  },
  heroCard: {
    marginBottom: Spacing.md,
  },
  heroTopRow: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 12,
  },
  heroInfo: {
    marginLeft: Spacing.md,
    flex: 1,
  },
  heroNameRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  heroName: {
    fontSize: 22,
    fontWeight: "800",
    color: Colors.textPrimary,
    flex: 1,
    marginRight: 8,
  },
  editBadgeButton: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: Colors.primaryLight,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: Radius.pill,
  },
  editBadgeButtonText: {
    fontSize: 12,
    fontWeight: "600",
    color: Colors.primary,
    marginLeft: 4,
  },
  heroSub: {
    fontSize: 13,
    color: Colors.textSecondary,
    marginTop: 2,
  },
  exampleTag: {
    backgroundColor: "#FEF6E9",
    paddingVertical: 4,
    paddingHorizontal: 10,
    borderRadius: Radius.pill,
    alignSelf: "flex-start",
    marginBottom: 8,
  },
  exampleTagText: {
    fontSize: 12,
    fontWeight: "600",
    color: "#D97706",
  },
  addedDateText: {
    fontSize: 12,
    color: Colors.textTertiary,
  },
  warningBanner: {
    backgroundColor: "#FFF8EC",
    borderRadius: Radius.card,
    padding: Spacing.cardPadding,
    borderWidth: 1,
    borderColor: "#FDE4BC",
    marginBottom: Spacing.lg,
  },
  warningHeader: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 6,
  },
  warningTitle: {
    fontSize: 14,
    fontWeight: "700",
    color: "#B45309",
    marginLeft: 6,
  },
  warningBody: {
    fontSize: 12,
    lineHeight: 18,
    color: "#92400E",
  },
  packageCard: {
    marginBottom: Spacing.lg,
    paddingVertical: 6,
  },
  infoRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 12,
  },
  infoLabel: {
    fontSize: 14,
    color: Colors.textPrimary,
    fontWeight: "500",
  },
  infoValue: {
    fontSize: 14,
    color: Colors.textSecondary,
    fontWeight: "400",
  },
  rowDivider: {
    height: 1,
    backgroundColor: Colors.borderLight,
  },
  originalPackageRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 12,
  },
  originalPackageTextContainer: {
    flex: 1,
    marginLeft: 10,
  },
  originalPackageTitle: {
    fontSize: 14,
    fontWeight: "600",
    color: Colors.textPrimary,
  },
  originalPackageSub: {
    fontSize: 12,
    color: Colors.textSecondary,
    marginTop: 1,
  },
  educationCard: {
    marginBottom: Spacing.lg,
  },
  eduQuestion: {
    fontSize: 16,
    fontWeight: "700",
    color: Colors.textPrimary,
    marginBottom: 6,
  },
  eduBody: {
    fontSize: 13,
    lineHeight: 19,
    color: Colors.textSecondary,
    marginBottom: 14,
  },
  pillActionRow: {
    flexDirection: "row",
    gap: 8,
    marginBottom: 16,
  },
  explainButton: {
    backgroundColor: Colors.primary,
    paddingVertical: 7,
    paddingHorizontal: 14,
    borderRadius: Radius.pill,
  },
  explainButtonText: {
    fontSize: 13,
    fontWeight: "600",
    color: Colors.textInverse,
  },
  whyButton: {
    backgroundColor: "#EAE9EF",
    paddingVertical: 7,
    paddingHorizontal: 14,
    borderRadius: Radius.pill,
  },
  whyButtonText: {
    fontSize: 13,
    fontWeight: "600",
    color: Colors.textPrimary,
  },
  accordionContainer: {
    borderTopWidth: 1,
    borderTopColor: Colors.borderLight,
    paddingTop: 4,
  },
  accordionRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 12,
  },
  safetyRow: {
    flexDirection: "row",
    alignItems: "center",
  },
  accordionTitle: {
    fontSize: 14,
    fontWeight: "500",
    color: Colors.textPrimary,
  },
  accordionBody: {
    fontSize: 13,
    lineHeight: 18,
    color: Colors.textSecondary,
    paddingBottom: 10,
  },
  scheduleCard: {
    marginBottom: Spacing.lg,
  },
  scheduleTitle: {
    fontSize: 16,
    fontWeight: "700",
    color: Colors.textPrimary,
  },
  scheduleNote: {
    fontSize: 12,
    color: Colors.textSecondary,
    marginTop: 4,
    marginBottom: 14,
  },
  setReminderButton: {
    backgroundColor: "#F0EFEF",
    borderRadius: Radius.pill,
    paddingVertical: 10,
    alignItems: "center",
  },
  setReminderButtonText: {
    fontSize: 14,
    fontWeight: "600",
    color: Colors.textPrimary,
  },
  packageDetailsCard: {
    marginBottom: Spacing.lg,
    paddingVertical: 6,
  },
  sourceCard: {
    marginBottom: Spacing.lg,
  },
  sourceTitle: {
    fontSize: 14,
    fontWeight: "700",
    color: Colors.textPrimary,
    marginBottom: 6,
  },
  sourceBody: {
    fontSize: 12,
    lineHeight: 18,
    color: Colors.textSecondary,
  },
});
