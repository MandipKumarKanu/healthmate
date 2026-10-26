import React from 'react';
import { StyleSheet, View, Text } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import Constants from 'expo-constants';
import { Colors } from '../../theme/colors';
import { Radius, Spacing } from '../../theme/tokens';
import { AppScreen } from '../../components/ui/AppScreen';
import { AppHeader } from '../../components/ui/AppHeader';
import { AppCard } from '../../components/ui/AppCard';

export default function AboutScreen() {
  const router = useRouter();
  const appVersion = Constants.expoConfig?.version ?? '1.3.1';

  return (
    <AppScreen scrollable contentContainerStyle={styles.scrollContent}>
      <AppHeader
        title="About HealthMate AI"
        subtitle="Version & architecture details"
        brandText="HealthMate AI"
        onBackPress={() => router.back()}
      />

      <View style={styles.body}>
        <AppCard style={styles.card}>
          <View style={styles.logoRow}>
            <View style={styles.appIcon}>
              <Ionicons name="pulse" size={28} color="#FFFFFF" />
            </View>
            <View style={styles.logoTextContainer}>
              <Text style={styles.appName}>HealthMate AI</Text>
              <Text style={styles.versionText}>Version {appVersion} (Release Build)</Text>
            </View>
          </View>
          <Text style={styles.description}>
            A mobile medication management and medicine-label education application
            built with modern React Native, Expo Router, and on-device SQLite.
          </Text>
        </AppCard>

        <AppCard style={styles.card}>
          <Text style={styles.sectionTitle}>Technology Stack</Text>
          <Text style={styles.bullet}>• React Native 0.88 with React 19</Text>
          <Text style={styles.bullet}>• Expo SDK 58 & Expo Router</Text>
          <Text style={styles.bullet}>• Expo SQLite for on-device persistence</Text>
          <Text style={styles.bullet}>• Expo Notifications for schedule alarms</Text>
          <Text style={styles.bullet}>• Expo Camera for packaging OCR scans</Text>
          <Text style={styles.bullet}>• Zustand for responsive client-side state</Text>
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
  logoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  appIcon: {
    width: 48,
    height: 48,
    borderRadius: 16,
    backgroundColor: Colors.primary,
    justifyContent: 'center',
    alignItems: 'center',
  },
  logoTextContainer: {
    marginLeft: 12,
  },
  appName: {
    fontSize: 18,
    fontWeight: '800',
    color: Colors.textPrimary,
  },
  versionText: {
    fontSize: 13,
    color: Colors.textSecondary,
    marginTop: 2,
  },
  description: {
    fontSize: 14,
    lineHeight: 20,
    color: Colors.textSecondary,
  },
  sectionTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: Colors.textPrimary,
    marginBottom: 8,
  },
  bullet: {
    fontSize: 13,
    lineHeight: 22,
    color: Colors.textSecondary,
  },
});
