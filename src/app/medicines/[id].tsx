import React, { useState, useEffect, useCallback } from 'react';
import { StyleSheet, View, Text, TouchableOpacity, ActivityIndicator } from 'react-native';
import { AppAlert as Alert } from '../../services/appAlert';
import { useLocalSearchParams, useRouter, useFocusEffect } from 'expo-router';
import { Ionicons, Feather, MaterialCommunityIcons } from '@expo/vector-icons';
import { Colors } from '../../theme/colors';
import { Radius, Spacing, Typography } from '../../theme/tokens';
import { ReminderSchedule } from '../../types';
import { formatTime12Hour } from '../../utils/reminderValidation';
import { AppScreen } from '../../components/ui/AppScreen';
import { AppHeader } from '../../components/ui/AppHeader';
import { AppCard } from '../../components/ui/AppCard';
import { AppButton } from '../../components/ui/AppButton';
import { MedicineIcon } from '../../components/ui/MedicineIcon';
import { SectionHeader } from '../../components/ui/SectionHeader';
import { MedicalDisclaimer } from '../../components/ui/MedicalDisclaimer';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
import { medicineRepository } from '../../database/repositories/medicineRepository';
import { scheduleRepository } from '../../database/repositories/scheduleRepository';
import { profileRepository } from '../../database/repositories/profileRepository';
import { isLowStock } from '../../services/refillService';
import { useMedicineStore } from '../../store/medicineStore';
import { aiAssistantService, MedicineEducationalInfo } from '../../services/aiAssistantService';
import { networkService } from '../../services/networkService';
import { ConnectGeminiModal } from '../../components/ai/ConnectGeminiModal';

