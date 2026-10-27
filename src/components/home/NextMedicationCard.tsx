import React from 'react';
import { StyleSheet, View, Text, TouchableOpacity } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { ScheduledDose } from '../../types';
import { Radius, Shadows, Spacing } from '../../theme/tokens';

export interface NextMedicationCardProps {
  dose: ScheduledDose;
  onMarkAsTaken: (dose: ScheduledDose) => void;
}

export function NextMedicationCard({ dose, onMarkAsTaken }: NextMedicationCardProps) {
  return (
    <View style={styles.container}>
      <Text style={styles.sectionTitle}>Next up</Text>
      <View style={styles.card}>
        {/* Top Info Row */}
        <View style={styles.topRow}>
          <View style={styles.iconContainer}>
            <MaterialCommunityIcons
              name="pill"
              size={22}
              color="#0788F5"
              style={{ transform: [{ rotate: '-45deg' }] }}
            />
          </View>
          <View style={styles.infoContainer}>
            <Text style={styles.medName}>{dose.medicineName}</Text>
            <Text style={styles.medDose}>
              {dose.strength} · {dose.amount}
            </Text>
          </View>
          <Text style={styles.timeText}>{dose.time}</Text>
        </View>

        {/* Schedule Subtext */}
        <Text style={styles.scheduleNote}>From your saved example schedule</Text>

        {/* Action Button */}
        <TouchableOpacity
          style={styles.actionButton}
          onPress={() => onMarkAsTaken(dose)}
          activeOpacity={0.8}
        >
          <Text style={styles.actionButtonText}>Mark as Taken</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginBottom: Spacing.lg,
  },
  sectionTitle: {
    fontSize: 13,
    fontWeight: '600',
    color: '#8A8991',
    marginBottom: 8,
  },
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 22,
    padding: 18,
    borderWidth: 1,
    borderColor: '#ECEBF0',
    ...Shadows.card,
    elevation: 3,
  },
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  iconContainer: {
    width: 46,
    height: 46,
    borderRadius: 14,
    backgroundColor: '#EAF4FE',
    justifyContent: 'center',
    alignItems: 'center',
  },
  infoContainer: {
    flex: 1,
    marginLeft: 12,
  },
  medName: {
    fontSize: 17,
    fontWeight: '700',
    color: '#111116',
  },
  medDose: {
    fontSize: 13,
    color: '#8A8991',
    marginTop: 2,
  },
  timeText: {
    fontSize: 18,
    fontWeight: '800',
    color: '#0788F5',
  },
  scheduleNote: {
    fontSize: 12,
    color: '#8A8991',
    marginTop: 12,
    marginBottom: 14,
  },
  actionButton: {
    width: '100%',
    height: 48,
    borderRadius: Radius.pill,
    backgroundColor: '#0788F5',
    justifyContent: 'center',
    alignItems: 'center',
  },
  actionButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#FFFFFF',
  },
});
