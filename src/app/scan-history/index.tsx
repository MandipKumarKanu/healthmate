import React, { useState, useCallback, useMemo } from 'react';
import { StyleSheet, View, Text, TouchableOpacity, ScrollView, Modal } from 'react-native';
import { AppAlert as Alert } from '../../services/appAlert';
import { deleteAllScanImages, deleteScanImage } from '../../services/scanImageStorage';
import { useFocusEffect, useRouter } from 'expo-router';
import { Ionicons, Feather } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import { Colors } from '../../theme/colors';
import { Radius, Spacing, Typography } from '../../theme/tokens';
import { AppScreen } from '../../components/ui/AppScreen';
import { AppHeader } from '../../components/ui/AppHeader';
import { AppCard } from '../../components/ui/AppCard';
import { AppButton } from '../../components/ui/AppButton';
import { MedicineIcon } from '../../components/ui/MedicineIcon';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
import { scanHistoryRepository } from '../../database/repositories/scanHistoryRepository';
import { useMedicineStore } from '../../store/medicineStore';
import { ScanHistoryEntry } from '../../types';

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
    scanHistoryRepository.clearAll();
    setShowClearModal(false);
    loadScans();
  };

  const handleAddToCabinet = (scan: ScanHistoryEntry) => {
    addMedicine({
      id: `med_${Date.now()}`,
      name: scan.medicineName,
      strength: scan.detectedStrength || 'Standard',
      dosageForm: scan.dosageForm || 'tablet',
      category: 'Prescription',
      packageDetails: {
        manufacturer: scan.manufacturer,
        expiryDate: scan.expiryDate,
        batchNumber: scan.batchNumber,
      },
      isSample: false,
    });
    closeSheet();
    Alert.alert('Added', `${scan.medicineName} added to your cabinet!`);
  };

  const handleDeleteScan = (scan: ScanHistoryEntry) => {
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
                    {new Date(scan.scannedAt).toLocaleDateString()} at{' '}
                    {new Date(scan.scannedAt).toLocaleTimeString([], {
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
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

      {/* Scan detail sheet: fields + full extracted label text */}
      <Modal
        visible={selectedScan !== null}
        transparent
        animationType="fade"
        statusBarTranslucent
        onRequestClose={closeSheet}
      >
        <View style={styles.sheetBackdrop}>
          <View style={styles.sheetContainer}>
            {selectedScan ? (
              <ScrollView
                style={styles.sheetScroll}
                contentContainerStyle={styles.sheetScrollContent}
                showsVerticalScrollIndicator
              >
                <Text style={styles.sheetTitle}>{selectedScan.medicineName}</Text>
                <Text style={styles.sheetSubtitle}>
                  Scanned on {new Date(selectedScan.scannedAt).toLocaleDateString()} at{' '}
                  {new Date(selectedScan.scannedAt).toLocaleTimeString([], {
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </Text>

                <View style={styles.detailGrid}>
                  <View style={styles.detailCell}>
                    <Text style={styles.detailLabel}>Strength</Text>
                    <Text style={styles.detailValue}>{selectedScan.detectedStrength ?? 'N/A'}</Text>
                  </View>
                  <View style={styles.detailCell}>
                    <Text style={styles.detailLabel}>Form</Text>
                    <Text style={styles.detailValue}>{selectedScan.dosageForm ?? 'tablet'}</Text>
                  </View>
                  <View style={styles.detailCell}>
                    <Text style={styles.detailLabel}>Expiry</Text>
                    <Text style={styles.detailValue}>{selectedScan.expiryDate ?? 'N/A'}</Text>
                  </View>
                  <View style={styles.detailCell}>
                    <Text style={styles.detailLabel}>Batch / Lot</Text>
                    <Text style={styles.detailValue} numberOfLines={1}>
                      {selectedScan.batchNumber ?? 'N/A'}
                    </Text>
                  </View>
                  <View style={styles.detailCellWide}>
                    <Text style={styles.detailLabel}>Manufacturer</Text>
                    <Text style={styles.detailValue} numberOfLines={2}>
                      {selectedScan.manufacturer ?? 'N/A'}
                    </Text>
                  </View>
                </View>

                {selectedScanLines.length > 0 ? (
                  <View style={styles.sheetTextSection}>
                    <View style={styles.sheetTextHeader}>
                      <Feather name="file-text" size={14} color={Colors.primary} />
                      <Text style={styles.sheetTextTitle}>
                        Full label text ({selectedScanLines.length} lines)
                      </Text>
                    </View>
                    <View style={styles.sheetTextBody}>
                      {selectedScanLines.map((line, index) => (
                        <Text key={`scan-line-${index}`} style={styles.sheetTextLine} selectable>
                          {line}
                        </Text>
                      ))}
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
                        style={[styles.sheetCopyText, textCopied && { color: Colors.successDark }]}
                      >
                        {textCopied ? 'Copied!' : 'Copy text'}
                      </Text>
                    </TouchableOpacity>
                  </View>
                ) : null}

                <View style={styles.sheetActions}>
                  <AppButton
                    title="Add to Medicine Cabinet"
                    size="md"
                    onPress={() => handleAddToCabinet(selectedScan)}
                    style={{ flex: 1 }}
                  />
                  <AppButton
                    title="Delete"
                    variant="destructive"
                    size="md"
                    onPress={() => handleDeleteScan(selectedScan)}
                    style={{ flexShrink: 0 }}
                  />
                </View>
                <AppButton
                  title="Close"
                  variant="text"
                  size="sm"
                  onPress={closeSheet}
                  style={{ marginTop: Spacing.xs, alignSelf: 'center' }}
                />
              </ScrollView>
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
    backgroundColor: 'rgba(0, 0, 0, 0.60)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: Spacing.lg,
  },
  sheetContainer: {
    width: '100%',
    maxWidth: 420,
    maxHeight: '85%',
    backgroundColor: Colors.cardBackground,
    borderRadius: Radius.card,
    borderWidth: 1,
    borderColor: Colors.border,
    paddingTop: Spacing.md,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.18,
    shadowRadius: 24,
    elevation: 12,
  },
  sheetGrabber: {
    alignSelf: 'center',
    marginTop: Spacing.sm,
    marginBottom: Spacing.xs,
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: Colors.border,
  },
  sheetScroll: {
    flexGrow: 0,
  },
  sheetScrollContent: {
    paddingHorizontal: Spacing.screenPaddingHorizontal,
    paddingBottom: Spacing.xl,
  },
  sheetTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: Colors.textPrimary,
    marginTop: Spacing.xs,
  },
  sheetSubtitle: {
    fontSize: 12,
    color: Colors.textTertiary,
    marginTop: 2,
    marginBottom: Spacing.md,
  },
  detailGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.sm,
    marginBottom: Spacing.md,
  },
  detailCell: {
    width: '30%',
    minWidth: 100,
    flexGrow: 1,
    backgroundColor: Colors.cardBackgroundSecondary,
    borderRadius: Radius.sm,
    padding: 10,
  },
  detailCellWide: {
    width: '100%',
    backgroundColor: Colors.cardBackgroundSecondary,
    borderRadius: Radius.sm,
    padding: 10,
  },
  detailLabel: {
    fontSize: 10,
    fontWeight: '600',
    letterSpacing: 0.5,
    color: Colors.textTertiary,
  },
  detailValue: {
    fontSize: 14,
    fontWeight: '600',
    color: Colors.textPrimary,
    marginTop: 2,
  },
  sheetTextSection: {
    marginBottom: Spacing.md,
  },
  sheetTextHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 6,
  },
  sheetTextTitle: {
    fontSize: 12,
    fontWeight: '700',
    color: Colors.textPrimary,
  },
  sheetTextBody: {
    backgroundColor: Colors.cardBackgroundSecondary,
    borderWidth: 1,
    borderColor: Colors.borderLight,
    borderRadius: Radius.sm,
    padding: 10,
    maxHeight: 180,
  },
  sheetTextLine: {
    fontSize: 13,
    color: Colors.textPrimary,
    lineHeight: 20,
  },
  sheetCopyButton: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-end',
    marginTop: 6,
    paddingVertical: 6,
    paddingHorizontal: 10,
    backgroundColor: Colors.cardBackgroundSecondary,
    borderRadius: Radius.pill,
  },
  sheetCopyText: {
    fontSize: 12,
    fontWeight: '600',
    color: Colors.primary,
    marginLeft: 6,
  },
  sheetActions: {
    flexDirection: 'row',
    gap: Spacing.sm,
    marginTop: Spacing.xs,
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
