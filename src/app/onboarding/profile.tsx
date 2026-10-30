import React, { useState, useRef, useEffect } from 'react';
import {
  StyleSheet,
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  Image,
  Modal,
  ActivityIndicator,
} from 'react-native';
import { AppAlert as Alert } from '../../services/appAlert';
import { useRouter } from 'expo-router';
import { Ionicons, Feather, MaterialCommunityIcons } from '@expo/vector-icons';
import { AppScreen } from '../../components/ui/AppScreen';
import { Radius, Spacing } from '../../theme/tokens';
import { useAppStore } from '../../store/appStore';
import { GenderOption, UnitSystem } from '../../types';
import { useKeyboardAwareScroll } from '../../hooks/useKeyboardAwareScroll';

const GENDER_OPTIONS: { label: string; value: GenderOption }[] = [
  { label: 'Male', value: 'Male' },
  { label: 'Female', value: 'Female' },
  { label: 'Other', value: 'Other' },
  { label: 'Prefer not to say', value: 'Prefer not to say' },
];

export default function OnboardingProfileScreen() {
  const router = useRouter();
  const {
    scrollViewRef: profileScrollRef,
    scrollToNode: scrollFocusedInput,
    handleFocusCapture,
    onScroll,
  } = useKeyboardAwareScroll({ extraOffset: 80 });

  const { updateProfile, profile, setOnboardingStep, onboardingDraft, setOnboardingDraft } =
    useAppStore();

  useEffect(() => {
    if (profile?.onboardingCompleted) {
      router.replace('/(tabs)/home');
    }
  }, [profile?.onboardingCompleted, router]);

  const [name, setName] = useState(onboardingDraft.name || profile?.name || '');
  const [age, setAge] = useState(onboardingDraft.age || (profile?.age ? String(profile.age) : ''));
  const [gender, setGender] = useState<GenderOption | null>(
    onboardingDraft.gender ?? ((profile?.gender as GenderOption) || null),
  );
  const [height, setHeight] = useState(
    onboardingDraft.height || (profile?.height ? String(profile.height) : ''),
  );
  const [weight, setWeight] = useState(
    onboardingDraft.weight || (profile?.weight ? String(profile.weight) : ''),
  );
  const [unitSystem, setUnitSystem] = useState<UnitSystem>(
    onboardingDraft.unitSystem || profile?.unitSystem || 'metric',
  );
  const [heightUnit, setHeightUnit] = useState<'cm' | 'ft'>(
    (onboardingDraft.unitSystem || profile?.unitSystem) === 'imperial' ? 'ft' : 'cm',
  );
  const [weightUnit, setWeightUnit] = useState<'kg' | 'lb'>(
    (onboardingDraft.unitSystem || profile?.unitSystem) === 'imperial' ? 'lb' : 'kg',
  );
  const [showHeightUnitDropdown, setShowHeightUnitDropdown] = useState(false);
  const [showWeightUnitDropdown, setShowWeightUnitDropdown] = useState(false);

  const handleSelectHeightUnit = (unit: 'cm' | 'ft') => {
    if (unit === heightUnit) {
      setShowHeightUnitDropdown(false);
      return;
    }
    if (height.trim()) {
      const num = parseFloat(height.trim());
      if (!isNaN(num) && num > 0) {
        if (unit === 'ft') {
          setHeight((num / 30.48).toFixed(1));
        } else {
          setHeight(Math.round(num * 30.48).toString());
        }
      }
    }
    setHeightUnit(unit);
    setShowHeightUnitDropdown(false);
    if (errors.height) setErrors((prev) => ({ ...prev, height: undefined }));
  };

  const handleSelectWeightUnit = (unit: 'kg' | 'lb') => {
    if (unit === weightUnit) {
      setShowWeightUnitDropdown(false);
      return;
    }
    if (weight.trim()) {
      const num = parseFloat(weight.trim());
      if (!isNaN(num) && num > 0) {
        if (unit === 'lb') {
          setWeight(Math.round(num * 2.20462).toString());
        } else {
          setWeight(Math.round(num / 2.20462).toString());
        }
      }
    }
    setWeightUnit(unit);
    setShowWeightUnitDropdown(false);
    if (errors.weight) setErrors((prev) => ({ ...prev, weight: undefined }));
  };

  const [errors, setErrors] = useState<{
    name?: string;
    age?: string;
    height?: string;
    weight?: string;
  }>({});

  const [genderModalVisible, setGenderModalVisible] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const validateForm = () => {
    const newErrors: {
      name?: string;
      age?: string;
      height?: string;
      weight?: string;
    } = {};

    // 1. Required Name
    const trimmedName = name.trim();
    if (!trimmedName) {
      newErrors.name = 'Please enter your full name';
    }

    // 2. Optional Age validation (only validate if provided)
    if (age.trim()) {
      const parsedAge = Number(age.trim());
      if (isNaN(parsedAge) || parsedAge < 1 || parsedAge > 120 || !Number.isInteger(parsedAge)) {
        newErrors.age = 'Enter a valid age (1-120)';
      }
    }

    // 3. Optional Height validation (only validate if provided)
    if (height.trim()) {
      const parsedHeight = Number(height.trim());
      if (isNaN(parsedHeight) || parsedHeight <= 0) {
        newErrors.height = 'Enter a positive number';
      } else if (heightUnit === 'cm' && (parsedHeight < 30 || parsedHeight > 300)) {
        newErrors.height = 'Height should be 30–300 cm';
      } else if (heightUnit === 'ft' && (parsedHeight < 1 || parsedHeight > 9)) {
        newErrors.height = 'Height should be 1–9 ft';
      }
    }

    // 4. Optional Weight validation (only validate if provided)
    if (weight.trim()) {
      const parsedWeight = Number(weight.trim());
      if (isNaN(parsedWeight) || parsedWeight <= 0) {
        newErrors.weight = 'Enter a positive number';
      } else if (weightUnit === 'kg' && (parsedWeight < 1 || parsedWeight > 500)) {
        newErrors.weight = 'Weight should be 1–500 kg';
      } else if (weightUnit === 'lb' && (parsedWeight < 2 || parsedWeight > 1000)) {
        newErrors.weight = 'Weight should be 2–1000 lb';
      }
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleGetStarted = async () => {
    if (!validateForm()) {
      return;
    }

    setIsSubmitting(true);
    try {
      const trimmedName = name.trim();
      const parsedAge = age.trim() ? Number(age.trim()) : undefined;
      const parsedHeight = height.trim() ? Number(height.trim()) : undefined;
      const parsedWeight = weight.trim() ? Number(weight.trim()) : undefined;

      const unitSys: UnitSystem =
        heightUnit === 'ft' || weightUnit === 'lb' ? 'imperial' : 'metric';

      updateProfile(
        trimmedName,
        {
          age: parsedAge,
          gender: gender || undefined,
          height: parsedHeight,
          weight: parsedWeight,
          unitSystem: unitSys,
        },
        false,
      );

      setOnboardingStep('permissions');

      // Step 3: explain and request device permissions after profile details.
      router.push('/onboarding/permissions' as any);
    } catch (err) {
      Alert.alert(
        'Save Error',
        'Could not save your profile. Please check your details and try again.',
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <AppScreen scrollable={false} contentContainerStyle={styles.container}>
      <KeyboardAvoidingView
        style={styles.keyboardView}
        // Android already resizes this window. Avoid applying a second height
        // reduction on top of adjustResize while still allowing the form to scroll.
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <ScrollView
          ref={profileScrollRef}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
          automaticallyAdjustKeyboardInsets={true}
          onScroll={onScroll}
          scrollEventThrottle={16}
        >
          <View style={{ flexGrow: 1 }} onFocusCapture={handleFocusCapture}>
            {/* Top Bar: Back Button */}
            <View style={styles.topNavRow}>
              <TouchableOpacity
                onPress={() => router.back()}
                style={styles.backButton}
                activeOpacity={0.7}
                accessibilityRole="button"
                accessibilityLabel="Go back to welcome screen"
              >
                <Ionicons name="chevron-back" size={24} color="#0F172A" />
              </TouchableOpacity>
            </View>

            {/* Header Title with 3D Clipboard Asset */}
            <View style={styles.headerRow}>
              <View style={styles.headerTextGroup}>
                <Text style={styles.stepIndicator}>STEP 2 OF 3</Text>
                <Text style={styles.screenTitle}>Tell us about yourself</Text>
                <Text style={styles.screenSubtitle}>
                  This helps personalize your HealthMate experience. You can always edit this later.
                </Text>
              </View>

              <Image
                source={require('../../../assets/images/profile_clipboard.png')}
                style={styles.clipboardImage}
                resizeMode="contain"
                accessibilityLabel="Profile illustration"
              />
            </View>

            {/* White Card Form Container */}
            <View style={styles.formCard}>
              {/* Full name (Required) */}
              <View style={styles.fieldGroup}>
                <Text style={styles.fieldLabel}>
                  Full name <Text style={styles.requiredStar}>*</Text>
                </Text>
                <View style={[styles.inputContainer, errors.name ? styles.inputErrorBorder : null]}>
                  <Feather name="user" size={18} color="#94A3B8" style={styles.fieldIcon} />
                  <TextInput
                    style={styles.textInput}
                    placeholder="Enter your name"
                    placeholderTextColor="#94A3B8"
                    value={name}
                    onChangeText={(val) => {
                      setName(val);
                      setOnboardingDraft({ name: val });
                      if (errors.name) {
                        setErrors((prev) => ({ ...prev, name: undefined }));
                      }
                    }}
                    autoCapitalize="words"
                    autoCorrect={false}
                    onFocus={(event) => scrollFocusedInput(event.nativeEvent.target)}
                    accessibilityLabel="Full name"
                  />
                </View>
                {errors.name ? <Text style={styles.errorText}>{errors.name}</Text> : null}
              </View>

              {/* Age & Gender Side-by-Side Row */}
              <View style={styles.rowTwoCols}>
                {/* Age (Optional) */}
                <View style={[styles.fieldGroup, { flex: 1, marginRight: 8 }]}>
                  <Text style={styles.fieldLabel}>Age (optional)</Text>
                  <View
                    style={[styles.inputContainer, errors.age ? styles.inputErrorBorder : null]}
                  >
                    <Feather name="calendar" size={17} color="#94A3B8" style={styles.fieldIcon} />
                    <TextInput
                      style={styles.textInput}
                      placeholder="e.g. 25"
                      placeholderTextColor="#94A3B8"
                      value={age}
                      onChangeText={(val) => {
                        const clean = val.replace(/[^0-9]/g, '');
                        setAge(clean);
                        setOnboardingDraft({ age: clean });
                        if (errors.age) {
                          setErrors((prev) => ({ ...prev, age: undefined }));
                        }
                      }}
                      keyboardType="number-pad"
                      maxLength={3}
                      onFocus={(event) => scrollFocusedInput(event.nativeEvent.target)}
                      accessibilityLabel="Age"
                    />
                  </View>
                  {errors.age ? <Text style={styles.errorText}>{errors.age}</Text> : null}
                </View>

                {/* Gender (Optional) */}
                <View style={[styles.fieldGroup, { flex: 1, marginLeft: 8 }]}>
                  <Text style={styles.fieldLabel}>Gender (optional)</Text>
                  <TouchableOpacity
                    style={styles.inputContainer}
                    onPress={() => setGenderModalVisible(true)}
                    activeOpacity={0.75}
                    accessibilityRole="button"
                    accessibilityLabel="Select gender"
                  >
                    <Feather name="user" size={17} color="#94A3B8" style={styles.fieldIcon} />
                    <Text
                      style={[styles.selectText, !gender && styles.selectPlaceholderText]}
                      numberOfLines={1}
                    >
                      {gender || 'Select gender'}
                    </Text>
                    <Ionicons
                      name="chevron-down"
                      size={16}
                      color="#94A3B8"
                      style={styles.chevronIcon}
                    />
                  </TouchableOpacity>
                </View>
              </View>

              {/* Height (Optional) */}
              <View style={styles.fieldGroup}>
                <Text style={styles.fieldLabel}>Height (optional)</Text>
                <View
                  style={[styles.inputContainer, errors.height ? styles.inputErrorBorder : null]}
                >
                  <MaterialCommunityIcons
                    name="human-male-height"
                    size={19}
                    color="#94A3B8"
                    style={styles.fieldIcon}
                  />
                  <TextInput
                    style={styles.textInput}
                    placeholder={heightUnit === 'cm' ? 'e.g. 170' : 'e.g. 5.8'}
                    placeholderTextColor="#94A3B8"
                    value={height}
                    onChangeText={(val) => {
                      setHeight(val);
                      setOnboardingDraft({ height: val });
                      if (errors.height) {
                        setErrors((prev) => ({ ...prev, height: undefined }));
                      }
                    }}
                    keyboardType="numeric"
                    onFocus={(event) => scrollFocusedInput(event.nativeEvent.target)}
                    accessibilityLabel="Height"
                  />
                  <TouchableOpacity
                    style={styles.unitBadgeButton}
                    onPress={() => {
                      setShowHeightUnitDropdown((prev) => !prev);
                      setShowWeightUnitDropdown(false);
                    }}
                    activeOpacity={0.7}
                  >
                    <Text style={styles.unitBadgeText}>{heightUnit}</Text>
                    <Ionicons
                      name={showHeightUnitDropdown ? 'chevron-up' : 'chevron-down'}
                      size={14}
                      color="#64748B"
                    />
                  </TouchableOpacity>
                </View>

                {/* Inline Height Unit Dropdown */}
                {showHeightUnitDropdown ? (
                  <View style={styles.unitDropdownMenu}>
                    {(['cm', 'ft'] as const).map((u) => {
                      const isSelected = heightUnit === u;
                      return (
                        <TouchableOpacity
                          key={u}
                          style={[
                            styles.unitDropdownItem,
                            isSelected && styles.unitDropdownItemSelected,
                          ]}
                          onPress={() => handleSelectHeightUnit(u)}
                          activeOpacity={0.7}
                        >
                          <Text
                            style={[
                              styles.unitDropdownText,
                              isSelected && styles.unitDropdownTextSelected,
                            ]}
                          >
                            {u === 'cm' ? 'Centimeters (cm)' : 'Feet (ft)'}
                          </Text>
                          {isSelected ? (
                            <Ionicons name="checkmark" size={16} color="#0788F5" />
                          ) : null}
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                ) : null}

                {errors.height ? <Text style={styles.errorText}>{errors.height}</Text> : null}
              </View>

              {/* Weight (Optional) */}
              <View style={styles.fieldGroup}>
                <Text style={styles.fieldLabel}>Weight (optional)</Text>
                <View
                  style={[styles.inputContainer, errors.weight ? styles.inputErrorBorder : null]}
                >
                  <MaterialCommunityIcons
                    name="scale-bathroom"
                    size={19}
                    color="#94A3B8"
                    style={styles.fieldIcon}
                  />
                  <TextInput
                    style={styles.textInput}
                    placeholder={weightUnit === 'kg' ? 'e.g. 65' : 'e.g. 145'}
                    placeholderTextColor="#94A3B8"
                    value={weight}
                    onChangeText={(val) => {
                      setWeight(val);
                      setOnboardingDraft({ weight: val });
                      if (errors.weight) {
                        setErrors((prev) => ({ ...prev, weight: undefined }));
                      }
                    }}
                    keyboardType="numeric"
                    onFocus={(event) => scrollFocusedInput(event.nativeEvent.target)}
                    accessibilityLabel="Weight"
                  />
                  <TouchableOpacity
                    style={styles.unitBadgeButton}
                    onPress={() => {
                      setShowWeightUnitDropdown((prev) => !prev);
                      setShowHeightUnitDropdown(false);
                    }}
                    activeOpacity={0.7}
                  >
                    <Text style={styles.unitBadgeText}>{weightUnit}</Text>
                    <Ionicons
                      name={showWeightUnitDropdown ? 'chevron-up' : 'chevron-down'}
                      size={14}
                      color="#64748B"
                    />
                  </TouchableOpacity>
                </View>

                {/* Inline Weight Unit Dropdown */}
                {showWeightUnitDropdown ? (
                  <View style={styles.unitDropdownMenu}>
                    {(['kg', 'lb'] as const).map((u) => {
                      const isSelected = weightUnit === u;
                      return (
                        <TouchableOpacity
                          key={u}
                          style={[
                            styles.unitDropdownItem,
                            isSelected && styles.unitDropdownItemSelected,
                          ]}
                          onPress={() => handleSelectWeightUnit(u)}
                          activeOpacity={0.7}
                        >
                          <Text
                            style={[
                              styles.unitDropdownText,
                              isSelected && styles.unitDropdownTextSelected,
                            ]}
                          >
                            {u === 'kg' ? 'Kilograms (kg)' : 'Pounds (lb)'}
                          </Text>
                          {isSelected ? (
                            <Ionicons name="checkmark" size={16} color="#0788F5" />
                          ) : null}
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                ) : null}

                {errors.weight ? <Text style={styles.errorText}>{errors.weight}</Text> : null}
              </View>
            </View>

            {/* Bottom Action Section: Get Started Button & Privacy Note */}
            <View style={styles.actionSection}>
              <TouchableOpacity
                style={styles.getStartedButton}
                onPress={handleGetStarted}
                disabled={isSubmitting}
                activeOpacity={0.85}
                accessibilityRole="button"
                accessibilityLabel="Get Started, complete setup"
              >
                {isSubmitting ? (
                  <ActivityIndicator color="#FFFFFF" size="small" />
                ) : (
                  <View style={styles.buttonInner}>
                    <Text style={styles.getStartedButtonText}>Get Started</Text>
                    <Feather
                      name="arrow-right"
                      size={18}
                      color="#FFFFFF"
                      style={styles.arrowIcon}
                    />
                  </View>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>

      {/* Gender Selection Modal */}
      <Modal
        visible={genderModalVisible}
        transparent
        animationType="fade"
        statusBarTranslucent
        onRequestClose={() => setGenderModalVisible(false)}
      >
        <TouchableOpacity
          style={styles.modalOverlay}
          activeOpacity={1}
          onPress={() => setGenderModalVisible(false)}
        >
          <View style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Select Gender</Text>
              <TouchableOpacity
                onPress={() => setGenderModalVisible(false)}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                <Ionicons name="close" size={22} color="#64748B" />
              </TouchableOpacity>
            </View>

            {GENDER_OPTIONS.map((item) => {
              const isSelected = gender === item.value;
              return (
                <TouchableOpacity
                  key={item.value}
                  style={[styles.genderOptionRow, isSelected && styles.genderOptionRowSelected]}
                  onPress={() => {
                    setGender(item.value);
                    setOnboardingDraft({ gender: item.value });
                    setGenderModalVisible(false);
                  }}
                  activeOpacity={0.7}
                >
                  <Text
                    style={[styles.genderOptionText, isSelected && styles.genderOptionTextSelected]}
                  >
                    {item.label}
                  </Text>
                  {isSelected && <Ionicons name="checkmark" size={20} color="#0788F5" />}
                </TouchableOpacity>
              );
            })}
          </View>
        </TouchableOpacity>
      </Modal>
    </AppScreen>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F8F9FD',
  },
  keyboardView: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 24,
    paddingTop: Spacing.xs,
    paddingBottom: 160,
  },
  topNavRow: {
    paddingVertical: 4,
    marginBottom: 4,
  },
  backButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'flex-start',
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    marginBottom: 20,
  },
  headerTextGroup: {
    flex: 1,
    paddingRight: 10,
  },
  stepIndicator: {
    fontSize: 12,
    fontWeight: '700',
    color: '#0788F5',
    letterSpacing: 0.6,
    marginBottom: 6,
  },
  screenTitle: {
    fontSize: 27,
    fontWeight: '800',
    color: '#0F172A',
    letterSpacing: -0.4,
    lineHeight: 32,
    marginBottom: 6,
  },
  screenSubtitle: {
    fontSize: 14,
    lineHeight: 20,
    color: '#64748B',
    fontWeight: '400',
  },
  clipboardImage: {
    width: 78,
    height: 78,
    borderRadius: 16,
    marginTop: 2,
  },
  formCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 22,
    paddingHorizontal: 16,
    paddingTop: 18,
    paddingBottom: 20,
    borderWidth: 1,
    borderColor: '#ECECF2',
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.05,
    shadowRadius: 14,
    elevation: 3,
    marginBottom: 22,
  },
  fieldGroup: {
    marginBottom: 14,
  },
  rowTwoCols: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  fieldLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: '#334155',
    marginBottom: 6,
  },
  requiredStar: {
    color: '#EF4444',
  },
  inputContainer: {
    height: 48,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 12,
    paddingHorizontal: 12,
  },
  inputErrorBorder: {
    borderColor: '#EF4444',
  },
  fieldIcon: {
    marginRight: 8,
  },
  textInput: {
    flex: 1,
    height: '100%',
    fontSize: 14,
    color: '#0F172A',
    paddingVertical: 0,
  },
  selectText: {
    flex: 1,
    fontSize: 14,
    color: '#0F172A',
  },
  selectPlaceholderText: {
    color: '#94A3B8',
  },
  chevronIcon: {
    marginLeft: 6,
  },
  unitBadgeButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F1F5F9',
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderRadius: Radius.pill,
    gap: 2,
  },
  unitBadgeText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#334155',
  },
  unitDropdownMenu: {
    marginTop: 6,
    backgroundColor: '#FFFFFF',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    paddingVertical: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 6,
    elevation: 3,
  },
  unitDropdownItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 10,
    paddingHorizontal: 14,
  },
  unitDropdownItemSelected: {
    backgroundColor: '#F0F7FF',
  },
  unitDropdownText: {
    fontSize: 13,
    color: '#334155',
    fontWeight: '500',
  },
  unitDropdownTextSelected: {
    color: '#0788F5',
    fontWeight: '700',
  },
  errorText: {
    fontSize: 12,
    color: '#EF4444',
    marginTop: 4,
    marginLeft: 2,
  },
  actionSection: {
    alignItems: 'center',
  },
  getStartedButton: {
    width: '100%',
    height: 54,
    borderRadius: Radius.pill,
    backgroundColor: '#0788F5',
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#0788F5',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 8,
    elevation: 4,
  },
  buttonInner: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  getStartedButtonText: {
    fontSize: 17,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  arrowIcon: {
    marginLeft: 8,
  },
  privacyNote: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'center',
    marginTop: 16,
    paddingHorizontal: 8,
  },
  privacyLock: {
    marginRight: 6,
    marginTop: 2,
  },
  privacyText: {
    fontSize: 12,
    color: '#64748B',
    lineHeight: 18,
    textAlign: 'center',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.60)',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: Spacing.lg,
  },
  modalCard: {
    width: '100%',
    maxWidth: 420,
    backgroundColor: '#FFFFFF',
    borderRadius: Radius.card,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    padding: Spacing.xl,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.18,
    shadowRadius: 24,
    elevation: 12,
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 16,
    paddingBottom: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
  },
  modalTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: '#0F172A',
  },
  genderOptionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 13,
    paddingHorizontal: 12,
    borderRadius: 10,
    marginBottom: 4,
  },
  genderOptionRowSelected: {
    backgroundColor: '#EFF6FF',
  },
  genderOptionText: {
    fontSize: 15,
    color: '#334155',
    fontWeight: '500',
  },
  genderOptionTextSelected: {
    color: '#0788F5',
    fontWeight: '700',
  },
});
