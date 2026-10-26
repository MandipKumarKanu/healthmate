import React, { useState, useEffect, useCallback } from "react";
import {
  StyleSheet,
  View,
  Text,
  TouchableOpacity,
  Modal,
  ScrollView,
  Platform,
  AppState,
  AppStateStatus,
  ActivityIndicator,
} from "react-native";
import { Ionicons, Feather, MaterialCommunityIcons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { Colors } from "../../theme/colors";
import { Radius, Spacing } from "../../theme/tokens";
import { AppCard } from "../ui/AppCard";
import {
  batteryOptimizationService,
  ReliabilityStatus,
  OEMGuide,
} from "../../services/batteryOptimizationService";

export function AlarmReliabilityCard() {
  const router = useRouter();
  const [status, setStatus] = useState<ReliabilityStatus | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [isGuideModalVisible, setIsGuideModalVisible] =
    useState<boolean>(false);
  const [selectedOemId, setSelectedOemId] = useState<string>("stock");

  const checkStatus = useCallback(async () => {
    try {
      const result = await batteryOptimizationService.getReliabilityStatus();
      setStatus(result);
      setSelectedOemId(result.detectedOemId);
    } catch (e) {
      console.warn("AlarmReliabilityCard checkStatus error:", e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    checkStatus();

    const handleAppStateChange = (nextState: AppStateStatus) => {
      if (nextState === "active") {
        checkStatus();
      }
    };

    const subscription = AppState.addEventListener(
      "change",
      handleAppStateChange,
    );
    return () => {
      subscription.remove();
    };
  }, [checkStatus]);

  const handleRequestBatteryIgnore = async () => {
    setActionLoading("battery");
    try {
      await batteryOptimizationService.requestIgnoreBatteryOptimizations();
      // Recheck after a slight delay to allow system prompt handling
      setTimeout(checkStatus, 1500);
    } finally {
      setActionLoading(null);
    }
  };

  const handleOpenExactAlarm = async () => {
    setActionLoading("exact");
    try {
      await batteryOptimizationService.openExactAlarmSettings();
      setTimeout(checkStatus, 1500);
    } finally {
      setActionLoading(null);
    }
  };

  const handleOpenOemSettings = async () => {
    setActionLoading("oem");
    try {
      await batteryOptimizationService.openOemAutoStartSettings();
    } finally {
      setActionLoading(null);
    }
  };

  const handleOpenAppBattery = async () => {
    setActionLoading("appBattery");
    try {
      await batteryOptimizationService.openAppBatterySettings();
    } finally {
      setActionLoading(null);
    }
  };

  const guides = batteryOptimizationService.getGuides();
  const currentGuide =
    guides.find((g) => g.id === selectedOemId) ||
    guides.find((g) => g.id === status?.detectedOemId) ||
    guides[0];

  const isAndroid = Platform.OS === "android";
  const isBatteryOptimal = status?.isIgnoringBatteryOptimizations ?? true;
  const isExactOptimal = status?.canScheduleExactAlarms ?? true;
  const isOverallOptimal = isBatteryOptimal && isExactOptimal;

  return (
    <View style={styles.container}>
      <AppCard style={styles.card}>
        {/* Header & Overall Status */}
        <View style={styles.headerRow}>
          <View style={styles.titleWithIcon}>
            <View
              style={[
                styles.iconBadge,
                {
                  backgroundColor: isOverallOptimal
                    ? Colors.successLight
                    : Colors.warningLight,
                },
              ]}
            >
              <MaterialCommunityIcons
                name={isOverallOptimal ? "shield-check" : "shield-alert"}
                size={22}
                color={
                  isOverallOptimal ? Colors.successDark : Colors.warningDark
                }
              />
            </View>
            <View style={styles.headerTexts}>
              <Text style={styles.title}>Optimize Alarm Reliability</Text>
              <Text style={styles.subtitle}>
                Keep alarms ringing on time during deep sleep
              </Text>
            </View>
          </View>

          <TouchableOpacity
            onPress={checkStatus}
            disabled={loading}
            style={styles.refreshButton}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            accessibilityLabel="Refresh alarm reliability status"
          >
            {loading ? (
              <ActivityIndicator size="small" color={Colors.primary} />
            ) : (
              <Feather
                name="refresh-cw"
                size={16}
                color={Colors.textSecondary}
              />
            )}
          </TouchableOpacity>
        </View>

        {/* Overall Status Banner */}
        <View
          style={[
            styles.banner,
            isOverallOptimal ? styles.bannerOptimal : styles.bannerWarning,
          ]}
        >
          <Ionicons
            name={isOverallOptimal ? "checkmark-circle" : "warning"}
            size={18}
            color={isOverallOptimal ? Colors.successDark : Colors.warningDark}
          />
          <Text
            style={[
              styles.bannerText,
              {
                color: isOverallOptimal
                  ? Colors.successDark
                  : Colors.warningDark,
              },
            ]}
          >
            {isOverallOptimal
              ? "Reliability status: Unrestricted & Optimal"
              : "Attention: Device battery restrictions may delay or kill alarms"}
          </Text>
        </View>

        {/* Detailed Status Items */}
        <View style={styles.statusList}>
          {/* Item 1: Battery Optimization */}
          <View style={styles.statusItem}>
            <View style={styles.itemHeaderRow}>
              <View style={styles.itemLabelGroup}>
                <Ionicons
                  name="battery-charging-outline"
                  size={18}
                  color={isBatteryOptimal ? Colors.success : Colors.warning}
                />
                <Text style={styles.itemTitle}>Battery Optimization</Text>
              </View>
              <View
                style={[
                  styles.statusPill,
                  isBatteryOptimal ? styles.pillOptimal : styles.pillRestricted,
                ]}
              >
                <Text
                  style={[
                    styles.statusPillText,
                    isBatteryOptimal
                      ? styles.pillOptimalText
                      : styles.pillRestrictedText,
                  ]}
                >
                  {isBatteryOptimal ? "Unrestricted" : "Restricted"}
                </Text>
              </View>
            </View>

            <Text style={styles.itemDescription}>
              {isBatteryOptimal
                ? "HealthMate is exempt from Android Doze and sleep restrictions."
                : "Aggressive battery savers can sleep background alarm triggers when locked."}
            </Text>

            {!isBatteryOptimal && isAndroid && (
              <TouchableOpacity
                style={styles.actionButton}
                onPress={handleRequestBatteryIgnore}
                disabled={actionLoading === "battery"}
              >
                {actionLoading === "battery" ? (
                  <ActivityIndicator size="small" color={Colors.textInverse} />
                ) : (
                  <>
                    <Feather name="zap" size={14} color={Colors.textInverse} />
                    <Text style={styles.actionButtonText}>
                      Disable Battery Restrictions
                    </Text>
                  </>
                )}
              </TouchableOpacity>
            )}
          </View>

          <View style={styles.divider} />

          {/* Item 2: Exact Alarm Permission */}
          <View style={styles.statusItem}>
            <View style={styles.itemHeaderRow}>
              <View style={styles.itemLabelGroup}>
                <Feather
                  name="clock"
                  size={18}
                  color={isExactOptimal ? Colors.success : Colors.warning}
                />
                <Text style={styles.itemTitle}>Exact Alarm Triggering</Text>
              </View>
              <View
                style={[
                  styles.statusPill,
                  isExactOptimal ? styles.pillOptimal : styles.pillRestricted,
                ]}
              >
                <Text
                  style={[
                    styles.statusPillText,
                    isExactOptimal
                      ? styles.pillOptimalText
                      : styles.pillRestrictedText,
                  ]}
                >
                  {isExactOptimal ? "Granted" : "Limited"}
                </Text>
              </View>
            </View>

            <Text style={styles.itemDescription}>
              {isExactOptimal
                ? "Exact alarm hardware triggers are enabled for zero-latency reminders."
                : "Android requires permission to wake the screen for critical medications."}
            </Text>

            {!isExactOptimal && isAndroid && (
              <TouchableOpacity
                style={[styles.actionButton, styles.actionButtonSecondary]}
                onPress={handleOpenExactAlarm}
                disabled={actionLoading === "exact"}
              >
                {actionLoading === "exact" ? (
                  <ActivityIndicator size="small" color={Colors.primary} />
                ) : (
                  <>
                    <Ionicons
                      name="settings-outline"
                      size={14}
                      color={Colors.primary}
                    />
                    <Text
                      style={[
                        styles.actionButtonText,
                        styles.actionButtonTextSecondary,
                      ]}
                    >
                      Enable Exact Alarms
                    </Text>
                  </>
                )}
              </TouchableOpacity>
            )}
          </View>
        </View>

        {/* OEM Assistant Button */}
        {isAndroid && (
          <TouchableOpacity
            style={styles.guideButton}
            onPress={() => router.push("/settings/battery-optimization" as any)}
          >
            <View style={styles.guideButtonContent}>
              <MaterialCommunityIcons
                name="cellphone-cog"
                size={20}
                color={Colors.primary}
              />
              <View style={{ flex: 1 }}>
                <Text style={styles.guideButtonTitle}>
                  OEM Process Killer Assistant
                </Text>
                <Text style={styles.guideButtonSubtitle}>
                  {status?.manufacturer
                    ? `Detected: ${status.manufacturer.toUpperCase()} • View step-by-step fix`
                    : "Configure Samsung, Xiaomi, Huawei, Oppo settings"}
                </Text>
              </View>
              <Ionicons
                name="chevron-forward"
                size={18}
                color={Colors.textTertiary}
              />
            </View>
          </TouchableOpacity>
        )}
      </AppCard>

      {/* OEM Assistant Guide Modal */}
      <Modal visible={isGuideModalVisible} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            {/* Modal Header */}
            <View style={styles.modalHeader}>
              <View>
                <Text style={styles.modalTitle}>Phone Manufacturer Guide</Text>
                <Text style={styles.modalSubtitle}>
                  Keep alarms persistent across OEM custom ROMs
                </Text>
              </View>
              <TouchableOpacity
                style={styles.closeButton}
                onPress={() => setIsGuideModalVisible(false)}
              >
                <Ionicons name="close" size={20} color={Colors.textSecondary} />
              </TouchableOpacity>
            </View>

            {/* OEM Brand Tabs */}
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              style={styles.tabsScroll}
              contentContainerStyle={styles.tabsContainer}
            >
              {guides.map((g) => {
                const isSelected = g.id === selectedOemId;
                const isDetected = g.id === status?.detectedOemId;
                return (
                  <TouchableOpacity
                    key={g.id}
                    style={[
                      styles.tabPill,
                      isSelected && styles.tabPillSelected,
                    ]}
                    onPress={() => setSelectedOemId(g.id)}
                  >
                    <Text
                      style={[
                        styles.tabPillText,
                        isSelected && styles.tabPillTextSelected,
                      ]}
                    >
                      {g.name}
                      {isDetected ? " ★" : ""}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>

            {/* Guide Content */}
            <ScrollView
              style={styles.guideScroll}
              showsVerticalScrollIndicator={false}
            >
              <View style={styles.guideInfoBanner}>
                <View
                  style={[
                    styles.guideBrandDot,
                    { backgroundColor: currentGuide.badgeColor },
                  ]}
                />
                <View style={{ flex: 1 }}>
                  <Text style={styles.guideBrandName}>
                    {currentGuide.name} ({currentGuide.subname})
                  </Text>
                  <Text style={styles.guideBrandDescription}>
                    {currentGuide.description}
                  </Text>
                </View>
              </View>

              <Text style={styles.stepsHeading}>
                Recommended Configuration:
              </Text>

              {currentGuide.steps.map((s, index) => (
                <View key={index} style={styles.stepCard}>
                  <View style={styles.stepNumberBadge}>
                    <Text style={styles.stepNumberText}>{index + 1}</Text>
                  </View>
                  <View style={styles.stepTexts}>
                    <Text style={styles.stepTitle}>{s.title}</Text>
                    <Text style={styles.stepDesc}>{s.description}</Text>
                  </View>
                </View>
              ))}

              <View style={styles.quickLaunchSection}>
                <Text style={styles.quickLaunchTitle}>
                  Quick Settings Shortcuts:
                </Text>
                <View style={styles.quickLaunchButtons}>
                  <TouchableOpacity
                    style={styles.quickButton}
                    onPress={handleOpenOemSettings}
                    disabled={actionLoading === "oem"}
                  >
                    {actionLoading === "oem" ? (
                      <ActivityIndicator size="small" color={Colors.primary} />
                    ) : (
                      <>
                        <MaterialCommunityIcons
                          name="auto-fix"
                          size={16}
                          color={Colors.primary}
                        />
                        <Text style={styles.quickButtonText}>
                          Open Auto-Start
                        </Text>
                      </>
                    )}
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={styles.quickButton}
                    onPress={handleOpenAppBattery}
                    disabled={actionLoading === "appBattery"}
                  >
                    {actionLoading === "appBattery" ? (
                      <ActivityIndicator size="small" color={Colors.primary} />
                    ) : (
                      <>
                        <Ionicons
                          name="battery-charging-outline"
                          size={16}
                          color={Colors.primary}
                        />
                        <Text style={styles.quickButtonText}>
                          App Battery Info
                        </Text>
                      </>
                    )}
                  </TouchableOpacity>
                </View>
              </View>
            </ScrollView>

            {/* Modal Bottom Actions */}
            <View style={styles.modalFooter}>
              <TouchableOpacity
                style={styles.doneButton}
                onPress={() => {
                  setIsGuideModalVisible(false);
                  checkStatus();
                }}
              >
                <Text style={styles.doneButtonText}>Done & Check Status</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginVertical: Spacing.sm,
  },
  card: {
    padding: Spacing.cardPadding,
    backgroundColor: Colors.cardBackground,
    borderRadius: Radius.card,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: Spacing.md,
  },
  titleWithIcon: {
    flexDirection: "row",
    alignItems: "center",
    flex: 1,
    gap: Spacing.md,
  },
  iconBadge: {
    width: 42,
    height: 42,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  headerTexts: {
    flex: 1,
  },
  title: {
    fontSize: 16,
    fontWeight: "700",
    color: Colors.textPrimary,
  },
  subtitle: {
    fontSize: 12,
    color: Colors.textSecondary,
    marginTop: 2,
  },
  refreshButton: {
    padding: Spacing.xs,
  },
  banner: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderRadius: Radius.md,
    marginBottom: Spacing.md,
  },
  bannerOptimal: {
    backgroundColor: Colors.successLight,
  },
  bannerWarning: {
    backgroundColor: Colors.warningLight,
  },
  bannerText: {
    fontSize: 12,
    fontWeight: "600",
    flex: 1,
  },
  statusList: {
    gap: Spacing.sm,
  },
  statusItem: {
    paddingVertical: Spacing.xs,
  },
  itemHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 4,
  },
  itemLabelGroup: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.xs,
  },
  itemTitle: {
    fontSize: 14,
    fontWeight: "600",
    color: Colors.textPrimary,
  },
  statusPill: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: Radius.pill,
  },
  pillOptimal: {
    backgroundColor: Colors.successLight,
  },
  pillRestricted: {
    backgroundColor: Colors.warningLight,
  },
  statusPillText: {
    fontSize: 11,
    fontWeight: "700",
  },
  pillOptimalText: {
    color: Colors.successDark,
  },
  pillRestrictedText: {
    color: Colors.warningDark,
  },
  itemDescription: {
    fontSize: 12,
    color: Colors.textSecondary,
    lineHeight: 17,
  },
  actionButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    backgroundColor: Colors.primary,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: Radius.md,
    marginTop: Spacing.sm,
    alignSelf: "flex-start",
  },
  actionButtonText: {
    fontSize: 12,
    fontWeight: "600",
    color: Colors.textInverse,
  },
  actionButtonSecondary: {
    backgroundColor: Colors.primaryLight,
  },
  actionButtonTextSecondary: {
    color: Colors.primary,
  },
  divider: {
    height: 1,
    backgroundColor: Colors.borderLight,
    marginVertical: Spacing.xs,
  },
  guideButton: {
    marginTop: Spacing.md,
    paddingTop: Spacing.md,
    borderTopWidth: 1,
    borderTopColor: Colors.borderLight,
  },
  guideButtonContent: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
  },
  guideButtonTitle: {
    fontSize: 13,
    fontWeight: "600",
    color: Colors.primary,
  },
  guideButtonSubtitle: {
    fontSize: 11,
    color: Colors.textSecondary,
    marginTop: 2,
  },
  // Modal styles
  modalOverlay: {
    flex: 1,
    backgroundColor: Colors.overlay,
    justifyContent: "flex-end",
  },
  modalCard: {
    backgroundColor: Colors.cardBackground,
    borderTopLeftRadius: Radius.xxl,
    borderTopRightRadius: Radius.xxl,
    paddingHorizontal: Spacing.xl,
    paddingTop: Spacing.xl,
    paddingBottom: Spacing.xxl,
    maxHeight: "85%",
  },
  modalHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    marginBottom: Spacing.md,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: "700",
    color: Colors.textPrimary,
  },
  modalSubtitle: {
    fontSize: 12,
    color: Colors.textSecondary,
    marginTop: 2,
  },
  closeButton: {
    padding: Spacing.xs,
  },
  tabsScroll: {
    marginHorizontal: -Spacing.xl,
    paddingHorizontal: Spacing.xl,
    marginBottom: Spacing.md,
  },
  tabsContainer: {
    gap: Spacing.xs,
  },
  tabPill: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: Radius.pill,
    backgroundColor: Colors.borderLight,
  },
  tabPillSelected: {
    backgroundColor: Colors.primary,
  },
  tabPillText: {
    fontSize: 12,
    fontWeight: "600",
    color: Colors.textSecondary,
  },
  tabPillTextSelected: {
    color: Colors.textInverse,
  },
  guideScroll: {
    maxHeight: 360,
  },
  guideInfoBanner: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: Spacing.sm,
    backgroundColor: Colors.cardBackgroundSecondary,
    padding: Spacing.md,
    borderRadius: Radius.md,
    marginBottom: Spacing.md,
  },
  guideBrandDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    marginTop: 4,
  },
  guideBrandName: {
    fontSize: 13,
    fontWeight: "700",
    color: Colors.textPrimary,
  },
  guideBrandDescription: {
    fontSize: 11,
    color: Colors.textSecondary,
    marginTop: 2,
    lineHeight: 16,
  },
  stepsHeading: {
    fontSize: 13,
    fontWeight: "700",
    color: Colors.textPrimary,
    marginBottom: Spacing.sm,
  },
  stepCard: {
    flexDirection: "row",
    gap: Spacing.sm,
    backgroundColor: Colors.cardBackgroundSecondary,
    padding: Spacing.md,
    borderRadius: Radius.md,
    marginBottom: Spacing.sm,
  },
  stepNumberBadge: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: Colors.primaryLight,
    alignItems: "center",
    justifyContent: "center",
  },
  stepNumberText: {
    fontSize: 11,
    fontWeight: "700",
    color: Colors.primary,
  },
  stepTexts: {
    flex: 1,
  },
  stepTitle: {
    fontSize: 13,
    fontWeight: "600",
    color: Colors.textPrimary,
  },
  stepDesc: {
    fontSize: 11,
    color: Colors.textSecondary,
    marginTop: 2,
    lineHeight: 16,
  },
  quickLaunchSection: {
    marginTop: Spacing.sm,
    paddingTop: Spacing.sm,
  },
  quickLaunchTitle: {
    fontSize: 12,
    fontWeight: "600",
    color: Colors.textPrimary,
    marginBottom: Spacing.xs,
  },
  quickLaunchButtons: {
    flexDirection: "row",
    gap: Spacing.sm,
  },
  quickButton: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    backgroundColor: Colors.primaryLight,
    paddingVertical: 8,
    borderRadius: Radius.md,
  },
  quickButtonText: {
    fontSize: 12,
    fontWeight: "600",
    color: Colors.primary,
  },
  modalFooter: {
    paddingTop: Spacing.md,
  },
  doneButton: {
    backgroundColor: Colors.primary,
    paddingVertical: 12,
    borderRadius: Radius.md,
    alignItems: "center",
  },
  doneButtonText: {
    color: Colors.textInverse,
    fontWeight: "700",
    fontSize: 14,
  },
});