export default function MedicineDetailsScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { deleteMedicine } = useMedicineStore();

  const [expandedSection, setExpandedSection] = useState<string | null>(null);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [eduInfo, setEduInfo] = useState<MedicineEducationalInfo | null>(null);
  const [isLoadingEdu, setIsLoadingEdu] = useState(false);
  const [showConnectModal, setShowConnectModal] = useState(false);

  const storeMedicine = useMedicineStore((s) => s.medicines.find((m) => m.id === id));
  const medicine = storeMedicine || medicineRepository.getById(id || '');
  const [schedules, setSchedules] = useState<ReminderSchedule[]>(() =>
    id ? scheduleRepository.getAllByMedicineId(id) : [],
  );

  useFocusEffect(
    useCallback(() => {
      if (id) {
        setSchedules(scheduleRepository.getAllByMedicineId(id));
      }
    }, [id]),
  );

  useEffect(() => {
    if (!medicine?.id) return;
    const cached = profileRepository.getPreference(`edu_info_${medicine.id}`);
    if (cached) {
      try {
        const parsed = JSON.parse(cached) as MedicineEducationalInfo;
        setEduInfo(parsed);
      } catch {
        setEduInfo(null);
      }
    } else {
      setEduInfo(null);
    }
  }, [medicine?.id]);

  const handleFetchEducationalInfo = async (forceRefresh = false) => {
    if (!medicine) return;
    let key: string | null = null;
    try {
      key = await aiAssistantService.getApiKey();
    } catch {
      key = null;
    }
    if (!key) {
      setShowConnectModal(true);
      return;
    }
    const isOnline = await networkService.checkInternet().catch(() => false);
    if (!isOnline) {
      Alert.alert(
        'Internet Connection Required',
        'Please connect to the internet to fetch educational information with Gemini AI.',
      );
      return;
    }

    setIsLoadingEdu(true);
    try {
      const info = await aiAssistantService.fetchMedicineEducationalInfo(
        medicine.name,
        medicine.ingredient,
        medicine.dosageForm,
      );
      profileRepository.updatePreference(`edu_info_${medicine.id}`, JSON.stringify(info));
      setEduInfo(info);
    } catch (err: any) {
      console.warn('Failed to generate educational info:', err);
      const isBadKey = err?.code === 'BAD_KEY' || err?.message?.includes('rejected');
      if (isBadKey) {
        Alert.alert(
          'Gemini key issue',
          'Your Gemini API key was rejected or invalid. Please reconnect a valid key.',
          [
            { text: 'Reconnect AI', onPress: () => setShowConnectModal(true) },
            { text: 'Cancel', style: 'cancel' },
          ],
        );
      } else {
        Alert.alert(
          'Could not generate AI guide',
          err?.message || 'Please check your network connection and try again.',
        );
      }
    } finally {
      setIsLoadingEdu(false);
    }
  };

  if (!medicine) {
    return (
      <AppScreen scrollable contentContainerStyle={styles.container}>
        <AppHeader title="Medicine Details" onBackPress={() => router.back()} />
        <View style={styles.notFoundContainer}>
          <Text style={styles.notFoundText}>Medicine not found.</Text>
          <AppButton
            title="Go back"
            onPress={() => router.back()}
            variant="outline"
            size="md"
            style={{ marginTop: 16 }}
          />
        </View>
      </AppScreen>
    );
  }

  const toggleExpand = (section: string) => {
    setExpandedSection(expandedSection === section ? null : section);
  };

  const handleMenuPress = () => {
    Alert.alert(medicine.name, 'Choose an action for this medication', [
      {
        text: 'Edit Medicine Details',
        onPress: () => router.push(`/medicines/add?editId=${medicine.id}`),
      },
      {
        text: 'Set / Edit Reminder',
        onPress: () => router.push(`/reminders/create?medicineId=${medicine.id}`),
      },
      {
        text: 'Delete Medicine',
        style: 'destructive',
        onPress: () => setShowDeleteModal(true),
      },
      {
        text: 'Cancel',
        style: 'cancel',
      },
    ]);
  };

  const confirmDelete = async () => {
    try {
      const deleted = await deleteMedicine(medicine.id);
      if (!deleted) {
        Alert.alert('Could not delete medicine', 'This medicine may already have been removed.');
        return;
      }
      setShowDeleteModal(false);
      router.back();
    } catch (error) {
      console.error('Could not delete medicine:', error);
      Alert.alert(
        'Could not delete medicine',
        'Please try again. Your record has not been confirmed as deleted.',
      );
    }
  };

  const formatSingleScheduleTitle = (s: ReminderSchedule): string => {
    const timesStr = s.times.map((t) => formatTime12Hour(t.time)).join(', ');
    let recurrenceStr = '';
    if (s.recurrence === 'daily') {
      recurrenceStr = 'Every Day';
    } else if (s.recurrence === 'weekly') {
      recurrenceStr = 'Every Week';
    } else if (s.recurrence === 'monthly') {
      recurrenceStr = 'Every Month';
    } else if (s.recurrence === 'custom') {
      const days =
        s.daysOfWeek && s.daysOfWeek.length > 0
          ? s.daysOfWeek.map((d) => ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d]).join(', ')
          : 'Custom';
      recurrenceStr = `Custom (${days})`;
    } else if (s.recurrence === 'once') {
      recurrenceStr = 'Once';
    } else {
      recurrenceStr = String(s.recurrence);
    }
    return `${timesStr} · ${recurrenceStr}`;
  };

  return (
    <AppScreen scrollable contentContainerStyle={styles.scrollContent}>
      {/* Header */}
      <AppHeader
        title="Medicine Details"
        brandText="HealthMate AI"
        onBackPress={() => router.back()}
        onMenuPress={handleMenuPress}
      />

      <View style={styles.body}>
        {/* Card 1: Medicine Hero Summary */}
        <AppCard style={styles.heroCard}>
          <View style={styles.heroTopRow}>
            <MedicineIcon form={medicine.dosageForm} name={medicine.name} size={52} />
            <View style={styles.heroInfo}>
              <View style={styles.heroNameRow}>
                <Text style={styles.heroName}>{medicine.name}</Text>
                <TouchableOpacity
                  style={styles.editBadgeButton}
                  onPress={() => router.push(`/medicines/add?editId=${medicine.id}`)}
                  accessibilityRole="button"
                  accessibilityLabel="Edit medicine details"
                  activeOpacity={0.7}
                >
                  <Feather name="edit-2" size={13} color={Colors.primary} />
                  <Text style={styles.editBadgeButtonText}>Edit</Text>
                </TouchableOpacity>
              </View>
              <Text style={styles.heroSub}>
                {medicine.strength} ·{' '}
                {medicine.dosageForm.charAt(0).toUpperCase() + medicine.dosageForm.slice(1)}s ·{' '}
                {medicine.category}
              </Text>
            </View>
          </View>

          <View style={styles.exampleTag}>
            <Text style={styles.exampleTagText}>
              {medicine.isSample
                ? 'Fictional demonstration data · Not real medication data'
                : medicine.packageDetails.originalPackageChecked
                  ? 'Marked as reviewed by you · Not independently verified'
                  : medicine.informationSource?.toLowerCase().includes('scan')
                    ? 'OCR-extracted draft · Verify every field against the package'
                    : 'User-entered details · Not independently verified'}
            </Text>
          </View>

          <Text style={styles.addedDateText}>
            Added{' '}
            {Number.isNaN(Date.parse(medicine.createdAt))
              ? 'date unavailable'
              : new Date(medicine.createdAt).toLocaleDateString()}{' '}
            · HealthMate has not clinically verified this record
          </Text>
        </AppCard>

        {/* Warning Banner: Your prescription comes first */}
        <View style={styles.warningBanner}>
          <View style={styles.warningHeader}>
            <Ionicons name="warning-outline" size={18} color="#D97706" />
            <Text style={styles.warningTitle}>Your prescription comes first</Text>
          </View>
          <Text style={styles.warningBody}>
            Only your healthcare professional or prescription label can confirm why this medicine
            was prescribed for you and the dose you should take. Do not change medication based on
            this app.
          </Text>
        </View>

        {/* Section: From your package */}
        <SectionHeader title="From your package" />
        <AppCard style={styles.packageCard}>
          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>Medicine name</Text>
            <Text style={styles.infoValue}>{medicine.name}</Text>
          </View>

          <View style={styles.rowDivider} />

          {medicine.ingredient ? (
            <>
              <View style={styles.infoRow}>
                <Text style={styles.infoLabel}>Active composition (Salt)</Text>
                <Text style={[styles.infoValue, styles.compositionHighlight]}>
                  {medicine.ingredient}
                </Text>
              </View>
              <View style={styles.rowDivider} />
            </>
          ) : null}

          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>Strength</Text>
            <Text style={styles.infoValue}>{medicine.strength}</Text>
          </View>

          <View style={styles.rowDivider} />

          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>Form</Text>
            <Text style={styles.infoValue}>
              {medicine.dosageForm.charAt(0).toUpperCase() + medicine.dosageForm.slice(1)}
            </Text>
          </View>

          <View style={styles.rowDivider} />

          {medicine.currentInventory != null ? (
            <>
              <View style={styles.infoRow}>
                <Text style={styles.infoLabel}>
                  Stock remaining{medicine.unitDosage ? ` (${medicine.unitDosage})` : ''}
                </Text>
                <Text style={[styles.infoValue, isLowStock(medicine) && styles.lowStockValue]}>
                  {medicine.currentInventory}
                  {medicine.refillThreshold != null
                    ? ` · refill at ${medicine.refillThreshold}`
                    : ''}
                </Text>
              </View>
              {isLowStock(medicine) ? (
                <View style={styles.stockWarningRow}>
                  <Ionicons name="alert-circle" size={16} color={Colors.warningDark} />
                  <Text style={styles.stockWarningText}>
                    Stock is at or below the refill threshold. Enter the correct count after each
                    refill in the Edit screen.
                  </Text>
                </View>
              ) : null}
              <View style={styles.rowDivider} />
            </>
          ) : null}

          <TouchableOpacity
            style={styles.originalPackageRow}
            onPress={() => router.push('/(tabs)/scan')}
            activeOpacity={0.7}
          >
            <Ionicons name="scan-outline" size={20} color={Colors.primary} />
            <View style={styles.originalPackageTextContainer}>
              <Text style={styles.originalPackageTitle}>Original package</Text>
              <Text style={styles.originalPackageSub}>Check all details against your label</Text>
            </View>
            <Ionicons name="chevron-forward" size={16} color={Colors.textTertiary} />
          </TouchableOpacity>
        </AppCard>

        {/* Section: General educational information */}
        <SectionHeader
          title="General educational information"
          actionText={eduInfo ? 'Refresh' : undefined}
          onActionPress={eduInfo ? () => handleFetchEducationalInfo(true) : undefined}
        />
        <AppCard style={styles.educationCard}>
          {eduInfo ? (
            <View style={styles.aiBadgeBanner}>
              <View style={styles.aiBadgeLeft}>
                <MaterialCommunityIcons name="molecule" size={16} color={Colors.primary} />
                <Text style={styles.aiBadgeText} numberOfLines={1}>
                  AI Guide · {eduInfo.activeSaltUsed || medicine.ingredient || medicine.name}
                </Text>
              </View>
              <TouchableOpacity
                onPress={() => handleFetchEducationalInfo(true)}
                disabled={isLoadingEdu}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                {isLoadingEdu ? (
                  <ActivityIndicator size="small" color={Colors.primary} />
                ) : (
                  <Feather name="refresh-cw" size={13} color={Colors.textSecondary} />
                )}
              </TouchableOpacity>
            </View>
          ) : null}

          {isLoadingEdu ? (
            <View style={styles.loadingEduContainer}>
              <ActivityIndicator size="large" color={Colors.primary} />
              <Text style={styles.loadingEduTitle}>Analyzing Active Composition…</Text>
              <Text style={styles.loadingEduSub}>
                Gemini AI is examining {medicine.ingredient || medicine.name} to compile educational
                insights.
              </Text>
            </View>
          ) : eduInfo ? (
            <>
              <Text style={styles.eduQuestion}>What is it used for?</Text>
              <Text style={styles.eduBody}>{eduInfo.summary}</Text>

              {/* Action pills: Explain simply / Why prescribed? */}
              <View style={styles.pillActionRow}>
                <TouchableOpacity
                  style={styles.explainButton}
                  onPress={() =>
                    router.push({
                      pathname: '/ai-assistant',
                      params: {
                        query: `Explain ${medicine.name}${medicine.ingredient ? ` (${medicine.ingredient})` : ''} simply`,
                      },
                    })
                  }
                  activeOpacity={0.7}
                >
                  <Text style={styles.explainButtonText}>Explain simply</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={styles.whyButton}
                  onPress={() =>
                    router.push({
                      pathname: '/ai-assistant',
                      params: {
                        query: `Why is ${medicine.name}${medicine.ingredient ? ` (${medicine.ingredient})` : ''} prescribed?`,
                      },
                    })
                  }
                  activeOpacity={0.7}
                >
                  <Text style={styles.whyButtonText}>Why prescribed?</Text>
                </TouchableOpacity>
              </View>

              {/* Expandable Educational Accordion Items */}
              <View style={styles.accordionContainer}>
                {/* How does it work? */}
                <TouchableOpacity style={styles.accordionRow} onPress={() => toggleExpand('how')}>
                  <Text style={styles.accordionTitle}>How does it work?</Text>
                  <Ionicons
                    name={expandedSection === 'how' ? 'chevron-up' : 'chevron-forward'}
                    size={16}
                    color={Colors.textTertiary}
                  />
                </TouchableOpacity>
                {expandedSection === 'how' ? (
                  <Text style={styles.accordionBody}>{eduInfo.mechanism}</Text>
                ) : null}

                <View style={styles.rowDivider} />

                {/* Common uses */}
                <TouchableOpacity style={styles.accordionRow} onPress={() => toggleExpand('uses')}>
                  <Text style={styles.accordionTitle}>Common uses</Text>
                  <Ionicons
                    name={expandedSection === 'uses' ? 'chevron-up' : 'chevron-forward'}
                    size={16}
                    color={Colors.textTertiary}
                  />
                </TouchableOpacity>
                {expandedSection === 'uses' ? (
                  <View style={styles.bulletList}>
                    {eduInfo.commonUses.map((item, idx) => (
                      <View key={idx} style={styles.bulletItem}>
                        <View style={styles.bulletDot} />
                        <Text style={styles.bulletText}>{item}</Text>
                      </View>
                    ))}
                  </View>
                ) : null}

                <View style={styles.rowDivider} />

                {/* Important safety information */}
                <TouchableOpacity
                  style={styles.accordionRow}
                  onPress={() => toggleExpand('safety')}
                >
                  <View style={styles.safetyRow}>
                    <Ionicons
                      name="shield-outline"
                      size={16}
                      color={Colors.primary}
                      style={{ marginRight: 6 }}
                    />
                    <Text style={styles.accordionTitle}>Important safety information</Text>
                  </View>
                  <Ionicons
                    name={expandedSection === 'safety' ? 'chevron-up' : 'chevron-forward'}
                    size={16}
                    color={Colors.textTertiary}
                  />
                </TouchableOpacity>
                {expandedSection === 'safety' ? (
                  <View style={styles.bulletList}>
                    {eduInfo.safetyAlerts.map((item, idx) => (
                      <View key={idx} style={styles.bulletItem}>
                        <Ionicons
                          name="alert-circle-outline"
                          size={14}
                          color={Colors.warningDark}
                          style={{ marginTop: 2, marginRight: 6 }}
                        />
                        <Text style={styles.bulletText}>{item}</Text>
                      </View>
                    ))}
                  </View>
                ) : null}

                <View style={styles.rowDivider} />

                {/* Common side effects */}
                <TouchableOpacity
                  style={styles.accordionRow}
                  onPress={() => toggleExpand('effects')}
                >
                  <Text style={styles.accordionTitle}>Common side effects</Text>
                  <Ionicons
                    name={expandedSection === 'effects' ? 'chevron-up' : 'chevron-forward'}
                    size={16}
                    color={Colors.textTertiary}
                  />
                </TouchableOpacity>
                {expandedSection === 'effects' ? (
                  <View style={styles.bulletList}>
                    {eduInfo.sideEffects.map((item, idx) => (
                      <View key={idx} style={styles.bulletItem}>
                        <View style={styles.bulletDot} />
                        <Text style={styles.bulletText}>{item}</Text>
                      </View>
                    ))}
                  </View>
                ) : null}
              </View>
            </>
          ) : (
            <>
              {/* Not generated yet: Prompt card + fallback */}
              <View style={styles.generateEduBox}>
                <View style={styles.generateEduHeader}>
                  <View style={styles.generateEduIconWrap}>
                    <Ionicons name="sparkles" size={18} color={Colors.primary} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.generateEduTitle}>Get AI Educational Insights</Text>
                    <Text style={styles.generateEduSubtitle}>
                      {medicine.ingredient
                        ? `Analyze active composition "${medicine.ingredient}" with Gemini AI for mechanism of action, typical uses, and safety.`
                        : `Analyze ${medicine.name} with Gemini AI for active composition, mechanism, and patient education.`}
                    </Text>
                  </View>
                </View>
                <TouchableOpacity
                  style={styles.generateEduButton}
                  onPress={() => handleFetchEducationalInfo()}
                  activeOpacity={0.8}
                >
                  <Ionicons name="sparkles" size={15} color="#FFFFFF" style={{ marginRight: 6 }} />
                  <Text style={styles.generateEduButtonText}>Generate with Gemini AI</Text>
                </TouchableOpacity>
              </View>

              <Text style={styles.eduQuestion}>What is it used for?</Text>
              <Text style={styles.eduBody}>
                No reviewed patient leaflet is linked to this record. Tap "Generate with Gemini AI"
                above or check the official package leaflet.
              </Text>

              {/* Action pills: Explain simply / Why prescribed? */}
              <View style={styles.pillActionRow}>
                <TouchableOpacity
                  style={styles.explainButton}
                  onPress={() =>
                    router.push({
                      pathname: '/ai-assistant',
                      params: {
                        query: `Explain ${medicine.name}${medicine.ingredient ? ` (${medicine.ingredient})` : ''} simply`,
                      },
                    })
                  }
                  activeOpacity={0.7}
                >
                  <Text style={styles.explainButtonText}>Explain simply</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={styles.whyButton}
                  onPress={() =>
                    router.push({
                      pathname: '/ai-assistant',
                      params: {
                        query: `Why is ${medicine.name}${medicine.ingredient ? ` (${medicine.ingredient})` : ''} prescribed?`,
                      },
                    })
                  }
                  activeOpacity={0.7}
                >
                  <Text style={styles.whyButtonText}>Why prescribed?</Text>
                </TouchableOpacity>
              </View>

              {/* Expandable Educational Accordion Items */}
              <View style={styles.accordionContainer}>
                {/* How does it work? */}
                <TouchableOpacity style={styles.accordionRow} onPress={() => toggleExpand('how')}>
                  <Text style={styles.accordionTitle}>How does it work?</Text>
                  <Ionicons
                    name={expandedSection === 'how' ? 'chevron-up' : 'chevron-forward'}
                    size={16}
                    color={Colors.textTertiary}
                  />
                </TouchableOpacity>
                {expandedSection === 'how' ? (
                  <Text style={styles.accordionBody}>
                    No medicine-specific mechanism information has been verified for this record.
                    Tap "Generate with Gemini AI" above or check the official leaflet.
                  </Text>
                ) : null}

                <View style={styles.rowDivider} />

                {/* Common uses */}
                <TouchableOpacity style={styles.accordionRow} onPress={() => toggleExpand('uses')}>
                  <Text style={styles.accordionTitle}>Common uses</Text>
                  <Ionicons
                    name={expandedSection === 'uses' ? 'chevron-up' : 'chevron-forward'}
                    size={16}
                    color={Colors.textTertiary}
                  />
                </TouchableOpacity>
                {expandedSection === 'uses' ? (
                  <Text style={styles.accordionBody}>
                    Uses depend on the active ingredient and formulation. Tap "Generate with Gemini
                    AI" to get active salt insights.
                  </Text>
                ) : null}

                <View style={styles.rowDivider} />

                {/* Important safety information */}
                <TouchableOpacity
                  style={styles.accordionRow}
                  onPress={() => toggleExpand('safety')}
                >
                  <View style={styles.safetyRow}>
                    <Ionicons
                      name="shield-outline"
                      size={16}
                      color={Colors.primary}
                      style={{ marginRight: 6 }}
                    />
                    <Text style={styles.accordionTitle}>Important safety information</Text>
                  </View>
                  <Ionicons
                    name={expandedSection === 'safety' ? 'chevron-up' : 'chevron-forward'}
                    size={16}
                    color={Colors.textTertiary}
                  />
                </TouchableOpacity>
                {expandedSection === 'safety' ? (
                  <Text style={styles.accordionBody}>
                    Storage and precautions vary by product. Follow instructions on original
                    packaging.
                  </Text>
                ) : null}

                <View style={styles.rowDivider} />

                {/* Common side effects */}
                <TouchableOpacity
                  style={styles.accordionRow}
                  onPress={() => toggleExpand('effects')}
                >
                  <Text style={styles.accordionTitle}>Common side effects</Text>
                  <Ionicons
                    name={expandedSection === 'effects' ? 'chevron-up' : 'chevron-forward'}
                    size={16}
                    color={Colors.textTertiary}
                  />
                </TouchableOpacity>
                {expandedSection === 'effects' ? (
                  <Text style={styles.accordionBody}>
                    No reviewed side-effect list linked to this record. Check the package insert or
                    consult a pharmacist.
                  </Text>
                ) : null}
              </View>
            </>
          )}
        </AppCard>

        {/* Section: Your schedule */}
        <SectionHeader
          title="Your schedule"
          count={schedules.length > 0 ? schedules.length : undefined}
          actionText="+ Add Reminder"
          onActionPress={() => router.push(`/reminders/create?medicineId=${medicine.id}`)}
        />
        <AppCard style={styles.scheduleCard}>
          {schedules.length === 0 ? (
            <>
              <Text style={styles.scheduleTitle}>No reminder schedule set</Text>
              <Text style={styles.scheduleNote}>Set up reminders so you never miss a dose</Text>

              <TouchableOpacity
                style={styles.setReminderButton}
                onPress={() => router.push(`/reminders/create?medicineId=${medicine.id}`)}
                activeOpacity={0.7}
              >
                <Text style={styles.setReminderButtonText}>Set Reminder</Text>
              </TouchableOpacity>
            </>
          ) : (
            <View style={styles.scheduleListContainer}>
              {schedules.map((s, idx) => (
                <TouchableOpacity
                  key={s.id || idx}
                  style={styles.scheduleDetailRow}
                  onPress={() =>
                    router.push(
                      `/reminders/create?medicineId=${medicine.id}&scheduleId=${s.id}`,
                    )
                  }
                  activeOpacity={0.7}
                >
                  <View style={styles.scheduleDetailBadge}>
                    <Feather
                      name={s.enabled ? 'bell' : 'bell-off'}
                      size={15}
                      color={s.enabled ? Colors.primary : Colors.textSecondary}
                    />
                  </View>
                  <View style={styles.scheduleDetailInfo}>
                    <Text style={styles.scheduleDetailTitle}>
                      {formatSingleScheduleTitle(s)}
                    </Text>
                    <Text style={styles.scheduleDetailNote}>
                      {s.times[0]?.amount
                        ? `${s.times[0].amount} · ${s.enabled ? 'Active' : 'Disabled'}`
                        : s.enabled
                          ? 'Active'
                          : 'Disabled'}
                    </Text>
                  </View>
                  <Feather name="chevron-right" size={16} color={Colors.textTertiary} />
                </TouchableOpacity>
              ))}

              <TouchableOpacity
                style={styles.setReminderButton}
                onPress={() => router.push(`/reminders/create?medicineId=${medicine.id}`)}
                activeOpacity={0.7}
              >
                <Text style={styles.setReminderButtonText}>+ Add Another Reminder</Text>
              </TouchableOpacity>
            </View>
          )}
        </AppCard>

        {/* Section: Package details */}
        <SectionHeader title="Package details" />
        <AppCard style={styles.packageDetailsCard}>
          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>Manufacturer</Text>
            <Text style={styles.infoValue}>
              {medicine.packageDetails.manufacturer ?? 'Fictional data'}
            </Text>
          </View>

          <View style={styles.rowDivider} />

          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>Expiry</Text>
            <Text style={styles.infoValue}>{medicine.packageDetails.expiryDate ?? 'N/A'}</Text>
          </View>

          <View style={styles.rowDivider} />

          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>Batch</Text>
            <Text style={styles.infoValue}>
              {medicine.packageDetails.batchNumber ?? 'DEMO-001'}
            </Text>
          </View>

          <View style={styles.rowDivider} />

          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>Package details</Text>
            <Text style={styles.infoValue}>
              {medicine.packageDetails.packageDetailsText ?? 'Example values, not a verified scan'}
            </Text>
          </View>
        </AppCard>

        {/* Section: Information Source */}
        <SectionHeader title="Information Source" />
        <AppCard style={styles.sourceCard}>
          <Text style={styles.sourceTitle}>Example package record entered for this design.</Text>
          <Text style={styles.sourceBody}>
            {medicine.informationSource ||
              'No verified clinical reference is attached. Educational sections are not a substitute for the package leaflet or professional advice.'}
          </Text>
        </AppCard>

        {/* Medical Disclaimer */}
        <MedicalDisclaimer />
      </View>

      {/* Delete Confirmation Modal */}
      <ConfirmDialog
        visible={showDeleteModal}
        title="Delete Medicine"
        message={`Are you sure you want to remove ${medicine.name} from your cabinet? Associated schedules will also be removed.`}
        confirmText="Delete"
        destructive
        onConfirm={confirmDelete}
        onCancel={() => setShowDeleteModal(false)}
      />

      <ConnectGeminiModal
        visible={showConnectModal}
        onClose={() => setShowConnectModal(false)}
        onKeySaved={() => {
          setShowConnectModal(false);
          handleFetchEducationalInfo();
        }}
      />
    </AppScreen>
  );
}

