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
        subtitle="Local-first data isolation architecture"
        brandText="HealthMate AI"
        onBackPress={() => router.back()}
      />

      <View style={styles.body}>
        <AppCard style={styles.card}>
          <View style={styles.iconCircle}>
            <Feather name="shield" size={28} color={Colors.primary} />
          </View>
          <Text style={styles.heading}>Your Data Stays on Your Device</Text>
          <Text style={styles.paragraph}>
            HealthMate AI is designed with privacy at its core. Your medication lists, dosage
            schedules, adherence history, and packaging camera scans are stored exclusively in your
            device's local SQLite database.
          </Text>
        </AppCard>

        <AppCard style={styles.card}>
          <Text style={styles.sectionTitle}>Zero Third-Party Tracking</Text>
          <Text style={styles.paragraph}>
            We do not sell, share, or transmit your health logs or personal identifying data to
            advertising networks or third-party brokers.
          </Text>

          <View style={styles.divider} />

          <Text style={styles.sectionTitle}>Camera & Photo Access</Text>
          <Text style={styles.paragraph}>
            Camera access is only utilized during package label scanning to extract text using
            on-device optical character recognition. Scanned images are stored locally in
            application cache.
          </Text>

          <View style={styles.divider} />

          <Text style={styles.sectionTitle}>Data Control & Deletion</Text>
          <Text style={styles.paragraph}>
            You have complete sovereignty over your data. You can delete individual records, clear
            your scan history, or wipe all application data at any time from Profile & Settings.
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
    backgroundColor: Colors.borderLight,
    marginVertical: 14,
  },
});
