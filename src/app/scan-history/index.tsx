import React, { useState, useEffect } from 'react';
import {
  StyleSheet,
  View,
  Text,
  TouchableOpacity,
  Alert,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons, Feather } from '@expo/vector-icons';
import { Colors } from '../../theme/colors';
import { Radius, Spacing, Typography } from '../../theme/tokens';
import { AppScreen } from '../../components/ui/AppScreen';
import { AppHeader } from '../../components/ui/AppHeader';
import { AppCard } from '../../components/ui/AppCard';
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

  const loadScans = () => {
    const list = scanHistoryRepository.getAll();
    setScans(list);
  };

  useEffect(() => {
    loadScans();
  }, []);

  const handleClearHistory = () => {
    scanHistoryRepository.clearAll();
    setShowClearModal(false);
    loadScans();
  };

  const handleItemPress = (scan: ScanHistoryEntry) => {
    Alert.alert(
      scan.medicineName,
      `Scanned: ${scan.scannedAt.split('T')[0]}\nStrength: ${scan.detectedStrength ?? 'N/A'}\nBatch: ${scan.batchNumber ?? 'N/A'}`,
      [
        {
          text: 'Add to Medicine Cabinet',
          onPress: () => {
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
            Alert.alert('Added', `${scan.medicineName} added to your cabinet!`);
          },
        },
        {
          text: 'Delete Scan',
          style: 'destructive',
          onPress: () => {
            scanHistoryRepository.delete(scan.id);
            loadScans();
          },
        },
        { text: 'Cancel', style: 'cancel' },
      ]
    );
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
            <TouchableOpacity
              style={styles.clearButton}
              onPress={() => setShowClearModal(true)}
            >
              <Text style={styles.clearButtonText}>Clear</Text>
            </TouchableOpacity>
          ) : null
        }
      />

      <View style={styles.body}>
        {scans.length === 0 ? (
          <View style={styles.emptyContainer}>
            <Ionicons
              name="scan-circle-outline"
              size={56}
              color={Colors.textTertiary}
            />
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
                  <Text style={styles.dateText}>
                    {new Date(scan.scannedAt).toLocaleDateString()} at{' '}
                    {new Date(scan.scannedAt).toLocaleTimeString([], {
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </Text>
                </View>

                <Ionicons
                  name="ellipsis-horizontal"
                  size={18}
                  color={Colors.textTertiary}
                />
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
