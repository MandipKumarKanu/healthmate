import React, { useState } from 'react';
import { StyleSheet, View, Text, TextInput, TouchableOpacity, Share } from 'react-native';
import { useRouter } from 'expo-router';
import { Feather, Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import { Colors } from '../../theme/colors';
import { Radius, Spacing, Typography } from '../../theme/tokens';
import { AppScreen } from '../../components/ui/AppScreen';
import { AppHeader } from '../../components/ui/AppHeader';
import { AppCard } from '../../components/ui/AppCard';
import { AppAlert } from '../../services/appAlert';
import { backupService, BackupPayload } from '../../services/backupService';
import { notificationService } from '../../services/notificationService';
import { cleanupOrphanScanImages } from '../../services/scanImageStorage';
import { useAppStore } from '../../store/appStore';
import { useMedicineStore } from '../../store/medicineStore';
import { useReminderStore } from '../../store/reminderStore';
import { getTodayDateString } from '../../database/seed';

export default function BackupScreen() {
  const router = useRouter();
  const [importJson, setImportJson] = useState('');
  const [isBusy, setIsBusy] = useState(false);

  const handleExport = async () => {
    try {
      setIsBusy(true);
      const json = backupService.createBackupJson();
      // Clipboard first so the JSON is out of the app even if Share fails.
      await Clipboard.setStringAsync(json);

      AppAlert.alert(
        'Backup copied',
        'A full JSON snapshot of your data was copied to the clipboard. Share it now to keep a copy somewhere safe (notes, files, email — your choice).',
        [
          {
            text: 'Share',
            onPress: () => {
              Share.share({
                title: 'HealthMate AI backup',
                message: json,
              }).catch(() => undefined);
            },
          },
          { text: 'OK' },
        ],
      );
    } catch (error) {
      console.warn('Backup export failed:', error);
      AppAlert.alert('Export failed', 'Could not create the backup snapshot. Please try again.');
    } finally {
      setIsBusy(false);
    }
  };

  const handleRestore = () => {
    const parsed = backupService.parseBackup(importJson);
    if (!parsed.ok) {
      AppAlert.alert('Invalid backup', parsed.error);
      return;
    }

    AppAlert.alert(
      'Restore backup?',
      'This will replace ALL data currently on this device — medicines, schedules, adherence history, scans and AI chats — with the backup contents. This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Restore', onPress: () => void performRestore(parsed.payload) },
      ],
      { cancelable: true },
    );
  };

  const performRestore = async (payload: BackupPayload) => {
    setIsBusy(true);
    try {
      const { restored } = backupService.restoreFromBackup(payload);

      // Reload all in-memory stores and re-arm notifications from the restored
      // schedules (reconcile also cancels every orphaned OS notification).
      useAppStore.getState().initApp();
      useMedicineStore.getState().loadMedicines();
      useReminderStore.getState().loadDosesForDate(getTodayDateString());
      await notificationService.reconcileScheduledReminders();
      // Drop stable images the restored rows no longer reference (e.g. a
      // backup taken on another device where those files never existed).
      cleanupOrphanScanImages();

      setImportJson('');
      AppAlert.alert(
        'Backup restored',
        `${restored} rows were restored. Your history now matches the backup exactly.`,
      );
    } catch (error) {
      console.warn('Backup restore failed:', error);
      AppAlert.alert(
        'Restore failed',
        'The backup could not be applied. Your previous data may be unavailable — try restoring again from the same file.',
      );
    } finally {
      setIsBusy(false);
    }
  };

  return (
    <AppScreen scrollable contentContainerStyle={styles.scrollContent}>
      <AppHeader
        title="Backup & Restore"
        subtitle="Your data, your file — local JSON snapshots"
        brandText="HealthMate AI"
        onBackPress={() => router.back()}
      />

      <View style={styles.body}>
        <AppCard style={styles.card}>
          <View style={styles.iconCircle}>
            <Feather name="download" size={24} color={Colors.primary} />
          </View>
          <Text style={styles.heading}>Export a JSON snapshot</Text>
          <Text style={styles.paragraph}>
            Copies everything — profile, medicines, schedules, adherence history, scans and AI chats
            — as one JSON file. Share it to notes, files or email; nothing leaves your device until
            you share it.
          </Text>
          <TouchableOpacity
            style={[styles.actionButton, isBusy && styles.actionButtonDisabled]}
            onPress={() => void handleExport()}
            disabled={isBusy}
          >
            <Ionicons name="share-outline" size={18} color={Colors.textInverse} />
            <Text style={styles.actionButtonText}>Copy & share backup</Text>
          </TouchableOpacity>
        </AppCard>

        <AppCard style={styles.card}>
          <View style={[styles.iconCircle, styles.iconCircleWarning]}>
            <Ionicons name="cloud-upload-outline" size={24} color={Colors.warning} />
          </View>
          <Text style={styles.heading}>Restore from JSON</Text>
          <Text style={styles.paragraph}>
            Paste a backup below. Restoring replaces ALL data on this device with the backup —
            medicines, schedules, doses, scans and AI chats.
          </Text>
          <TextInput
            style={styles.jsonInput}
            placeholder="Paste backup JSON here…"
            placeholderTextColor={Colors.textTertiary}
            value={importJson}
            onChangeText={setImportJson}
            multiline
          />
          <View style={styles.importActions}>
            <TouchableOpacity
              style={styles.pasteButton}
              onPress={() => void Clipboard.getStringAsync().then(setImportJson)}
            >
              <Text style={styles.pasteButtonText}>Paste from clipboard</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[
                styles.restoreButton,
                (!importJson.trim() || isBusy) && styles.actionButtonDisabled,
              ]}
              onPress={handleRestore}
              disabled={!importJson.trim() || isBusy}
            >
              <Text style={styles.actionButtonText}>Restore</Text>
            </TouchableOpacity>
          </View>
        </AppCard>
      </View>
    </AppScreen>
  );
}

