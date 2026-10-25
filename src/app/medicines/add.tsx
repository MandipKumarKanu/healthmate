import React, { useState } from 'react';
import {
  StyleSheet,
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  Alert,
} from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Colors } from '../../theme/colors';
import { Radius, Spacing, Typography } from '../../theme/tokens';
import { AppScreen } from '../../components/ui/AppScreen';
import { AppHeader } from '../../components/ui/AppHeader';
import { AppCard } from '../../components/ui/AppCard';
import { AppButton } from '../../components/ui/AppButton';
import { SectionHeader } from '../../components/ui/SectionHeader';
import { useMedicineStore } from '../../store/medicineStore';
import { DosageForm, Medicine } from '../../types';

export default function AddMedicineScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{
    name?: string;
    strength?: string;
    form?: string;
    expiry?: string;
    batch?: string;
    manufacturer?: string;
  }>();

  const { addMedicine } = useMedicineStore();

  const [name, setName] = useState(params.name || '');
  const [strength, setStrength] = useState(params.strength || '');
  const [dosageForm, setDosageForm] = useState<DosageForm>(
    (params.form as DosageForm) || 'tablet'
  );
  const [category, setCategory] = useState('Generic');
  const [expiryDate, setExpiryDate] = useState(params.expiry || '');
  const [batchNumber, setBatchNumber] = useState(params.batch || '');
  const [manufacturer, setManufacturer] = useState(params.manufacturer || '');
  const [instructions, setInstructions] = useState('');

  const forms: DosageForm[] = [
    'tablet',
    'capsule',
    'softgel',
    'eye_drop',
    'syrup',
    'cream',
  ];

  const handleSave = () => {
    if (!name.trim()) {
      Alert.alert('Validation Error', 'Please enter a medicine name.');
      return;
    }

    const newMed = addMedicine({
      id: `med_${Date.now()}`,
      name: name.trim(),
      strength: strength.trim() || 'Standard dose',
      dosageForm,
      category,
      packageDetails: {
        manufacturer: manufacturer.trim() || undefined,
        expiryDate: expiryDate.trim() || undefined,
        batchNumber: batchNumber.trim() || undefined,
        packageDetailsText: instructions.trim() || undefined,
        originalPackageChecked: false,
      },
      informationSource: 'User-entered medication record.',
      isSample: false,
    });

    Alert.alert('Success', `${newMed.name} added to your cabinet!`, [
      { text: 'OK', onPress: () => router.back() },
    ]);
  };

  return (
    <AppScreen scrollable contentContainerStyle={styles.scrollContent}>
      <AppHeader
        title="Add Medicine"
        subtitle="Record a new medication in your cabinet"
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
                {f.replace('_', ' ').toUpperCase()}
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

        {/* Save Button */}
        <View style={styles.saveContainer}>
          <AppButton
            title="Save to Medicine Cabinet"
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
    fontWeight: '600',
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
    flexDirection: 'row',
    marginBottom: Spacing.lg,
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
    fontWeight: '600',
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
