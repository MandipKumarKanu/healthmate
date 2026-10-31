import React from 'react';
import { StyleSheet, View, Text } from 'react-native';
import { useRouter } from 'expo-router';
import { Feather, Ionicons } from '@expo/vector-icons';
import { Colors } from '../../theme/colors';
import { Radius, Spacing, Typography } from '../../theme/tokens';
import { AppScreen } from '../../components/ui/AppScreen';
import { AppHeader } from '../../components/ui/AppHeader';
import { AppCard } from '../../components/ui/AppCard';

export default function PrivacyScreen() {
  const router = useRouter();

  return (
    <AppScreen scrollable contentContainerStyle={styles.scrollContent}>
      <AppHeader
        title="Privacy & Data"
        subtitle="Transparent data architecture & processing disclosure"
        brandText="HealthMate AI"
        onBackPress={() => router.back()}
      />

      <View style={styles.body}>
        <AppCard style={styles.card}>
          <View style={styles.iconCircle}>
            <Feather name="shield" size={28} color={Colors.primary} />
          </View>
          <Text style={styles.heading}>Local-First Data Storage</Text>
          <Text style={styles.paragraph}>
            HealthMate AI is architected with a local-first design. Your medication lists, dosage
            schedules, adherence history, and scan history records are stored in your device's
            local SQLite database. Managed scan photos are stored in app-private persistent storage.
          </Text>
        </AppCard>

        <AppCard style={styles.card}>
          <Text style={styles.sectionTitle}>Cloud OCR Processing</Text>
          <Text style={styles.paragraph}>
            When scanning medicine packaging with cloud OCR enabled, label images are transmitted
            over HTTPS to the configured OCR endpoint (e.g. RapidOCR) to extract text lines and
            packaging details. This occurs only when initiating a scan.
          </Text>

          <View style={styles.divider} />

          <Text style={styles.sectionTitle}>AI Health Assistant (Google Gemini)</Text>
          <Text style={styles.paragraph}>
            When you connect Google Gemini or ask medication questions in the AI Assistant,
            your prompt and relevant medicine details are transmitted directly to Google's Gemini API
            using your saved API key. Your API key and chat history remain stored locally on your device.
          </Text>

          <View style={styles.divider} />

          <Text style={styles.sectionTitle}>Offline Use & Manual Entry</Text>
          <Text style={styles.paragraph}>
            Cloud features are optional. You can manage your medications, schedule alarms, and track
            dose adherence entirely offline by adding medicines manually without transmitting any data.
          </Text>

          <View style={styles.divider} />

          <Text style={styles.sectionTitle}>Zero Third-Party Advertising</Text>
          <Text style={styles.paragraph}>
            We do not sell, broker, or transmit your health records, adherence data, or personal
            information to advertising networks or external data brokers.
          </Text>

          <View style={styles.divider} />

          <Text style={styles.sectionTitle}>Data Control, Export & Deletion</Text>
          <Text style={styles.paragraph}>
            You have complete sovereignty over your data. You can export or restore complete JSON
            snapshots, delete individual medications or scans, or wipe all application data at any
            time from Settings.
          </Text>
        </AppCard>
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
  },
  iconCircle: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: Colors.primaryLight,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 12,
  },
  heading: {
    fontSize: 18,
    fontWeight: '800',
    color: Colors.textPrimary,
    marginBottom: 8,
  },
  sectionTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: Colors.textPrimary,
    marginBottom: 4,
  },
  paragraph: {
    fontSize: 14,
    lineHeight: 21,
    color: Colors.textSecondary,
  },
  divider: {
    height: 1,
    backgroundColor: Colors.border,
    marginVertical: 14,
  },
});
