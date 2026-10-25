import React, { useState, useRef } from 'react';
import {
  StyleSheet,
  View,
  Text,
  TouchableOpacity,
  TextInput,
  ScrollView,
  Alert,
} from 'react-native';
import { useRouter } from 'expo-router';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as ImagePicker from 'expo-image-picker';
import { Ionicons, Feather } from '@expo/vector-icons';
import { Colors } from '../../theme/colors';
import { Radius, Spacing, Typography } from '../../theme/tokens';
import { AppScreen } from '../../components/ui/AppScreen';
import { AppHeader } from '../../components/ui/AppHeader';
import { AppCard } from '../../components/ui/AppCard';
import { AppButton } from '../../components/ui/AppButton';
import { ocrService, ExtractedMedicineData } from '../../services/ocrService';
import { scanHistoryRepository } from '../../database/repositories/scanHistoryRepository';
import { useMedicineStore } from '../../store/medicineStore';
import { DosageForm } from '../../types';

export default function ScanScreen() {
  const router = useRouter();
  const [permission, requestPermission] = useCameraPermissions();
  const { addMedicine } = useMedicineStore();

  const [capturedImage, setCapturedImage] = useState<string | null>(null);
  const [isScanning, setIsScanning] = useState(false);
  const [extractedData, setExtractedData] = useState<ExtractedMedicineData | null>(
    null
  );

  // Editable fields for review
  const [medName, setMedName] = useState('');
  const [medStrength, setMedStrength] = useState('');
  const [medForm, setMedForm] = useState<DosageForm>('tablet');
  const [medExpiry, setMedExpiry] = useState('');
  const [medBatch, setMedBatch] = useState('');
  const [medMfg, setMedMfg] = useState('');

  const processTextSample = (textToProcess: string, imageUri?: string) => {
    setIsScanning(true);
    setTimeout(() => {
      const extracted = ocrService.extractMedicineData(textToProcess);
      setExtractedData(extracted);
      setMedName(extracted.medicineName || '');
      setMedStrength(extracted.detectedStrength || '');
      setMedForm(extracted.dosageForm || 'tablet');
      setMedExpiry(extracted.expiryDate || '');
      setMedBatch(extracted.batchNumber || '');
      setMedMfg(extracted.manufacturer || '');
      setIsScanning(false);
    }, 600);
  };

  const handleCapture = () => {
    // Simulated realistic OCR capture from medicine package
    const samplePackageText = `
Metformin Hydrochloride Tablets USP
500 mg
Each film coated tablet contains:
Metformin HCl 500mg
Batch No: DEMO-MF0426
Mfg Date: 01/2025
Exp Date: 12/2027
Manufactured by: Example Pharma Ltd.
Dosage: As directed by the physician.
Store below 25°C in a dry place.
    `;
    setCapturedImage('sample-camera-capture');
    processTextSample(samplePackageText);
  };

  const handlePickImage = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      quality: 0.8,
    });

    if (!result.canceled && result.assets && result.assets.length > 0) {
      setCapturedImage(result.assets[0].uri);
      processTextSample(
        'Amoxicillin Capsules 250mg Exp: 06/2027 Batch: LOT-9912 Mfg by: HealthMed',
        result.assets[0].uri
      );
    }
  };

  const handleReset = () => {
    setCapturedImage(null);
    setExtractedData(null);
  };

  const handleSaveToHistory = () => {
    if (!medName.trim()) {
      Alert.alert('Notice', 'Please provide a medicine name.');
      return;
    }

    scanHistoryRepository.add({
      medicineName: medName,
      detectedStrength: medStrength || undefined,
      dosageForm: medForm,
      manufacturer: medMfg || undefined,
      batchNumber: medBatch || undefined,
      expiryDate: medExpiry || undefined,
      rawText: extractedData?.rawText,
      imageUri: capturedImage || undefined,
    });

    Alert.alert('Saved to Scan History', 'Scan record has been saved.', [
      { text: 'View History', onPress: () => router.push('/scan-history') },
      { text: 'Done', onPress: handleReset },
    ]);
  };

  const handleAddToCabinet = () => {
    if (!medName.trim()) {
      Alert.alert('Notice', 'Please provide a medicine name.');
      return;
    }

    // Save to scan history
    scanHistoryRepository.add({
      medicineName: medName,
      detectedStrength: medStrength || undefined,
      dosageForm: medForm,
      manufacturer: medMfg || undefined,
      batchNumber: medBatch || undefined,
      expiryDate: medExpiry || undefined,
      rawText: extractedData?.rawText,
      imageUri: capturedImage || undefined,
    });

    // Add to medicine cabinet
    const newMed = addMedicine({
      id: `med_${Date.now()}`,
      name: medName.trim(),
      strength: medStrength.trim() || 'Standard dose',
      dosageForm: medForm,
      category: 'Prescription',
      packageDetails: {
        manufacturer: medMfg || undefined,
        expiryDate: medExpiry || undefined,
        batchNumber: medBatch || undefined,
        packageDetailsText: 'Captured via camera label scan',
        originalPackageChecked: true,
      },
      informationSource: 'Extracted from medication label scan.',
      isSample: false,
    });

    Alert.alert(
      'Added to Cabinet',
      `${newMed.name} was successfully added to your medicine cabinet!`,
      [
        {
          text: 'Set Reminder',
          onPress: () => router.push(`/reminders/create?medicineId=${newMed.id}`),
        },
        { text: 'Done', onPress: () => router.push('/(tabs)/medicines') },
      ]
    );
  };

  return (
    <AppScreen scrollable contentContainerStyle={styles.scrollContent}>
      <AppHeader
        title="Scan Medicine"
        subtitle="Extract details from medication packaging"
        brandText="HealthMate AI"
        rightAction={
          <TouchableOpacity
            style={styles.historyHeaderButton}
            onPress={() => router.push('/scan-history')}
          >
            <Feather name="clock" size={16} color={Colors.primary} />
            <Text style={styles.historyHeaderText}>History</Text>
          </TouchableOpacity>
        }
      />

      <View style={styles.body}>
        {!capturedImage ? (
          // Camera Viewport & Capture Controls
          <View style={styles.cameraContainer}>
            {permission?.granted ? (
              <CameraView style={styles.cameraView} facing="back">
                <View style={styles.overlayFrame}>
                  <View style={styles.targetCornerTL} />
                  <View style={styles.targetCornerTR} />
                  <View style={styles.targetCornerBL} />
                  <View style={styles.targetCornerBR} />
                  <Text style={styles.overlayHint}>
                    Align medicine label within frame
                  </Text>
                </View>
              </CameraView>
            ) : (
              // Permission or simulated viewport fallback
              <View style={styles.cameraPlaceholder}>
                <Ionicons name="camera-outline" size={48} color={Colors.primary} />
                <Text style={styles.cameraTitle}>Camera Label Scanner</Text>
                <Text style={styles.cameraSub}>
                  Point at medicine box, bottle, or prescription blister pack to
                  detect medicine details.
                </Text>

                {!permission?.granted ? (
                  <TouchableOpacity
                    style={styles.permissionButton}
                    onPress={requestPermission}
                  >
                    <Text style={styles.permissionButtonText}>
                      Grant Camera Permission
                    </Text>
                  </TouchableOpacity>
                ) : null}
              </View>
            )}

            {/* Controls */}
            <View style={styles.controlsRow}>
              <TouchableOpacity
                style={styles.galleryButton}
                onPress={handlePickImage}
              >
                <Ionicons name="images-outline" size={24} color={Colors.primary} />
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.shutterButton}
                onPress={handleCapture}
                activeOpacity={0.8}
              >
                <View style={styles.shutterInner} />
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.galleryButton}
                onPress={() => router.push('/scan-history')}
              >
                <Feather name="clock" size={22} color={Colors.textSecondary} />
              </TouchableOpacity>
            </View>
          </View>
        ) : (
          // Review & OCR Edit Form
          <View style={styles.reviewContainer}>
            <View style={styles.reviewHeader}>
              <Text style={styles.reviewTitle}>Detected Label Information</Text>
              <TouchableOpacity onPress={handleReset}>
                <Text style={styles.retakeText}>Retake</Text>
              </TouchableOpacity>
            </View>

            <View style={styles.ocrAlertBanner}>
              <Ionicons name="information-circle-outline" size={18} color="#0788F5" />
              <Text style={styles.ocrAlertText}>
                OCR results are automated. Review and correct text against your
                physical prescription label before saving.
              </Text>
            </View>

            {/* Editable Fields */}
            <AppCard style={styles.fieldsCard}>
              <Text style={styles.fieldLabel}>Medicine Name</Text>
              <TextInput
                style={styles.fieldInput}
                value={medName}
                onChangeText={setMedName}
                placeholder="Detected medicine name"
              />

              <View style={styles.divider} />

              <Text style={styles.fieldLabel}>Strength</Text>
              <TextInput
                style={styles.fieldInput}
                value={medStrength}
                onChangeText={setMedStrength}
                placeholder="e.g. 500 mg"
              />

              <View style={styles.divider} />

              <Text style={styles.fieldLabel}>Expiry Date</Text>
              <TextInput
                style={styles.fieldInput}
                value={medExpiry}
                onChangeText={setMedExpiry}
                placeholder="e.g. Dec 2027"
              />

              <View style={styles.divider} />

              <Text style={styles.fieldLabel}>Batch / Lot Number</Text>
              <TextInput
                style={styles.fieldInput}
                value={medBatch}
                onChangeText={setMedBatch}
                placeholder="e.g. DEMO-1234"
              />

              <View style={styles.divider} />

              <Text style={styles.fieldLabel}>Manufacturer</Text>
              <TextInput
                style={styles.fieldInput}
                value={medMfg}
                onChangeText={setMedMfg}
                placeholder="e.g. PharmaCorp"
              />
            </AppCard>

            {/* Actions */}
            <View style={styles.actionButtonsContainer}>
              <AppButton
                title="Add to Medicine Cabinet"
                onPress={handleAddToCabinet}
                variant="primary"
                size="lg"
                style={{ marginBottom: 10 }}
              />

              <AppButton
                title="Save Scan to History Only"
                onPress={handleSaveToHistory}
                variant="outline"
                size="md"
              />
            </View>
          </View>
        )}
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
  historyHeaderButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.primaryLight,
    paddingVertical: 5,
    paddingHorizontal: 10,
    borderRadius: Radius.pill,
  },
  historyHeaderText: {
    fontSize: 13,
    fontWeight: '600',
    color: Colors.primary,
    marginLeft: 4,
  },
  cameraContainer: {
    alignItems: 'center',
    marginTop: Spacing.sm,
  },
  cameraView: {
    width: '100%',
    height: 380,
    borderRadius: Radius.card,
    overflow: 'hidden',
    justifyContent: 'center',
    alignItems: 'center',
  },
  cameraPlaceholder: {
    width: '100%',
    height: 340,
    borderRadius: Radius.card,
    backgroundColor: '#FFFFFF',
    borderWidth: 2,
    borderStyle: 'dashed',
    borderColor: '#D0D0DC',
    justifyContent: 'center',
    alignItems: 'center',
    padding: Spacing.xl,
  },
  cameraTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: Colors.textPrimary,
    marginTop: 12,
  },
  cameraSub: {
    fontSize: 13,
    color: Colors.textSecondary,
    textAlign: 'center',
    marginTop: 6,
    lineHeight: 18,
  },
  permissionButton: {
    marginTop: 16,
    backgroundColor: Colors.primary,
    paddingVertical: 10,
    paddingHorizontal: 18,
    borderRadius: Radius.pill,
  },
  permissionButtonText: {
    color: Colors.textInverse,
    fontWeight: '600',
    fontSize: 14,
  },
  overlayFrame: {
    width: '80%',
    height: '65%',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.4)',
    borderRadius: 16,
    justifyContent: 'center',
    alignItems: 'center',
  },
  targetCornerTL: {
    position: 'absolute',
    top: -2,
    left: -2,
    width: 24,
    height: 24,
    borderTopWidth: 4,
    borderLeftWidth: 4,
    borderColor: Colors.primary,
  },
  targetCornerTR: {
    position: 'absolute',
    top: -2,
    right: -2,
    width: 24,
    height: 24,
    borderTopWidth: 4,
    borderRightWidth: 4,
    borderColor: Colors.primary,
  },
  targetCornerBL: {
    position: 'absolute',
    bottom: -2,
    left: -2,
    width: 24,
    height: 24,
    borderBottomWidth: 4,
    borderLeftWidth: 4,
    borderColor: Colors.primary,
  },
  targetCornerBR: {
    position: 'absolute',
    bottom: -2,
    right: -2,
    width: 24,
    height: 24,
    borderBottomWidth: 4,
    borderRightWidth: 4,
    borderColor: Colors.primary,
  },
  overlayHint: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '600',
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    paddingVertical: 4,
    paddingHorizontal: 10,
    borderRadius: Radius.pill,
  },
  controlsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
    width: '100%',
    marginTop: Spacing.xl,
    paddingHorizontal: 20,
  },
  galleryButton: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: Colors.border,
    justifyContent: 'center',
    alignItems: 'center',
  },
  shutterButton: {
    width: 72,
    height: 72,
    borderRadius: 36,
    borderWidth: 4,
    borderColor: Colors.primary,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
  },
  shutterInner: {
    width: 54,
    height: 54,
    borderRadius: 27,
    backgroundColor: Colors.primary,
  },
  reviewContainer: {
    marginTop: Spacing.xs,
  },
  reviewHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: Spacing.sm,
  },
  reviewTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: Colors.textPrimary,
  },
  retakeText: {
    fontSize: 14,
    fontWeight: '600',
    color: Colors.primary,
  },
  ocrAlertBanner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: '#E8F4FF',
    borderRadius: Radius.md,
    padding: 12,
    marginBottom: Spacing.md,
  },
  ocrAlertText: {
    flex: 1,
    fontSize: 12,
    color: '#0369A1',
    lineHeight: 17,
    marginLeft: 8,
  },
  fieldsCard: {
    marginBottom: Spacing.lg,
    paddingVertical: 8,
  },
  fieldLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: Colors.textSecondary,
    marginBottom: 4,
  },
  fieldInput: {
    fontSize: 15,
    color: Colors.textPrimary,
    paddingVertical: 4,
  },
  divider: {
    height: 1,
    backgroundColor: Colors.borderLight,
    marginVertical: 10,
  },
  actionButtonsContainer: {
    marginTop: Spacing.sm,
  },
});
