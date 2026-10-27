import React, { useState } from 'react';
import { StyleSheet, View, Text, TextInput, TouchableOpacity, Platform } from 'react-native';
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
  const [showManualPaste, setShowManualPaste] = useState(false);
  const [isBusy, setIsBusy] = useState(false);

  const handleSaveToFolder = async () => {
    try {
      setIsBusy(true);
      const json = backupService.createBackupJson();
      const fileName = backupService.generateBackupFileName();
      const saved = await backupService.saveToAndroidFolder(fileName, json);
      if (saved) {
        AppAlert.alert(
          'Backup saved',
          `Your backup file "${fileName}" was successfully saved to your chosen folder.`,
        );
      }
    } catch (error) {
      console.warn('Save to folder failed:', error);
      AppAlert.alert('Save failed', 'Could not save the backup file to the selected folder.');
    } finally {
      setIsBusy(false);
    }
  };

  const handleShareFile = async () => {
    try {
      setIsBusy(true);
      const { fileName } = await backupService.exportAndShareBackupFile();
      AppAlert.alert(
        'Backup ready',
        `File "${fileName}" was prepared. Save it to your device storage or cloud drive.`,
      );
    } catch (error) {
      console.warn('Share file failed:', error);
      AppAlert.alert('Export failed', 'Could not export or share the backup file.');
    } finally {
      setIsBusy(false);
    }
  };

  const handleCopyClipboard = async () => {
    try {
      setIsBusy(true);
      const json = backupService.createBackupJson();
      await Clipboard.setStringAsync(json);
      AppAlert.alert('Backup JSON copied', 'Snapshot JSON was copied to your clipboard.');
    } catch (error) {
      console.warn('Copy to clipboard failed:', error);
      AppAlert.alert('Copy failed', 'Could not copy backup JSON to clipboard.');
    } finally {
      setIsBusy(false);
    }
  };

  const handlePickBackupFile = async () => {
    try {
      setIsBusy(true);
      const result = await backupService.pickAndParseBackupFile();
      if (!result.ok) {
        if (!result.canceled) {
          AppAlert.alert('Invalid backup file', result.error);
        }
        return;
      }

      const { payload, fileName, summary } = result;
      const exportDate = summary.exportedAt
        ? new Date(summary.exportedAt).toLocaleString()
        : 'Unknown date';

      AppAlert.alert(
        `Restore from ${fileName}?`,
        `Exported: ${exportDate}\n\nContents:\n• ${summary.medicineCount} medicine(s)\n• ${summary.scheduleCount} schedule(s)\n• ${summary.doseLogCount} dose log(s)\n• ${summary.scanCount} scan(s)\n• ${summary.chatCount} AI chat(s)\n\nThis will replace ALL data on this device with the backup contents. This cannot be undone.`,
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Restore', onPress: () => void performRestore(payload) },
        ],
        { cancelable: true },
      );
    } catch (error) {
      console.warn('Pick backup file failed:', error);
      AppAlert.alert('Error', 'Failed to read the selected backup file.');
    } finally {
      setIsBusy(false);
    }
  };

  const handleRestoreFromText = () => {
    const parsed = backupService.parseBackup(importJson);
    if (!parsed.ok) {
      AppAlert.alert('Invalid backup', parsed.error);
      return;
    }

    const summary = backupService.getSummary(parsed.payload);
    AppAlert.alert(
      'Restore backup?',
      `Contents:\n• ${summary.medicineCount} medicine(s)\n• ${summary.scheduleCount} schedule(s)\n• ${summary.doseLogCount} dose log(s)\n\nThis will replace ALL data currently on this device with the backup contents. This cannot be undone.`,
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

      // Reload all in-memory stores and re-arm notifications from the restored schedules
      useAppStore.getState().initApp();
      useMedicineStore.getState().loadMedicines();
      useReminderStore.getState().loadDosesForDate(getTodayDateString());
      await notificationService.reconcileScheduledReminders();
      cleanupOrphanScanImages();

      setImportJson('');
      setShowManualPaste(false);
      AppAlert.alert(
        'Backup restored',
        `${restored} rows were restored. Your history now matches the backup exactly.`,
      );
    } catch (error) {
      console.warn('Backup restore failed:', error);
      AppAlert.alert(
        'Restore failed',
        'The backup could not be applied. Try restoring again from the same file.',
      );
    } finally {
      setIsBusy(false);
    }
  };

  const isAndroid = Platform.OS === 'android';

  return (
    <AppScreen scrollable contentContainerStyle={styles.scrollContent}>
      <AppHeader
        title="Backup & Restore"
        subtitle="Save as file, restore anytime — local JSON backups"
        brandText="HealthMate AI"
        onBackPress={() => router.back()}
      />

      <View style={styles.body}>
        {/* EXPORT CARD */}
        <AppCard style={styles.card}>
          <View style={styles.iconCircle}>
            <Feather name="download" size={24} color={Colors.primary} />
          </View>
          <Text style={styles.heading}>Save backup file</Text>
          <Text style={styles.paragraph}>
            Exports everything — profile, medicines, schedules, adherence history, scans and AI chats
            — into a single .json file saved directly to your device or cloud drive.
          </Text>

          <View style={styles.buttonStack}>
            {isAndroid && (
              <TouchableOpacity
                style={[styles.actionButton, isBusy && styles.actionButtonDisabled]}
                onPress={() => void handleSaveToFolder()}
                disabled={isBusy}
              >
                <Feather name="folder" size={18} color={Colors.textInverse} />
                <Text style={styles.actionButtonText}>Save to device folder</Text>
              </TouchableOpacity>
            )}

            <TouchableOpacity
              style={[
                isAndroid ? styles.secondaryButton : styles.actionButton,
                isBusy && styles.actionButtonDisabled,
              ]}
              onPress={() => void handleShareFile()}
              disabled={isBusy}
            >
              <Ionicons
                name="share-outline"
                size={18}
                color={isAndroid ? Colors.textPrimary : Colors.textInverse}
              />
              <Text style={isAndroid ? styles.secondaryButtonText : styles.actionButtonText}>
                {isAndroid ? 'Share / Save via system' : 'Save / Export backup file'}
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.textLinkButton}
              onPress={() => void handleCopyClipboard()}
              disabled={isBusy}
            >
              <Text style={styles.textLink}>Copy JSON to clipboard</Text>
            </TouchableOpacity>
          </View>
        </AppCard>

        {/* RESTORE CARD */}
        <AppCard style={styles.card}>
          <View style={[styles.iconCircle, styles.iconCircleWarning]}>
            <Ionicons name="cloud-upload-outline" size={24} color={Colors.warning} />
          </View>
          <Text style={styles.heading}>Restore from backup file</Text>
          <Text style={styles.paragraph}>
            Select a previously saved .json backup file to restore your full history. Restoring
            replaces ALL current data on this device.
          </Text>

          <View style={styles.buttonStack}>
            <TouchableOpacity
              style={[styles.actionButton, styles.restoreActionButton, isBusy && styles.actionButtonDisabled]}
              onPress={() => void handlePickBackupFile()}
              disabled={isBusy}
            >
              <Feather name="file-text" size={18} color={Colors.textInverse} />
              <Text style={styles.actionButtonText}>Select backup file (.json)</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.manualToggle}
              onPress={() => setShowManualPaste((prev) => !prev)}
            >
              <Text style={styles.manualToggleText}>
                {showManualPaste ? 'Hide manual paste' : 'Or paste JSON text manually'}
              </Text>
              <Feather
                name={showManualPaste ? 'chevron-up' : 'chevron-down'}
                size={16}
                color={Colors.textSecondary}
              />
            </TouchableOpacity>

            {showManualPaste && (
              <View style={styles.manualContainer}>
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
                    <Text style={styles.pasteButtonText}>Paste</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[
                      styles.restoreButton,
                      (!importJson.trim() || isBusy) && styles.actionButtonDisabled,
                    ]}
                    onPress={handleRestoreFromText}
                    disabled={!importJson.trim() || isBusy}
                  >
                    <Text style={styles.actionButtonText}>Restore from text</Text>
                  </TouchableOpacity>
                </View>
              </View>
            )}
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
  buttonStack: {
    gap: Spacing.sm,
  },
  actionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: Colors.primary,
    borderRadius: Radius.md,
    paddingVertical: Spacing.sm + 4,
    minHeight: 48,
  },
  restoreActionButton: {
    backgroundColor: Colors.primaryDark ?? '#1A6FB3',
  },
  secondaryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.cardBackgroundSecondary,
    paddingVertical: Spacing.sm + 4,
    minHeight: 48,
  },
  secondaryButtonText: {
    ...Typography.label,
    color: Colors.textPrimary,
    fontSize: 14,
  },
  textLinkButton: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: Spacing.xs,
    marginTop: Spacing.xs,
  },
  textLink: {
    ...Typography.caption,
    color: Colors.primary,
    textDecorationLine: 'underline',
  },
  manualToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: Spacing.xs,
    marginTop: Spacing.sm,
    borderTopWidth: 1,
    borderTopColor: Colors.borderLight,
    paddingTop: Spacing.sm,
  },
  manualToggleText: {
    ...Typography.caption,
    color: Colors.textSecondary,
    fontWeight: '600',
  },
  manualContainer: {
    marginTop: Spacing.xs,
  },
  restoreButton: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.error,
    borderRadius: Radius.md,
    paddingVertical: Spacing.sm + 2,
    minHeight: 44,
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
    minHeight: 44,
  },
  pasteButtonText: {
    ...Typography.bodyMedium,
    color: Colors.textSecondary,
  },
});
