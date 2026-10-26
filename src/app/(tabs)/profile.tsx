import React, { useState } from 'react';
import {
  StyleSheet,
  View,
  Text,
  TouchableOpacity,
  Switch,
  Alert,
  TextInput,
  Modal,
  ScrollView,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons, Feather, MaterialCommunityIcons } from '@expo/vector-icons';
import { Colors } from '../../theme/colors';
import { Radius, Spacing, Typography } from '../../theme/tokens';
import { AppScreen } from '../../components/ui/AppScreen';
import { AppHeader } from '../../components/ui/AppHeader';
import { AppCard } from '../../components/ui/AppCard';
import { AppButton } from '../../components/ui/AppButton';
import { SectionHeader } from '../../components/ui/SectionHeader';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
import { useAppStore } from '../../store/appStore';
import { notificationService } from '../../services/notificationService';
import Constants from 'expo-constants';
import { GenderOption, UnitSystem } from '../../types';
import { AlarmReliabilityCard } from '../../components/profile/AlarmReliabilityCard';

export default function ProfileScreen() {
  const router = useRouter();
  const appVersion = Constants.expoConfig?.version ?? '1.3.2';
  const { profile, preferences, updateProfile, togglePreference, resetAllData, clearAllData } =
    useAppStore();

  const [isEditingProfile, setIsEditingProfile] = useState(false);
  const [nameInput, setNameInput] = useState(profile?.name || 'Alex');
  const [ageInput, setAgeInput] = useState(profile?.age ? String(profile.age) : '');
  const [genderInput, setGenderInput] = useState<GenderOption | null>(
    (profile?.gender as GenderOption) || null
  );
  const [heightInput, setHeightInput] = useState(profile?.height ? String(profile.height) : '');
  const [weightInput, setWeightInput] = useState(profile?.weight ? String(profile.weight) : '');
  const [unitSystemInput, setUnitSystemInput] = useState<UnitSystem>(profile?.unitSystem || 'metric');
  const [editErrors, setEditErrors] = useState<{ name?: string; age?: string; height?: string; weight?: string }>({});

  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const [showClearConfirm, setShowClearConfirm] = useState(false);

  const userName = profile?.name || 'Alex';
  const userInitials = userName
    .split(' ')
    .map((p) => p[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();

  const openEditModal = () => {
    setNameInput(profile?.name || '');
    setAgeInput(profile?.age ? String(profile.age) : '');
    setGenderInput((profile?.gender as GenderOption) || null);
    setHeightInput(profile?.height ? String(profile.height) : '');
    setWeightInput(profile?.weight ? String(profile.weight) : '');
    setUnitSystemInput(profile?.unitSystem || 'metric');
    setEditErrors({});
    setIsEditingProfile(true);
  };

  const handleSaveProfile = () => {
    const trimmed = nameInput.trim();
    if (!trimmed) {
      setEditErrors({ name: 'Name cannot be empty' });
      return;
    }
    const errors: typeof editErrors = {};
    if (ageInput.trim()) {
      const pAge = Number(ageInput.trim());
      if (isNaN(pAge) || pAge < 1 || pAge > 120) {
        errors.age = 'Age must be 1-120';
      }
    }
    if (heightInput.trim()) {
      const pHeight = Number(heightInput.trim());
      if (isNaN(pHeight) || pHeight <= 0) {
        errors.height = 'Invalid height';
      }
    }
    if (weightInput.trim()) {
      const pWeight = Number(weightInput.trim());
      if (isNaN(pWeight) || pWeight <= 0) {
        errors.weight = 'Invalid weight';
      }
    }
    if (Object.keys(errors).length > 0) {
      setEditErrors(errors);
      return;
    }

    updateProfile(trimmed, {
      age: ageInput.trim() ? Number(ageInput.trim()) : undefined,
      gender: genderInput || undefined,
      height: heightInput.trim() ? Number(heightInput.trim()) : undefined,
      weight: weightInput.trim() ? Number(weightInput.trim()) : undefined,
      unitSystem: unitSystemInput,
    });
    setIsEditingProfile(false);
  };

  const handleResetData = async () => {
    try {
      await notificationService.cancelAll();
      resetAllData();
      setShowResetConfirm(false);
      Alert.alert('Reset Complete', 'All local records were replaced with fictional demonstration data.');
    } catch (error) {
      console.error('Could not reset demonstration data:', error);
      Alert.alert('Reset failed', 'Your data could not be reset. Please try again.');
    }
  };

  const handleClearAllData = async () => {
    try {
      await notificationService.cancelAll();
      clearAllData();
      setShowClearConfirm(false);
      Alert.alert(
        'Data Cleared',
        'All local profile data, medicines, schedules, adherence logs, scan history, and preferences have been cleared.',
        [{ text: 'OK', onPress: () => router.replace('/onboarding') }]
      );
    } catch (error) {
      console.error('Could not clear local data:', error);
      Alert.alert('Clear failed', 'Your data could not be cleared. Please try again.');
    }
  };

  return (
    <AppScreen scrollable contentContainerStyle={styles.scrollContent}>
      <AppHeader
        title="Profile & Settings"
        subtitle="Manage your personal preferences"
        brandText="HealthMate AI"
        rightAction={
          <TouchableOpacity
            style={styles.editButton}
            onPress={openEditModal}
          >
            <Text style={styles.editButtonText}>Edit</Text>
          </TouchableOpacity>
        }
      />

      <View style={styles.body}>
        {/* Profile User Card */}
        <AppCard style={styles.profileCard}>
          <View style={styles.avatarCircle}>
            <Text style={styles.avatarInitials}>{userInitials}</Text>
          </View>

          <View style={styles.profileDetails}>
            <Text style={styles.profileName}>{userName}</Text>
            <Text style={styles.profileEmail}>
              {profile?.email || 'alex.m@example.com'}
            </Text>
            <Text style={styles.profileBadge}>
              HealthMate member since April 2026
            </Text>
          </View>
        </AppCard>

        {/* Section: Personal Information */}
        <SectionHeader title="Personal Information" />
        <AppCard style={styles.settingsGroup}>
          <TouchableOpacity
            style={styles.settingRow}
            onPress={openEditModal}
          >
            <View style={styles.settingIconContainer}>
              <Feather name="user" size={18} color={Colors.primary} />
            </View>
            <Text style={styles.settingLabel}>Your Name</Text>
            <Text style={styles.settingValue}>{userName}</Text>
            <Ionicons
              name="chevron-forward"
              size={16}
              color={Colors.textTertiary}
            />
          </TouchableOpacity>

          <View style={styles.rowDivider} />

          <TouchableOpacity
            style={styles.settingRow}
            onPress={openEditModal}
          >
            <View style={styles.settingIconContainer}>
              <Feather name="calendar" size={18} color={Colors.primary} />
            </View>
            <Text style={styles.settingLabel}>Age</Text>
            <Text style={styles.settingValue}>
              {profile?.age ? `${profile.age} yrs` : 'Not set'}
            </Text>
            <Ionicons
              name="chevron-forward"
              size={16}
              color={Colors.textTertiary}
            />
          </TouchableOpacity>

          <View style={styles.rowDivider} />

          <TouchableOpacity
            style={styles.settingRow}
            onPress={openEditModal}
          >
            <View style={styles.settingIconContainer}>
              <Ionicons name="person-outline" size={18} color={Colors.primary} />
            </View>
            <Text style={styles.settingLabel}>Gender</Text>
            <Text style={styles.settingValue}>
              {profile?.gender || 'Not set'}
            </Text>
            <Ionicons
              name="chevron-forward"
              size={16}
              color={Colors.textTertiary}
            />
          </TouchableOpacity>

          <View style={styles.rowDivider} />

          <TouchableOpacity
            style={styles.settingRow}
            onPress={openEditModal}
          >
            <View style={styles.settingIconContainer}>
              <MaterialCommunityIcons name="human-male-height" size={18} color={Colors.primary} />
            </View>
            <Text style={styles.settingLabel}>Height</Text>
            <Text style={styles.settingValue}>
              {profile?.height
                ? `${profile.height} ${profile.unitSystem === 'imperial' ? 'ft' : 'cm'}`
                : 'Not set'}
            </Text>
            <Ionicons
              name="chevron-forward"
              size={16}
              color={Colors.textTertiary}
            />
          </TouchableOpacity>

          <View style={styles.rowDivider} />

          <TouchableOpacity
            style={styles.settingRow}
            onPress={openEditModal}
          >
            <View style={styles.settingIconContainer}>
              <MaterialCommunityIcons name="scale-bathroom" size={18} color={Colors.primary} />
            </View>
            <Text style={styles.settingLabel}>Weight</Text>
            <Text style={styles.settingValue}>
              {profile?.weight
                ? `${profile.weight} ${profile.unitSystem === 'imperial' ? 'lb' : 'kg'}`
                : 'Not set'}
            </Text>
            <Ionicons
              name="chevron-forward"
              size={16}
              color={Colors.textTertiary}
            />
          </TouchableOpacity>

          <View style={styles.rowDivider} />

          <TouchableOpacity
            style={styles.settingRow}
            onPress={openEditModal}
          >
            <View style={styles.settingIconContainer}>
              <Feather name="sliders" size={18} color={Colors.primary} />
            </View>
            <Text style={styles.settingLabel}>Units</Text>
            <Text style={styles.settingValue}>
              {profile?.unitSystem === 'imperial' ? 'Imperial (ft, lb)' : 'Metric (cm, kg)'}
            </Text>
            <Ionicons
              name="chevron-forward"
              size={16}
              color={Colors.textTertiary}
            />
          </TouchableOpacity>
        </AppCard>

        {/* Section: Preferences & Security */}
        <SectionHeader title="Preferences & Security" />
        <AppCard style={styles.settingsGroup}>
          <View style={styles.settingRow}>
            <View style={styles.settingIconContainer}>
              <Feather name="bell" size={18} color={Colors.primary} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.settingLabel}>In-App Medicine Reminders</Text>
              <Text style={styles.settingSub}>Scheduled alert sounds</Text>
            </View>
            <Switch
              value={preferences.inAppReminders}
              onValueChange={() => togglePreference('inAppReminders')}
              trackColor={{ false: '#D0D0D8', true: Colors.primary }}
            />
          </View>

          <View style={styles.rowDivider} />

          <View style={styles.settingRow}>
            <View style={styles.settingIconContainer}>
              <Ionicons name="sparkles-outline" size={18} color={Colors.primary} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.settingLabel}>AI Health Assistant</Text>
              <Text style={styles.settingSub}>Label clarity & terminology</Text>
            </View>
            <Switch
              value={preferences.aiAssistantEnabled}
              onValueChange={() => togglePreference('aiAssistantEnabled')}
              trackColor={{ false: '#D0D0D8', true: Colors.primary }}
            />
          </View>

          <View style={styles.rowDivider} />

          <TouchableOpacity
            style={styles.settingRow}
            onPress={() => router.push('/scan-history')}
          >
            <View style={styles.settingIconContainer}>
              <Feather name="clock" size={18} color={Colors.primary} />
            </View>
            <Text style={styles.settingLabel}>AI Scan History</Text>
            <Ionicons
              name="chevron-forward"
              size={16}
              color={Colors.textTertiary}
            />
          </TouchableOpacity>

          <View style={styles.rowDivider} />

          <TouchableOpacity
            style={styles.settingRow}
            onPress={() => router.push('/(tabs)/scan')}
          >
            <View style={styles.settingIconContainer}>
              <Ionicons name="camera-outline" size={18} color={Colors.primary} />
            </View>
            <Text style={styles.settingLabel}>Camera Permissions</Text>
            <Text style={styles.settingValue}>Allowed</Text>
            <Ionicons
              name="chevron-forward"
              size={16}
              color={Colors.textTertiary}
            />
          </TouchableOpacity>

          <View style={styles.rowDivider} />

          <TouchableOpacity
            style={styles.settingRow}
            onPress={() => router.push('/settings/privacy')}
          >
            <View style={styles.settingIconContainer}>
              <Feather name="shield" size={18} color={Colors.primary} />
            </View>
            <Text style={styles.settingLabel}>Privacy & User Data Isolation</Text>
            <Ionicons
              name="chevron-forward"
              size={16}
              color={Colors.textTertiary}
            />
          </TouchableOpacity>
        </AppCard>

        {/* Section: Alarm Reliability & Battery */}
        <SectionHeader title="Alarm Reliability & Battery" />
        <AlarmReliabilityCard />

        {/* Section: Medical Disclaimer & About */}
        <SectionHeader title="Medical Disclaimer & About" />
        <AppCard style={styles.settingsGroup}>
          <TouchableOpacity
            style={styles.settingRow}
            onPress={() => router.push('/settings/disclaimer')}
          >
            <View style={styles.settingIconContainer}>
              <Ionicons
                name="alert-circle-outline"
                size={18}
                color={Colors.warning}
              />
            </View>
            <Text style={styles.settingLabel}>Full Medical Disclaimer</Text>
            <Ionicons
              name="chevron-forward"
              size={16}
              color={Colors.textTertiary}
            />
          </TouchableOpacity>

          <View style={styles.rowDivider} />

          <TouchableOpacity
            style={styles.settingRow}
            onPress={() => router.push('/settings/about')}
          >
            <View style={styles.settingIconContainer}>
              <Ionicons
                name="information-circle-outline"
                size={18}
                color={Colors.primary}
              />
            </View>
            <Text style={styles.settingLabel}>About HealthMate AI</Text>
            <Text style={styles.settingValue}>v{appVersion}</Text>
            <Ionicons
              name="chevron-forward"
              size={16}
              color={Colors.textTertiary}
            />
          </TouchableOpacity>
        </AppCard>

        {/* Section: Data Management */}
        <SectionHeader title="Data Management" />
        <AppCard style={styles.settingsGroup}>
          <TouchableOpacity
            style={styles.settingRow}
            onPress={() => setShowResetConfirm(true)}
          >
            <View style={styles.settingIconContainer}>
              <Feather name="refresh-cw" size={18} color={Colors.primary} />
            </View>
            <Text style={styles.settingLabel}>Reset Sample Records</Text>
            <Ionicons
              name="chevron-forward"
              size={16}
              color={Colors.textTertiary}
            />
          </TouchableOpacity>

          <View style={styles.rowDivider} />

          <TouchableOpacity
            style={styles.settingRow}
            onPress={() => setShowClearConfirm(true)}
          >
            <View style={[styles.settingIconContainer, { backgroundColor: '#FEECEE' }]}>
              <Feather name="trash-2" size={18} color={Colors.error} />
            </View>
            <Text style={[styles.settingLabel, { color: Colors.error }]}>
              Clear Personal Data
            </Text>
            <Ionicons
              name="chevron-forward"
              size={16}
              color={Colors.textTertiary}
            />
          </TouchableOpacity>
        </AppCard>

        {/* App Footer */}
        <View style={styles.footerContainer}>
          <Text style={styles.footerText}>
            HealthMate AI • Version {appVersion} (Expo SDK 58)
          </Text>
          <Text style={styles.footerSub}>
            All medication records stored locally on your device in encrypted SQLite.
          </Text>
        </View>
      </View>

      {/* Edit Profile Modal */}
      <Modal visible={isEditingProfile} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={styles.profileModalCard}>
            <Text style={styles.modalTitle}>Edit Profile</Text>

            <ScrollView
              style={{ maxHeight: 380 }}
              showsVerticalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
            >
              {/* Full Name */}
              <View style={styles.modalFieldGroup}>
                <Text style={styles.modalFieldLabel}>Full Name *</Text>
                <TextInput
                  style={[styles.modalInputBox, editErrors.name ? styles.inputErrorBorder : null]}
                  value={nameInput}
                  onChangeText={(t) => {
                    setNameInput(t);
                    if (editErrors.name) setEditErrors((p) => ({ ...p, name: undefined }));
                  }}
                  placeholder="Full name"
                />
                {editErrors.name ? <Text style={styles.errorText}>{editErrors.name}</Text> : null}
              </View>

              {/* Age */}
              <View style={styles.modalFieldGroup}>
                <Text style={styles.modalFieldLabel}>Age (optional)</Text>
                <TextInput
                  style={[styles.modalInputBox, editErrors.age ? styles.inputErrorBorder : null]}
                  value={ageInput}
                  onChangeText={(t) => {
                    setAgeInput(t.replace(/[^0-9]/g, ''));
                    if (editErrors.age) setEditErrors((p) => ({ ...p, age: undefined }));
                  }}
                  placeholder="e.g. 25"
                  keyboardType="number-pad"
                  maxLength={3}
                />
                {editErrors.age ? <Text style={styles.errorText}>{editErrors.age}</Text> : null}
              </View>

              {/* Gender */}
              <View style={styles.modalFieldGroup}>
                <Text style={styles.modalFieldLabel}>Gender (optional)</Text>
                <View style={styles.genderPillsRow}>
                  {(['Male', 'Female', 'Other', 'Prefer not to say'] as GenderOption[]).map((g) => (
                    <TouchableOpacity
                      key={g}
                      style={[
                        styles.genderPill,
                        genderInput === g && styles.genderPillSelected,
                      ]}
                      onPress={() => setGenderInput(genderInput === g ? null : g)}
                    >
                      <Text
                        style={[
                          styles.genderPillText,
                          genderInput === g && styles.genderPillTextSelected,
                        ]}
                      >
                        {g}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>

              {/* Height & Weight */}
              <View style={{ flexDirection: 'row', gap: 10 }}>
                <View style={[styles.modalFieldGroup, { flex: 1 }]}>
                  <Text style={styles.modalFieldLabel}>
                    Height ({unitSystemInput === 'metric' ? 'cm' : 'ft'})
                  </Text>
                  <TextInput
                    style={[styles.modalInputBox, editErrors.height ? styles.inputErrorBorder : null]}
                    value={heightInput}
                    onChangeText={(t) => {
                      setHeightInput(t);
                      if (editErrors.height) setEditErrors((p) => ({ ...p, height: undefined }));
                    }}
                    placeholder={unitSystemInput === 'metric' ? 'e.g. 170' : 'e.g. 5.8'}
                    keyboardType="numeric"
                  />
                  {editErrors.height ? <Text style={styles.errorText}>{editErrors.height}</Text> : null}
                </View>

                <View style={[styles.modalFieldGroup, { flex: 1 }]}>
                  <Text style={styles.modalFieldLabel}>
                    Weight ({unitSystemInput === 'metric' ? 'kg' : 'lb'})
                  </Text>
                  <TextInput
                    style={[styles.modalInputBox, editErrors.weight ? styles.inputErrorBorder : null]}
                    value={weightInput}
                    onChangeText={(t) => {
                      setWeightInput(t);
                      if (editErrors.weight) setEditErrors((p) => ({ ...p, weight: undefined }));
                    }}
                    placeholder={unitSystemInput === 'metric' ? 'e.g. 65' : 'e.g. 145'}
                    keyboardType="numeric"
                  />
                  {editErrors.weight ? <Text style={styles.errorText}>{editErrors.weight}</Text> : null}
                </View>
              </View>

              {/* Units */}
              <View style={styles.modalFieldGroup}>
                <Text style={styles.modalFieldLabel}>Units</Text>
                <View style={styles.unitsSegmentRow}>
                  <TouchableOpacity
                    style={[
                      styles.unitSegBtn,
                      unitSystemInput === 'metric' && styles.unitSegBtnSelected,
                    ]}
                    onPress={() => setUnitSystemInput('metric')}
                  >
                    <Text
                      style={[
                        styles.unitSegText,
                        unitSystemInput === 'metric' && styles.unitSegTextSelected,
                      ]}
                    >
                      Metric (cm, kg)
                    </Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[
                      styles.unitSegBtn,
                      unitSystemInput === 'imperial' && styles.unitSegBtnSelected,
                    ]}
                    onPress={() => setUnitSystemInput('imperial')}
                  >
                    <Text
                      style={[
                        styles.unitSegText,
                        unitSystemInput === 'imperial' && styles.unitSegTextSelected,
                      ]}
                    >
                      Imperial (ft, lb)
                    </Text>
                  </TouchableOpacity>
                </View>
              </View>
            </ScrollView>

            <View style={[styles.modalButtons, { marginTop: 16 }]}>
              <AppButton
                title="Cancel"
                onPress={() => setIsEditingProfile(false)}
                variant="outline"
                size="md"
                style={{ flex: 1, marginRight: 8 }}
              />
              <AppButton
                title="Save"
                onPress={handleSaveProfile}
                variant="primary"
                size="md"
                style={{ flex: 1 }}
              />
            </View>
          </View>
        </View>
      </Modal>

      {/* Reset Confirmation Dialog */}
      <ConfirmDialog
        visible={showResetConfirm}
        title="Reset Sample Records"
        message="This permanently replaces all current local profile data, medicines, schedules, adherence logs, scan history, and preferences with fictional demonstration records."
        confirmText="Reset"
        onConfirm={handleResetData}
        onCancel={() => setShowResetConfirm(false)}
      />

      {/* Clear Personal Data Confirmation Dialog */}
      <ConfirmDialog
        visible={showClearConfirm}
        title="Clear Personal Data"
        message="This permanently deletes the local profile, preferences, medicines, reminder schedules, adherence logs, scan history, and pending notifications from this device."
        confirmText="Clear All Data"
        destructive
        onConfirm={handleClearAllData}
        onCancel={() => setShowClearConfirm(false)}
      />
    </AppScreen>
  );
}

const styles = StyleSheet.create({
  scrollContent: {
    paddingBottom: 110,
  },
  body: {
    paddingHorizontal: Spacing.screenPaddingHorizontal,
  },
  editButton: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: Colors.border,
    paddingVertical: 5,
    paddingHorizontal: 12,
    borderRadius: Radius.pill,
  },
  editButtonText: {
    fontSize: 13,
    fontWeight: '600',
    color: Colors.textPrimary,
  },
  profileCard: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: Spacing.lg,
  },
  avatarCircle: {
    width: 58,
    height: 58,
    borderRadius: 29,
    backgroundColor: Colors.primaryLight,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#D0E6FA',
  },
  avatarInitials: {
    fontSize: 20,
    fontWeight: '800',
    color: Colors.primary,
  },
  profileDetails: {
    flex: 1,
    marginLeft: Spacing.md,
  },
  profileName: {
    fontSize: 18,
    fontWeight: '700',
    color: Colors.textPrimary,
  },
  profileEmail: {
    fontSize: 13,
    color: Colors.textSecondary,
    marginTop: 2,
  },
  profileBadge: {
    fontSize: 11,
    color: Colors.textTertiary,
    marginTop: 4,
  },
  settingsGroup: {
    marginBottom: Spacing.lg,
    paddingVertical: 4,
  },
  settingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
  },
  settingIconContainer: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: Colors.primaryLight,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  settingLabel: {
    flex: 1,
    fontSize: 15,
    fontWeight: '500',
    color: Colors.textPrimary,
  },
  settingSub: {
    fontSize: 12,
    color: Colors.textSecondary,
    marginTop: 2,
  },
  settingValue: {
    fontSize: 14,
    color: Colors.textSecondary,
    marginRight: 6,
  },
  pillTag: {
    backgroundColor: '#F0EFEF',
    paddingVertical: 3,
    paddingHorizontal: 8,
    borderRadius: Radius.pill,
    marginRight: 6,
  },
  pillTagText: {
    fontSize: 11,
    color: Colors.textSecondary,
    fontWeight: '600',
  },
  rowDivider: {
    height: 1,
    backgroundColor: Colors.borderLight,
  },
  footerContainer: {
    alignItems: 'center',
    paddingVertical: Spacing.xl,
  },
  footerText: {
    fontSize: 12,
    fontWeight: '600',
    color: Colors.textSecondary,
  },
  footerSub: {
    fontSize: 11,
    color: Colors.textTertiary,
    marginTop: 4,
    textAlign: 'center',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.45)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: Spacing.xl,
  },
  nameModalCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: Radius.card,
    padding: Spacing.xl,
    width: '100%',
    maxWidth: 320,
  },
  profileModalCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: Radius.card,
    padding: Spacing.lg,
    width: '100%',
    maxWidth: 360,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: Colors.textPrimary,
    marginBottom: 12,
  },
  modalFieldGroup: {
    marginBottom: 12,
  },
  modalFieldLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: '#475569',
    marginBottom: 4,
  },
  modalInputBox: {
    fontSize: 14,
    borderWidth: 1,
    borderColor: '#CBD5E1',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    color: Colors.textPrimary,
    backgroundColor: '#F8FAFC',
  },
  inputErrorBorder: {
    borderColor: Colors.error,
  },
  errorText: {
    fontSize: 11,
    color: Colors.error,
    marginTop: 2,
  },
  genderPillsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  genderPill: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: Radius.pill,
    backgroundColor: '#F1F5F9',
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  genderPillSelected: {
    backgroundColor: '#E0F2FE',
    borderColor: Colors.primary,
  },
  genderPillText: {
    fontSize: 12,
    color: '#64748B',
  },
  genderPillTextSelected: {
    color: Colors.primary,
    fontWeight: '600',
  },
  unitsSegmentRow: {
    flexDirection: 'row',
    backgroundColor: '#F1F5F9',
    borderRadius: 8,
    padding: 2,
  },
  unitSegBtn: {
    flex: 1,
    paddingVertical: 6,
    alignItems: 'center',
    borderRadius: 6,
  },
  unitSegBtnSelected: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: Colors.primary,
  },
  unitSegText: {
    fontSize: 12,
    color: '#64748B',
  },
  unitSegTextSelected: {
    color: Colors.primary,
    fontWeight: '600',
  },
  modalInput: {
    fontSize: 16,
    borderBottomWidth: 1,
    borderBottomColor: Colors.primary,
    paddingVertical: 8,
    marginBottom: 20,
    color: Colors.textPrimary,
  },
  modalButtons: {
    flexDirection: 'row',
  },
});