const styles = StyleSheet.create({
  scrollContent: {
    paddingBottom: 60,
  },
  container: {
    paddingBottom: 40,
  },
  body: {
    paddingHorizontal: Spacing.screenPaddingHorizontal,
  },
  notFoundContainer: {
    alignItems: 'center',
    padding: Spacing.xl,
  },
  notFoundText: {
    ...Typography.heading2,
    color: Colors.textPrimary,
  },
  heroCard: {
    marginBottom: Spacing.md,
  },
  heroTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  heroInfo: {
    marginLeft: Spacing.md,
    flex: 1,
  },
  heroNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  heroName: {
    fontSize: 22,
    fontWeight: '800',
    color: Colors.textPrimary,
    flex: 1,
    marginRight: 8,
  },
  editBadgeButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.primaryLight,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: Radius.pill,
  },
  editBadgeButtonText: {
    fontSize: 12,
    fontWeight: '600',
    color: Colors.primary,
    marginLeft: 4,
  },
  heroSub: {
    fontSize: 13,
    color: Colors.textSecondary,
    marginTop: 2,
  },
  exampleTag: {
    backgroundColor: '#FEF6E9',
    paddingVertical: 4,
    paddingHorizontal: 10,
    borderRadius: Radius.pill,
    alignSelf: 'flex-start',
    marginBottom: 8,
  },
  exampleTagText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#D97706',
  },
  addedDateText: {
    fontSize: 12,
    color: Colors.textTertiary,
  },
  warningBanner: {
    backgroundColor: '#FFF8EC',
    borderRadius: Radius.card,
    padding: Spacing.cardPadding,
    borderWidth: 1,
    borderColor: '#FDE4BC',
    marginBottom: Spacing.lg,
  },
  warningHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 6,
  },
  warningTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#B45309',
    marginLeft: 6,
  },
  warningBody: {
    fontSize: 12,
    lineHeight: 18,
    color: '#92400E',
  },
  packageCard: {
    marginBottom: Spacing.lg,
    paddingVertical: 6,
  },
  infoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 12,
  },
  infoLabel: {
    fontSize: 14,
    color: Colors.textPrimary,
    fontWeight: '500',
  },
  infoValue: {
    fontSize: 14,
    color: Colors.textSecondary,
    fontWeight: '400',
  },
  rowDivider: {
    height: 1,
    backgroundColor: Colors.borderLight,
  },
  lowStockValue: {
    color: Colors.error,
    fontWeight: '700',
  },
  stockWarningRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: Colors.warningLight,
    borderRadius: 10,
    padding: 10,
    marginTop: 8,
    gap: 6,
  },
  stockWarningText: {
    flex: 1,
    fontSize: 12,
    lineHeight: 17,
    color: Colors.warningDark,
    maxWidth: '92%',
  },
  originalPackageRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
  },
  originalPackageTextContainer: {
    flex: 1,
    marginLeft: 10,
  },
  originalPackageTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: Colors.textPrimary,
  },
  originalPackageSub: {
    fontSize: 12,
    color: Colors.textSecondary,
    marginTop: 1,
  },
  educationCard: {
    marginBottom: Spacing.lg,
  },
  eduQuestion: {
    fontSize: 16,
    fontWeight: '700',
    color: Colors.textPrimary,
    marginBottom: 6,
  },
  eduBody: {
    fontSize: 13,
    lineHeight: 19,
    color: Colors.textSecondary,
    marginBottom: 14,
  },
  pillActionRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 16,
  },
  explainButton: {
    backgroundColor: Colors.primary,
    paddingVertical: 7,
    paddingHorizontal: 14,
    borderRadius: Radius.pill,
  },
  explainButtonText: {
    fontSize: 13,
    fontWeight: '600',
    color: Colors.textInverse,
  },
  whyButton: {
    backgroundColor: '#EAE9EF',
    paddingVertical: 7,
    paddingHorizontal: 14,
    borderRadius: Radius.pill,
  },
  whyButtonText: {
    fontSize: 13,
    fontWeight: '600',
    color: Colors.textPrimary,
  },
  accordionContainer: {
    borderTopWidth: 1,
    borderTopColor: Colors.borderLight,
    paddingTop: 4,
  },
  accordionRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 12,
  },
  safetyRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  accordionTitle: {
    fontSize: 14,
    fontWeight: '500',
    color: Colors.textPrimary,
  },
  accordionBody: {
    fontSize: 13,
    lineHeight: 18,
    color: Colors.textSecondary,
    paddingBottom: 10,
  },
  scheduleCard: {
    marginBottom: Spacing.lg,
  },
  scheduleListContainer: {
    gap: 8,
  },
  scheduleDetailRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: Colors.borderLight,
    gap: 10,
  },
  scheduleDetailBadge: {
    width: 34,
    height: 34,
    borderRadius: Radius.md,
    backgroundColor: Colors.primaryLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  scheduleDetailInfo: {
    flex: 1,
  },
  scheduleDetailTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: Colors.textPrimary,
  },
  scheduleDetailNote: {
    fontSize: 12,
    color: Colors.textSecondary,
    marginTop: 2,
    fontWeight: '500',
  },
  scheduleTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: Colors.textPrimary,
  },
  scheduleNote: {
    fontSize: 12,
    color: Colors.textSecondary,
    marginTop: 4,
    marginBottom: 14,
  },
  setReminderButton: {
    backgroundColor: '#F0EFEF',
    borderRadius: Radius.pill,
    paddingVertical: 10,
    alignItems: 'center',
  },
  setReminderButtonText: {
    fontSize: 14,
    fontWeight: '600',
    color: Colors.textPrimary,
  },
  packageDetailsCard: {
    marginBottom: Spacing.lg,
    paddingVertical: 6,
  },
  sourceCard: {
    marginBottom: Spacing.lg,
  },
  sourceTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: Colors.textPrimary,
    marginBottom: 6,
  },
  sourceBody: {
    fontSize: 12,
    lineHeight: 18,
    color: Colors.textSecondary,
  },
  compositionHighlight: {
    color: Colors.primary,
    fontWeight: '700',
  },
  aiBadgeBanner: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#F0F4FF',
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderRadius: Radius.md,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: '#D9E4FF',
  },
  aiBadgeLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flex: 1,
    marginRight: 8,
  },
  aiBadgeText: {
    fontSize: 12,
    fontWeight: '700',
    color: Colors.primary,
    flexShrink: 1,
  },
  loadingEduContainer: {
    alignItems: 'center',
    paddingVertical: 24,
    gap: 8,
  },
  loadingEduTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: Colors.textPrimary,
    marginTop: 6,
  },
  loadingEduSub: {
    fontSize: 13,
    color: Colors.textSecondary,
    textAlign: 'center',
    maxWidth: 280,
    lineHeight: 18,
  },
  generateEduBox: {
    backgroundColor: '#F8FAFC',
    borderRadius: Radius.lg,
    padding: 14,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  generateEduHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    marginBottom: 12,
  },
  generateEduIconWrap: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#EEF2FF',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 2,
  },
  generateEduTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: Colors.textPrimary,
    marginBottom: 3,
  },
  generateEduSubtitle: {
    fontSize: 12,
    color: Colors.textSecondary,
    lineHeight: 17,
  },
  generateEduButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.primary,
    paddingVertical: 10,
    borderRadius: Radius.pill,
  },
  generateEduButtonText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  bulletList: {
    paddingBottom: 10,
    gap: 8,
  },
  bulletItem: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingRight: 8,
  },
  bulletDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: Colors.primary,
    marginTop: 6,
    marginRight: 8,
  },
  bulletText: {
    fontSize: 13,
    color: Colors.textSecondary,
    lineHeight: 18,
    flex: 1,
  },
});