const styles = StyleSheet.create({
  scrollContent: {
    padding: Spacing.lg,
    paddingBottom: Spacing.xl,
  },
  body: {
    gap: Spacing.md,
    marginTop: Spacing.md,
  },
  card: {
    padding: Spacing.lg,
  },
  iconCircle: {
    width: 46,
    height: 46,
    borderRadius: Radius.pill,
    backgroundColor: Colors.iconContainer,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: Spacing.sm,
  },
  iconCircleWarning: {
    backgroundColor: Colors.warningLight,
  },
  heading: {
    ...Typography.heading3,
    color: Colors.textPrimary,
    marginBottom: Spacing.xs,
  },
  paragraph: {
    ...Typography.bodyMedium,
    color: Colors.textSecondary,
    lineHeight: 20,
    marginBottom: Spacing.md,
  },
  actionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: Colors.primary,
    borderRadius: Radius.md,
    paddingVertical: Spacing.sm + 2,
  },
  restoreButton: {
    flex: 1,
    alignItems: 'center',
    backgroundColor: Colors.error,
    borderRadius: Radius.md,
    paddingVertical: Spacing.sm + 2,
  },
  actionButtonDisabled: {
    opacity: 0.5,
  },
  actionButtonText: {
    ...Typography.label,
    color: Colors.textInverse,
    fontSize: 15,
  },
  jsonInput: {
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: Radius.md,
    backgroundColor: Colors.cardBackgroundSecondary,
    minHeight: 96,
    padding: Spacing.sm,
    textAlignVertical: 'top',
    fontSize: 12,
    color: Colors.textPrimary,
    marginBottom: Spacing.sm,
  },
  importActions: {
    flexDirection: 'row',
    gap: Spacing.sm,
  },
  pasteButton: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.md,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.cardBackgroundSecondary,
  },
  pasteButtonText: {
    ...Typography.bodyMedium,
    color: Colors.textSecondary,
  },
});
