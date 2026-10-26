import React, { useState, useEffect } from "react";
import {
  StyleSheet,
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  } from "react-native";
import { AppAlert as Alert } from "../../services/appAlert";
import { useRouter, useLocalSearchParams } from "expo-router";
import { Colors } from "../../theme/colors";
import { Radius, Spacing, Typography } from "../../theme/tokens";
import { AppScreen } from "../../components/ui/AppScreen";
import { AppHeader } from "../../components/ui/AppHeader";
import { AppCard } from "../../components/ui/AppCard";
import { AppButton } from "../../components/ui/AppButton";
import { SectionHeader } from "../../components/ui/SectionHeader";
import { useMedicineStore } from "../../store/medicineStore";
import { medicineRepository } from "../../database/repositories/medicineRepository";
import { DosageForm, Medicine } from "../../types";

export default function AddMedicineScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{
    editId?: string;
    name?: string;
    strength?: string;
    form?: string;
    expiry?: string;
    batch?: string;
    manufacturer?: string;
  }>();

  const isEditing = Boolean(params.editId);
  const { addMedicine, updateMedicine } = useMedicineStore();

  const [name, setName] = useState(params.name || "");
  const [strength, setStrength] = useState(params.strength || "");
  const [dosageForm, setDosageForm] = useState<DosageForm>(
    (params.form as DosageForm) || "tablet",
  );
  const [category, setCategory] = useState("Generic");
  const [expiryDate, setExpiryDate] = useState(params.expiry || "");
  const [batchNumber, setBatchNumber] = useState(params.batch || "");
  const [manufacturer, setManufacturer] = useState(params.manufacturer || "");
  const [instructions, setInstructions] = useState("");
  const [currentStock, setCurrentStock] = useState("");
  const [refillThreshold, setRefillThreshold] = useState("");

  useEffect(() => {
    if (params.editId) {
      const existing = medicineRepository.getById(params.editId);
      if (existing) {
        setName(existing.name);
        setStrength(existing.strength);
        setDosageForm(existing.dosageForm);
        setCategory(existing.category || "Generic");
        setExpiryDate(existing.packageDetails?.expiryDate || "");
        setBatchNumber(existing.packageDetails?.batchNumber || "");
        setManufacturer(existing.packageDetails?.manufacturer || "");
        setInstructions(existing.packageDetails?.packageDetailsText || "");
        setCurrentStock(
          existing.currentInventory != null ? String(existing.currentInventory) : "",
        );
        setRefillThreshold(
          existing.refillThreshold != null ? String(existing.refillThreshold) : "",
        );
      }
    }
  }, [params.editId]);

  const forms: DosageForm[] = [
    "tablet",
    "capsule",
    "softgel",
    "eye_drop",
    "syrup",
    "cream",
  ];

  const parseOptionalInt = (value: string): number | undefined => {
    const trimmed = value.trim();
    if (!trimmed) return undefined;
    const parsed = Number.parseInt(trimmed, 10);
    return Number.isNaN(parsed) ? undefined : Math.max(0, parsed);
  };

  const handleSave = () => {
    const trimmedName = name.trim();
    if (!trimmedName) {
      Alert.alert("Validation Error", "Please enter a medicine name.");
      return;
    }

    if (isEditing && params.editId) {
      updateMedicine(params.editId, {
        name: trimmedName,
        strength: strength.trim() || "Standard dose",
        dosageForm,
        category,
        packageDetails: {
          manufacturer: manufacturer.trim() || undefined,
          expiryDate: expiryDate.trim() || undefined,
          batchNumber: batchNumber.trim() || undefined,
          packageDetailsText: instructions.trim() || undefined,
        },
        currentInventory: parseOptionalInt(currentStock),
        refillThreshold: parseOptionalInt(refillThreshold),
      });

      Alert.alert("Success", `${trimmedName} updated successfully!`, [
        { text: "OK", onPress: () => router.back() },
      ]);
    } else {
      const newMed = addMedicine({
        id: `med_${Date.now()}`,
        name: trimmedName,
        strength: strength.trim() || "Standard dose",
        dosageForm,
        category,
        packageDetails: {
          manufacturer: manufacturer.trim() || undefined,
          expiryDate: expiryDate.trim() || undefined,
          batchNumber: batchNumber.trim() || undefined,
          packageDetailsText: instructions.trim() || undefined,
          originalPackageChecked: false,
        },
        informationSource: "User-entered medication record.",
        isSample: false,
        currentInventory: parseOptionalInt(currentStock),
        refillThreshold: parseOptionalInt(refillThreshold),
      });

      Alert.alert("Success", `${newMed.name} added to your cabinet!`, [
        { text: "OK", onPress: () => router.back() },
      ]);
    }
  };

  return (
    <AppScreen scrollable contentContainerStyle={styles.scrollContent}>
      <AppHeader
        title={isEditing ? "Edit Medicine" : "Add Medicine"}
        subtitle={
          isEditing
            ? "Update medication details in your cabinet"
            : "Record a new medication in your cabinet"
        }
        brandText="HealthMate AI"
        onBackPress={() => router.back()}
      />

      <View style={styles.body}>
        {/* Name & Strength */}
        <SectionHeader title="Medicine Information" />
        <AppCard style={styles.card}>
          <Text style={styles.inputLabel}>Medicine Name *</Text>
          <TextInput
            style={styles.input}
            placeholder="e.g. Metformin"
            placeholderTextColor={Colors.textTertiary}
            value={name}
            onChangeText={setName}
          />

          <View style={styles.divider} />

          <Text style={styles.inputLabel}>Strength</Text>
          <TextInput
            style={styles.input}
            placeholder="e.g. 500 mg or 10 mg"
            placeholderTextColor={Colors.textTertiary}
            value={strength}
            onChangeText={setStrength}
          />
        </AppCard>

        {/* Dosage Form Selector */}
        <SectionHeader title="Dosage Form" />
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.formScroll}
        >
          {forms.map((f) => (
            <TouchableOpacity
              key={f}
              style={[
                styles.formChip,
                dosageForm === f && styles.formChipActive,
              ]}
              onPress={() => setDosageForm(f)}
            >
              <Text
                style={[
                  styles.formChipText,
                  dosageForm === f && styles.formChipTextActive,
                ]}
              >
                {f.replace("_", " ").toUpperCase()}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>

        {/* Package Details */}
        <SectionHeader title="Package Details" />
        <AppCard style={styles.card}>
          <Text style={styles.inputLabel}>Expiry Date</Text>
          <TextInput
            style={styles.input}
            placeholder="e.g. Dec 2027"
            placeholderTextColor={Colors.textTertiary}
            value={expiryDate}
            onChangeText={setExpiryDate}
          />

          <View style={styles.divider} />

          <Text style={styles.inputLabel}>Batch / Lot Number</Text>
          <TextInput
            style={styles.input}
            placeholder="e.g. DEMO-123"
            placeholderTextColor={Colors.textTertiary}
            value={batchNumber}
            onChangeText={setBatchNumber}
          />

          <View style={styles.divider} />

          <Text style={styles.inputLabel}>Manufacturer</Text>
          <TextInput
            style={styles.input}
            placeholder="e.g. PharmaCorp"
            placeholderTextColor={Colors.textTertiary}
            value={manufacturer}
            onChangeText={setManufacturer}
          />
        </AppCard>

        {/* Instructions */}
        <SectionHeader title="Label Instructions" />
        <AppCard style={styles.card}>
          <TextInput
            style={[styles.input, { minHeight: 60 }]}
            placeholder="e.g. Take with food twice daily"
            placeholderTextColor={Colors.textTertiary}
            value={instructions}
            onChangeText={setInstructions}
            multiline
          />
        </AppCard>

        {/* Inventory tracking (optional) */}
        <SectionHeader title="Inventory Tracking (optional)" />
        <AppCard style={styles.card}>
          <Text style={styles.inputLabel}>Current stock</Text>
          <TextInput
            style={styles.input}
            placeholder="e.g. 30 — leave empty to skip tracking"
            placeholderTextColor={Colors.textTertiary}
            value={currentStock}
            onChangeText={setCurrentStock}
            keyboardType="number-pad"
          />

          <View style={styles.divider} />

          <Text style={styles.inputLabel}>Refill alert threshold</Text>
          <TextInput
            style={styles.input}
            placeholder="e.g. 5"
            placeholderTextColor={Colors.textTertiary}
            value={refillThreshold}
            onChangeText={setRefillThreshold}
            keyboardType="number-pad"
          />

          <Text style={styles.trackingHint}>
            Each logged &quot;taken&quot; dose decrements your stock. When stock
            reaches the threshold you get a refill nudge. Only the two fields
            you fill in are tracked.
          </Text>
        </AppCard>

        {/* Save Button */}
        <View style={styles.saveContainer}>
          <AppButton
            title={isEditing ? "Save Changes" : "Save to Medicine Cabinet"}
            onPress={handleSave}
            variant="primary"
            size="lg"
          />
        </View>
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
  card: {
    marginBottom: Spacing.lg,
    paddingVertical: 10,
  },
  inputLabel: {
    fontSize: 12,
    fontWeight: "600",
    color: Colors.textSecondary,
    marginBottom: 4,
  },
  input: {
    fontSize: 15,
    color: Colors.textPrimary,
    paddingVertical: 6,
  },
  divider: {
    height: 1,
    backgroundColor: Colors.borderLight,
    marginVertical: 10,
  },
  formScroll: {
    flexDirection: "row",
    marginBottom: Spacing.lg,
  },
  trackingHint: {
    fontSize: 12,
    color: Colors.textTertiary,
    marginTop: 8,
    lineHeight: 17,
  },
  formChip: {
    backgroundColor: Colors.cardBackground,
    borderWidth: 1,
    borderColor: Colors.border,
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: Radius.pill,
    marginRight: 8,
  },
  formChipActive: {
    backgroundColor: Colors.primary,
    borderColor: Colors.primary,
  },
  formChipText: {
    fontSize: 12,
    fontWeight: "600",
    color: Colors.textPrimary,
  },
  formChipTextActive: {
    color: Colors.textInverse,
  },
  saveContainer: {
    marginTop: Spacing.sm,
    marginBottom: Spacing.xl,
  },
});
