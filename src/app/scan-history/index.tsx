import React, { useState, useCallback, useMemo } from 'react';
import {
  StyleSheet,
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  Modal,
  Image,
} from 'react-native';
import { AppAlert as Alert } from '../../services/appAlert';
import { deleteAllScanImages, deleteScanImage } from '../../services/scanImageStorage';
import { useFocusEffect, useRouter } from 'expo-router';
import { Ionicons, Feather } from '@expo/vector-icons';
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

      {/* Scan detail dialog: beautifully structured fields + photo + full extracted label text */}
      <Modal
        visible={selectedScan !== null}
        transparent
        animationType="fade"
        statusBarTranslucent
        onRequestClose={closeSheet}
      >
        <View style={styles.sheetBackdrop}>
          <TouchableOpacity
            style={styles.backdropDismissArea}
            activeOpacity={1}
            onPress={closeSheet}
          />
          <View style={styles.sheetContainer}>
            {selectedScan ? (
              <>
                {/* Dialog Top Header with Icon, Name, Date & Close (X) */}
                <View style={styles.dialogHeader}>
                  <MedicineIcon
                    form={selectedScan.dosageForm || 'tablet'}
                    name={selectedScan.medicineName}
                    size={42}
                  />
                  <View style={styles.dialogHeaderInfo}>
                    <Text style={styles.dialogHeaderTitle} numberOfLines={1}>
                      {selectedScan.medicineName}
                    </Text>
                    <Text style={styles.dialogHeaderSubtitle}>
                      {formatScanDateTime(selectedScan.scannedAt)}
                    </Text>
                  </View>
                  <TouchableOpacity
                    style={styles.dialogCloseBtn}
                    onPress={closeSheet}
                    hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
                    activeOpacity={0.7}
                  >
                    <Feather name="x" size={18} color={Colors.textSecondary} />
                  </TouchableOpacity>
                </View>

                {/* Dialog Scrollable Body */}
                <ScrollView
                  style={styles.sheetScroll}
                  contentContainerStyle={styles.sheetScrollContent}
                  showsVerticalScrollIndicator={false}
                >
                  {/* Scanned Package Image Preview */}
                  {selectedScan.imageUri ? (
                    <View style={styles.scannedImageCard}>
                      <Image
                        source={{ uri: selectedScan.imageUri }}
                        style={styles.scannedImageThumb}
                        resizeMode="cover"
                      />
                      <View style={styles.scannedImageBadge}>
                        <Ionicons name="camera" size={12} color="#FFFFFF" />
                        <Text style={styles.scannedImageBadgeText}>Packaging Photo</Text>
                      </View>
                    </View>
                  ) : null}

                  {/* Section Title */}
                  <View style={styles.infoSectionHeader}>
                    <Feather name="info" size={13} color={Colors.primary} />
                    <Text style={styles.infoSectionTitle}>Detected Package Details</Text>
                  </View>

                  {/* Structured Details Grid */}
                  <View style={styles.detailGrid}>
                    {/* Dosage Form */}
                    <View style={styles.detailCell}>
                      <View style={styles.detailCellIconWrap}>
                        <Feather name="disc" size={13} color={Colors.primary} />
                      </View>
                      <View style={styles.detailCellTextWrap}>
                        <Text style={styles.detailLabel}>DOSAGE FORM</Text>
                        <Text style={styles.detailValue}>
                          {selectedScan.dosageForm
                            ? selectedScan.dosageForm.charAt(0).toUpperCase() +
                              selectedScan.dosageForm.slice(1)
                            : 'Tablet'}
                        </Text>
                      </View>
                    </View>

                    {/* Strength */}
                    <View style={styles.detailCell}>
                      <View style={styles.detailCellIconWrap}>
                        <Feather name="zap" size={13} color="#D97706" />
                      </View>
                      <View style={styles.detailCellTextWrap}>
                        <Text style={styles.detailLabel}>STRENGTH</Text>
                        <Text style={styles.detailValue}>
                          {selectedScan.detectedStrength ?? 'Standard'}
                        </Text>
                      </View>
                    </View>

                    {/* Expiry Date */}
                    <View style={styles.detailCell}>
                      <View style={styles.detailCellIconWrap}>
                        <Feather name="calendar" size={13} color="#059669" />
                      </View>
                      <View style={styles.detailCellTextWrap}>
                        <Text style={styles.detailLabel}>EXPIRY DATE</Text>
                        <Text style={styles.detailValue}>
                          {selectedScan.expiryDate ?? 'Not detected'}
                        </Text>
                      </View>
                    </View>

                    {/* Batch Number */}
                    <View style={styles.detailCell}>
                      <View style={styles.detailCellIconWrap}>
                        <Feather name="hash" size={13} color="#4F46E5" />
                      </View>
                      <View style={styles.detailCellTextWrap}>
                        <Text style={styles.detailLabel}>BATCH / LOT</Text>
                        <Text style={styles.detailValue} numberOfLines={1}>
                          {selectedScan.batchNumber ?? 'Not detected'}
                        </Text>
                      </View>
                    </View>

                    {/* Manufacturer */}
                    <View style={styles.detailCellWide}>
                      <View style={styles.detailCellIconWrap}>
                        <Feather name="award" size={13} color="#7C3AED" />
                      </View>
                      <View style={styles.detailCellTextWrap}>
                        <Text style={styles.detailLabel}>MANUFACTURER</Text>
                        <Text style={styles.detailValue} numberOfLines={2}>
                          {selectedScan.manufacturer ?? 'Not specified on packaging'}
                        </Text>
                      </View>
                    </View>
                  </View>

                  {/* OCR Full Extracted Text */}
                  {selectedScanLines.length > 0 ? (
                    <View style={styles.sheetTextSection}>
                      <View style={styles.sheetTextHeader}>
                        <View style={styles.sheetTextTitleRow}>
                          <Feather name="file-text" size={13} color={Colors.primary} />
                          <Text style={styles.sheetTextTitle}>
                            Extracted Text ({selectedScanLines.length} lines)
                          </Text>
                        </View>
                        <TouchableOpacity
                          style={styles.sheetCopyButton}
                          onPress={handleCopyLabel}
                          activeOpacity={0.7}
                        >
                          <Feather
                            name={textCopied ? 'check' : 'copy'}
                            size={12}
                            color={textCopied ? Colors.successDark : Colors.primary}
                          />
                          <Text
                            style={[
                              styles.sheetCopyText,
                              textCopied && { color: Colors.successDark },
                            ]}
                          >
                            {textCopied ? 'Copied' : 'Copy'}
                          </Text>
                        </TouchableOpacity>
                      </View>
                      <View style={styles.sheetTextBody}>
                        {selectedScanLines.map((line, index) => (
                          <Text key={`scan-line-${index}`} style={styles.sheetTextLine} selectable>
                            {line}
                          </Text>
                        ))}
                      </View>
                    </View>
                  ) : null}
                </ScrollView>

                {/* Sticky Dialog Actions Footer */}
                <View style={styles.dialogFooter}>
                  <AppButton
                    title="Add to Cabinet"
                    size="md"
                    onPress={() => handleAddToCabinet(selectedScan)}
                    icon={<Feather name="plus-circle" size={16} color="#FFFFFF" />}
                    style={{ flex: 1 }}
                  />
                  <TouchableOpacity
                    style={styles.deleteScanBtn}
                    onPress={() => handleDeleteScan(selectedScan)}
                    activeOpacity={0.7}
                    accessibilityLabel="Delete this scan"
                  >
                    <Feather name="trash-2" size={16} color={Colors.error} />
                  </TouchableOpacity>
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
  sheetBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.65)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: Spacing.md,
  },
  backdropDismissArea: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  sheetContainer: {
    width: '100%',
    maxWidth: 440,
    maxHeight: '88%',
    backgroundColor: Colors.cardBackground,
    borderRadius: Radius.card,
    borderWidth: 1,
    borderColor: Colors.borderLight,
    ...Shadows.card,
    overflow: 'hidden',
  },
  dialogHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing.md,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: Colors.borderLight,
    gap: 12,
    backgroundColor: Colors.cardBackground,
  },
  dialogHeaderInfo: {
    flex: 1,
  },
  dialogHeaderTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: Colors.textPrimary,
  },
  dialogHeaderSubtitle: {
    fontSize: 12,
    color: Colors.textSecondary,
    marginTop: 2,
  },
  dialogCloseBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: Colors.cardBackgroundSecondary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sheetScroll: {
    flexGrow: 0,
  },
  sheetScrollContent: {
    paddingHorizontal: Spacing.md,
    paddingTop: Spacing.md,
    paddingBottom: Spacing.md,
  },
  scannedImageCard: {
    width: '100%',
    height: 140,
    borderRadius: Radius.md,
    overflow: 'hidden',
    position: 'relative',
    marginBottom: Spacing.md,
    backgroundColor: '#0F172A',
  },
  scannedImageThumb: {
    width: '100%',
    height: '100%',
    resizeMode: 'cover',
  },
  scannedImageBadge: {
    position: 'absolute',
    bottom: 8,
    left: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: 'rgba(0, 0, 0, 0.65)',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: Radius.pill,
  },
  scannedImageBadgeText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  infoSectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 8,
  },
  infoSectionTitle: {
    fontSize: 11,
    fontWeight: '700',
    color: Colors.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  detailGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: Spacing.md,
  },
  detailCell: {
    width: '48%',
    flexGrow: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: Colors.cardBackgroundSecondary,
    borderRadius: Radius.md,
    padding: 10,
    borderWidth: 1,
    borderColor: Colors.borderLight,
  },
  detailCellWide: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: Colors.cardBackgroundSecondary,
    borderRadius: Radius.md,
    padding: 10,
    borderWidth: 1,
    borderColor: Colors.borderLight,
  },
  detailCellIconWrap: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: Colors.borderLight,
  },
  detailCellTextWrap: {
    flex: 1,
  },
  detailLabel: {
    fontSize: 9,
    fontWeight: '700',
    letterSpacing: 0.5,
    color: Colors.textTertiary,
  },
  detailValue: {
    fontSize: 13,
    fontWeight: '600',
    color: Colors.textPrimary,
    marginTop: 1,
  },
  sheetTextSection: {
    marginBottom: Spacing.xs,
  },
  sheetTextHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  sheetTextTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  sheetTextTitle: {
    fontSize: 11,
    fontWeight: '700',
    color: Colors.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  sheetTextBody: {
    backgroundColor: Colors.cardBackgroundSecondary,
    borderWidth: 1,
    borderColor: Colors.borderLight,
    borderRadius: Radius.md,
    padding: 12,
    maxHeight: 140,
  },
  sheetTextLine: {
    fontSize: 12,
    color: Colors.textPrimary,
    lineHeight: 18,
  },
  sheetCopyButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 4,
    paddingHorizontal: 8,
    backgroundColor: Colors.cardBackgroundSecondary,
    borderRadius: Radius.pill,
    borderWidth: 1,
    borderColor: Colors.borderLight,
    gap: 4,
  },
  sheetCopyText: {
    fontSize: 11,
    fontWeight: '600',
    color: Colors.primary,
  },
  dialogFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: Spacing.md,
    paddingVertical: 12,
    borderTopWidth: 1,
    borderTopColor: Colors.borderLight,
    backgroundColor: Colors.cardBackground,
  },
  deleteScanBtn: {
    width: 44,
    height: 44,
    borderRadius: Radius.md,
    backgroundColor: '#FEE2E2',
    alignItems: 'center',
    justifyContent: 'center',
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
