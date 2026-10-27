import React from 'react';
import { StyleSheet, View, Text } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '../../theme/colors';
import { Radius, Spacing, Typography } from '../../theme/tokens';
import { AppScreen } from '../../components/ui/AppScreen';
import { AppHeader } from '../../components/ui/AppHeader';
import { AppCard } from '../../components/ui/AppCard';

export default function DisclaimerScreen() {
  const router = useRouter();

  return (
    <AppScreen scrollable contentContainerStyle={styles.scrollContent}>
      <AppHeader
        title="Medical Disclaimer"
        subtitle="Important safety boundaries & purpose"
        brandText="HealthMate AI"
        onBackPress={() => router.back()}
      />

      <View style={styles.body}>
        <AppCard style={styles.warningCard}>
          <View style={styles.warningRow}>
            <Ionicons name="warning" size={24} color="#D97706" />
            <Text style={styles.warningTitle}>Not Medical Advice</Text>
          </View>
          <Text style={styles.warningBody}>
            HealthMate AI is strictly an organizational aid and educational reference for medicine
            packages and routine reminders. It is NOT a clinical tool, diagnostic system, or
            prescribing service.
          </Text>
        </AppCard>

        <AppCard style={styles.card}>
          <Text style={styles.sectionTitle}>Prescription Label Supremacy</Text>
          <Text style={styles.paragraph}>
            Always follow the physical instructions given by your physician and printed on your
            pharmacy prescription label. Never alter, skip, or double your dose based on reminders
            or information shown in this app.
          </Text>

          <View style={styles.divider} />

          <Text style={styles.sectionTitle}>Emergency Situations</Text>
          <Text style={styles.paragraph}>
            If you suspect an adverse drug interaction, overdose, severe allergic reaction, or
            medical emergency, immediately contact your local emergency medical services or
            emergency poison control center.
          </Text>

          <View style={styles.divider} />

          <Text style={styles.sectionTitle}>OCR & Automated Text Notice</Text>
          <Text style={styles.paragraph}>
            Camera packaging recognition is provided for data entry convenience. OCR can misread
            characters, strengths, and expiry dates. Always verify detected details yourself before
            confirming or saving.
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
  warningCard: {
    backgroundColor: '#FFF8EC',
    borderColor: '#FDE4BC',
    marginBottom: Spacing.lg,
  },
  warningRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  warningTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: '#B45309',
    marginLeft: 8,
  },
  warningBody: {
    fontSize: 14,
    lineHeight: 20,
    color: '#92400E',
  },
  card: {
    marginBottom: Spacing.lg,
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
