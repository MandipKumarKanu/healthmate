import React, { useState, useCallback, useMemo } from 'react';
import {
  StyleSheet,
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  Modal,
  Image,
  Pressable,
} from 'react-native';
import { AppAlert as Alert } from '../../services/appAlert';
import { deleteAllScanImages, deleteScanImage } from '../../services/scanImageStorage';
import { useFocusEffect, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import { Colors } from '../../theme/colors';
import { Radius, Spacing, Shadows } from '../../theme/tokens';
import { AppScreen } from '../../components/ui/AppScreen';
import { AppHeader } from '../../components/ui/AppHeader';
import { AppCard } from '../../components/ui/AppCard';
import { AppButton } from '../../components/ui/AppButton';
import { MedicineIcon } from '../../components/ui/MedicineIcon';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
import { scanHistoryRepository } from '../../database/repositories/scanHistoryRepository';
import { useMedicineStore } from '../../store/medicineStore';
import { ScanHistoryEntry } from '../../types';

function formatScanDateTime(dateStr: string): string {
  try {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return dateStr;
    const datePart = d.toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
    const timePart = d.toLocaleTimeString(undefined, {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    });
    return `${datePart} · ${timePart}`;
  } catch {
    return dateStr;
  }
}

export default function ScanHistoryScreen() {
  const router = useRouter();
  const { addMedicine } = useMedicineStore();
  const [scans, setScans] = useState<ScanHistoryEntry[]>([]);
  const [showClearModal, setShowClearModal] = useState(false);
  const [selectedScan, setSelectedScan] = useState<ScanHistoryEntry | null>(null);
  const [textCopied, setTextCopied] = useState(false);

  const loadScans = () => {
    const list = scanHistoryRepository.getAll();
    setScans(list);
  };

  useFocusEffect(
    useCallback(() => {
      loadScans();
    }, []),
  );

  const closeSheet = () => {
    setSelectedScan(null);
    setTextCopied(false);
  };

  const handleClearHistory = () => {
    deleteAllScanImages();
    scanHistoryRepository.clearAll();
    setShowClearModal(false);
    loadScans();
  };

  const handleAddToCabinet = (scan: ScanHistoryEntry) => {
    const newMed = addMedicine({
      id: `med_${Date.now()}`,
      name: scan.medicineName,
      strength: scan.detectedStrength || 'Standard dose',
      dosageForm: scan.dosageForm || 'tablet',
      category: 'Prescription',
      packageDetails: {
        manufacturer: scan.manufacturer,
        expiryDate: scan.expiryDate,
        batchNumber: scan.batchNumber,
        imageUri: scan.imageUri,
      },
      informationSource: 'Added from Scan History.',
      isSample: false,
    });
    closeSheet();
    Alert.alert(
      'Added to Cabinet',
      `${scan.medicineName} was added to your medicine cabinet!`,
      [
        {
          text: 'View Medicine',
          onPress: () => router.push(`/medicines/${newMed.id}`),
        },
        { text: 'OK' },
      ],
    );
  };

  const handleDeleteScan = (scan: ScanHistoryEntry) => {
    if (scan.imageUri) {
      deleteScanImage(scan.imageUri);
    }
    scanHistoryRepository.delete(scan.id);
    closeSheet();
    loadScans();
  };

  // Clean label lines for the sheet's full-text block
  const selectedScanLines = useMemo(() => {
    if (!selectedScan?.rawText) return [];
    return selectedScan.rawText
      .split(/\r?\n/)
      .map((line) => line.replace(/\s+/g, ' ').trim())
      .filter(Boolean);
  }, [selectedScan]);

  const handleCopyLabel = async () => {
    const text = selectedScanLines.join('\n');
    if (!text) return;
    try {
      await Clipboard.setStringAsync(text);
      setTextCopied(true);
      setTimeout(() => setTextCopied(false), 2000);
    } catch (error) {
      console.warn('Copy label text failed:', error);
    }
  };

  const handleItemPress = (scan: ScanHistoryEntry) => {
    setSelectedScan(scan);
    setTextCopied(false);
  };

  return (
    <AppScreen scrollable contentContainerStyle={styles.scrollContent}>
      <AppHeader
        title="Scan History"
        subtitle={`Saved package scans (${scans.length})`}
        brandText="HealthMate AI"
        onBackPress={() => router.back()}
        rightAction={
          scans.length > 0 ? (
            <TouchableOpacity style={styles.clearButton} onPress={() => setShowClearModal(true)}>
              <Text style={styles.clearButtonText}>Clear</Text>
            </TouchableOpacity>
          ) : null
        }
      />

      <View style={styles.body}>
        {scans.length === 0 ? (
          <View style={styles.emptyContainer}>
            <Ionicons name="scan-circle-outline" size={56} color={Colors.textTertiary} />
            <Text style={styles.emptyTitle}>No scan history yet</Text>
            <Text style={styles.emptySubtitle}>
              Packages you scan with the camera will appear here for review.
            </Text>
          </View>
        ) : (
          scans.map((scan) => (
            <AppCard key={scan.id} style={styles.scanCard}>
              <TouchableOpacity
                style={styles.cardContent}
                onPress={() => handleItemPress(scan)}
                activeOpacity={0.7}
              >
                <MedicineIcon
                  form={scan.dosageForm || 'tablet'}
                  name={scan.medicineName}
                  size={46}
                />
                <View style={styles.infoContainer}>
                  <Text style={styles.medName}>{scan.medicineName}</Text>
                  <Text style={styles.detailsText}>
                    {scan.detectedStrength ?? 'Standard'} · {scan.dosageForm ?? 'Tablet'}
                  </Text>
                  {scan.rawText ? (
                    <Text style={styles.rawPreview} numberOfLines={1}>
                      “{scan.rawText.split(/\r?\n/)[0]}”
                    </Text>
                  ) : null}
                  <Text style={styles.dateText}>
                    {formatScanDateTime(scan.scannedAt)}
                  </Text>
                </View>

                <Ionicons name="ellipsis-horizontal" size={18} color={Colors.textTertiary} />
              </TouchableOpacity>
            </AppCard>
          ))
        )}
      </View>

      <ConfirmDialog
        visible={showClearModal}
        title="Clear Scan History"
        message="Are you sure you want to delete all saved scan history? This will not remove medicines from your cabinet."
        confirmText="Clear History"
        destructive
        onConfirm={handleClearHistory}
        onCancel={() => setShowClearModal(false)}
      />

      {/* Scan detail dialog: cleanly styled native dialog */}
      <Modal
        visible={selectedScan !== null}
        transparent
        animationType="fade"
        statusBarTranslucent
        onRequestClose={closeSheet}
      >
        <View style={styles.modalOverlay}>
          <Pressable
            style={StyleSheet.absoluteFill}
            onPress={closeSheet}
            accessibilityRole="button"
            accessibilityLabel="Dismiss dialog"
          />
          <View style={styles.modalCard}>
            {selectedScan ? (
              <>
                {/* Header */}
                <View style={styles.modalHeader}>
                  <MedicineIcon
                    form={selectedScan.dosageForm || 'tablet'}
                    name={selectedScan.medicineName}
                    size={40}
                  />
                  <View style={styles.modalHeaderInfo}>
                    <Text style={styles.modalTitle} numberOfLines={1}>
                      {selectedScan.medicineName}
                    </Text>
                    <Text style={styles.modalSubtitle}>
                      {formatScanDateTime(selectedScan.scannedAt)}
                    </Text>
                  </View>
                  <TouchableOpacity
                    style={styles.modalCloseBtn}
                    onPress={closeSheet}
                    hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
                    activeOpacity={0.7}
                  >
                    <Ionicons name="close" size={20} color={Colors.textSecondary} />
                  </TouchableOpacity>
                </View>

                {/* Body */}
                <ScrollView
                  style={styles.modalScroll}
                  contentContainerStyle={styles.modalScrollContent}
                  showsVerticalScrollIndicator={false}
                >
                  {/* Scanned Package Image Preview */}
                  {selectedScan.imageUri ? (
                    <View style={styles.packagePhotoCard}>
                      <Image
                        source={{ uri: selectedScan.imageUri }}
                        style={styles.packagePhotoImage}
                        resizeMode="cover"
                      />
                      <View style={styles.packagePhotoPill}>
                        <Ionicons name="camera-outline" size={12} color="#FFFFFF" />
                        <Text style={styles.packagePhotoPillText}>Package Photo</Text>
                      </View>
                    </View>
                  ) : null}

                  {/* Clean Package Specs */}
                  <View style={styles.specsCard}>
                    <View style={styles.specRow}>
                      <Text style={styles.specLabel}>Dosage Form</Text>
                      <Text style={styles.specValue}>
                        {selectedScan.dosageForm
                          ? selectedScan.dosageForm.charAt(0).toUpperCase() +
                            selectedScan.dosageForm.slice(1)
                          : 'Tablet'}
                      </Text>
                    </View>
                    <View style={styles.specDivider} />

                    <View style={styles.specRow}>
                      <Text style={styles.specLabel}>Strength</Text>
                      <Text style={styles.specValue}>
                        {selectedScan.detectedStrength ?? 'Standard'}
                      </Text>
                    </View>
                    <View style={styles.specDivider} />

                    <View style={styles.specRow}>
                      <Text style={styles.specLabel}>Expiry Date</Text>
                      <Text style={styles.specValue}>
                        {selectedScan.expiryDate ?? 'Not detected'}
                      </Text>
                    </View>
                    <View style={styles.specDivider} />

                    <View style={styles.specRow}>
                      <Text style={styles.specLabel}>Batch Number</Text>
                      <Text style={styles.specValue}>
                        {selectedScan.batchNumber ?? 'Not detected'}
                      </Text>
                    </View>
                    <View style={styles.specDivider} />

                    <View style={styles.specRow}>
                      <Text style={styles.specLabel}>Manufacturer</Text>
                      <Text
                        style={[styles.specValue, styles.specValueMultiline]}
                        numberOfLines={2}
                      >
                        {selectedScan.manufacturer ?? 'Not detected'}
                      </Text>
                    </View>
                  </View>

                  {/* Extracted Text */}
                  {selectedScanLines.length > 0 ? (
                    <View style={styles.extractedTextSection}>
                      <View style={styles.extractedTextHeader}>
                        <Text style={styles.extractedTextTitle}>Extracted Label Text</Text>
                        <TouchableOpacity
                          style={styles.copyPill}
                          onPress={handleCopyLabel}
                          activeOpacity={0.7}
                        >
                          <Ionicons
                            name={textCopied ? 'checkmark' : 'copy-outline'}
                            size={12}
                            color={textCopied ? Colors.success : Colors.primary}
                          />
                          <Text
                            style={[
                              styles.copyPillText,
                              textCopied && { color: Colors.success },
                            ]}
                          >
                            {textCopied ? 'Copied' : 'Copy'}
                          </Text>
                        </TouchableOpacity>
                      </View>
                      <View style={styles.extractedTextBox}>
                        <ScrollView
                          style={styles.extractedTextScroll}
                          nestedScrollEnabled
                          showsVerticalScrollIndicator
                        >
                          <Text style={styles.extractedTextContent} selectable>
                            {selectedScanLines.join('\n')}
                          </Text>
                        </ScrollView>
                      </View>
                    </View>
                  ) : null}
                </ScrollView>

                {/* Footer Actions */}
                <View style={styles.modalFooter}>
                  <AppButton
                    title="Delete"
                    variant="destructive"
                    size="md"
                    onPress={() => handleDeleteScan(selectedScan)}
                    icon={
                      <Ionicons
                        name="trash-outline"
                        size={16}
                        color={Colors.error}
                        style={{ marginRight: 6 }}
                      />
                    }
                    style={styles.footerDeleteBtn}
                  />
                  <AppButton
                    title="Add to Cabinet"
                    variant="primary"
                    size="md"
                    onPress={() => handleAddToCabinet(selectedScan)}
                    icon={
                      <Ionicons
                        name="add-circle-outline"
                        size={16}
                        color="#FFFFFF"
                        style={{ marginRight: 6 }}
                      />
                    }
                    style={styles.footerAddBtn}
                  />
                </View>
              </>
            ) : null}
          </View>
        </View>
      </Modal>
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
  clearButton: {
    paddingVertical: 5,
    paddingHorizontal: 12,
    backgroundColor: '#FDECEE',
    borderRadius: Radius.pill,
  },
  clearButtonText: {
    fontSize: 13,
    fontWeight: '600',
    color: Colors.error,
  },
  scanCard: {
    marginBottom: Spacing.md,
    padding: Spacing.cardPadding,
  },
  cardContent: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  infoContainer: {
    flex: 1,
    marginLeft: Spacing.md,
  },
  medName: {
    fontSize: 16,
    fontWeight: '700',
    color: Colors.textPrimary,
  },
  detailsText: {
    fontSize: 13,
    color: Colors.textSecondary,
    marginTop: 2,
  },
  dateText: {
    fontSize: 11,
    color: Colors.textTertiary,
    marginTop: 4,
  },
  rawPreview: {
    fontSize: 11,
    fontStyle: 'italic',
    color: Colors.textSecondary,
    marginTop: 4,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.60)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: Spacing.md,
  },
  modalCard: {
    width: '100%',
    maxWidth: 420,
    maxHeight: '86%',
    backgroundColor: Colors.cardBackground,
    borderRadius: Radius.xxl,
    borderWidth: 1,
    borderColor: Colors.border,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.16,
    shadowRadius: 24,
    elevation: 12,
    overflow: 'hidden',
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.lg,
    paddingBottom: Spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: Colors.borderLight,
    gap: 12,
    backgroundColor: Colors.cardBackground,
  },
  modalHeaderInfo: {
    flex: 1,
  },
  modalTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: Colors.textPrimary,
  },
  modalSubtitle: {
    fontSize: 12,
    color: Colors.textSecondary,
    marginTop: 2,
  },
  modalCloseBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: Colors.cardBackgroundSecondary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalScroll: {
    flexGrow: 0,
  },
  modalScrollContent: {
    padding: Spacing.lg,
    gap: Spacing.md,
  },
  packagePhotoCard: {
    width: '100%',
    height: 130,
    borderRadius: Radius.lg,
    overflow: 'hidden',
    backgroundColor: Colors.cardBackgroundSecondary,
    borderWidth: 1,
    borderColor: Colors.borderLight,
    position: 'relative',
  },
  packagePhotoImage: {
    width: '100%',
    height: '100%',
  },
  packagePhotoPill: {
    position: 'absolute',
    bottom: 8,
    right: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'rgba(15, 23, 42, 0.70)',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: Radius.pill,
  },
  packagePhotoPillText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  specsCard: {
    backgroundColor: Colors.cardBackgroundSecondary,
    borderRadius: Radius.lg,
    paddingHorizontal: Spacing.md,
    borderWidth: 1,
    borderColor: Colors.borderLight,
  },
  specRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 11,
    gap: 12,
  },
  specLabel: {
    fontSize: 13,
    fontWeight: '500',
    color: Colors.textSecondary,
    flexShrink: 0,
  },
  specValue: {
    fontSize: 13,
    fontWeight: '600',
    color: Colors.textPrimary,
    textAlign: 'right',
  },
  specValueMultiline: {
    flex: 1,
    textAlign: 'right',
  },
  specDivider: {
    height: 1,
    backgroundColor: Colors.borderLight,
  },
  extractedTextSection: {
    gap: 8,
  },
  extractedTextHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 2,
  },
  extractedTextTitle: {
    fontSize: 13,
    fontWeight: '600',
    color: Colors.textPrimary,
  },
  copyPill: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 4,
    paddingHorizontal: 8,
    backgroundColor: Colors.primaryLight,
    borderRadius: Radius.pill,
    gap: 4,
  },
  copyPillText: {
    fontSize: 12,
    fontWeight: '600',
    color: Colors.primary,
  },
  extractedTextBox: {
    backgroundColor: Colors.cardBackgroundSecondary,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Colors.borderLight,
    padding: 12,
  },
  extractedTextScroll: {
    maxHeight: 110,
  },
  extractedTextContent: {
    fontSize: 12,
    lineHeight: 18,
    color: Colors.textSecondary,
  },
  modalFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
    borderTopWidth: 1,
    borderTopColor: Colors.borderLight,
    backgroundColor: Colors.cardBackground,
  },
  footerDeleteBtn: {
    flex: 1,
  },
  footerAddBtn: {
    flex: 2,
  },
  emptyContainer: {
    alignItems: 'center',
    paddingVertical: 60,
  },
  emptyTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: Colors.textPrimary,
    marginTop: 12,
  },
  emptySubtitle: {
    fontSize: 13,
    color: Colors.textSecondary,
    textAlign: 'center',
    marginTop: 6,
    paddingHorizontal: 24,
  },
});
