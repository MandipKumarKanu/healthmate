import React, { useState, useEffect, useCallback } from "react";
import {
  StyleSheet,
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  Platform,
  AppState,
  AppStateStatus,
  ActivityIndicator,
} from "react-native";
import { AppAlert as Alert } from "../../services/appAlert";
import { useRouter } from "expo-router";
import { Ionicons, Feather, MaterialCommunityIcons } from "@expo/vector-icons";
import { Colors } from "../../theme/colors";
import { Radius, Spacing } from "../../theme/tokens";
import { AppScreen } from "../../components/ui/AppScreen";
import { AppHeader } from "../../components/ui/AppHeader";
import { AppCard } from "../../components/ui/AppCard";
import {
  batteryOptimizationService,
  ReliabilityStatus,
  OEMGuide,
} from "../../services/batteryOptimizationService";

export default function BatteryOptimizationScreen() {
  const router = useRouter();
  const [status, setStatus] = useState<ReliabilityStatus | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [selectedOemId, setSelectedOemId] = useState<string>("stock");

  const checkStatus = useCallback(async () => {
    try {
      const result = await batteryOptimizationService.getReliabilityStatus();
      setStatus(result);
      setSelectedOemId(result.detectedOemId);
    } catch (e) {
      console.warn("BatteryOptimizationScreen checkStatus error:", e);
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
      setTimeout(checkStatus, 1500);
    } catch (e) {
      Alert.alert(
        "Settings Unavailable",
        "Could not open the battery exemption prompt directly. Please adjust it under App Info > Battery in device settings.",
      );
    } finally {
      setActionLoading(null);
    }
  };

  const handleOpenExactAlarm = async () => {
    setActionLoading("exact");
    try {
      await batteryOptimizationService.openExactAlarmSettings();
      setTimeout(checkStatus, 1500);
    } catch (e) {
      Alert.alert(
        "Settings Unavailable",
        "Could not open exact alarm settings directly. Please enable Alarms & Reminders in device settings.",
      );
    } finally {
      setActionLoading(null);
    }
  };

  const handleOpenOemSettings = async () => {
    setActionLoading("oem");
    try {
      await batteryOptimizationService.openOemAutoStartSettings();
    } catch (e) {
      Alert.alert(
        "Settings Unavailable",
        "OEM autostart menu not found on this device. Please check your phone's Security or Battery app.",
      );
    } finally {
      setActionLoading(null);
    }
  };

  const handleOpenAppBattery = async () => {
    setActionLoading("appBattery");
    try {
      await batteryOptimizationService.openAppBatterySettings();
    } catch (e) {
      Alert.alert("Error", "Could not open app settings.");
    } finally {
      setActionLoading(null);
    }
  };

  const guides = batteryOptimizationService.getGuides();
  const activeGuide =
    guides.find((g) => g.id === selectedOemId) || guides[guides.length - 1];

  return (
    <AppScreen scrollable={false} contentContainerStyle={styles.container}>
      <AppHeader
        title="Alarm Reliability"
        subtitle="Battery & Background Settings"
        onBackPress={() => router.back()}
      />

      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* Status Overview Card */}
        <AppCard style={styles.statusCard}>
          {loading ? (
            <ActivityIndicator size="small" color={Colors.primary} />
          ) : (
            <>
              <View style={styles.statusHeaderRow}>
                <View
                  style={[
                    styles.statusBadgeIcon,
                    status?.isOptimal
                      ? styles.statusBadgeOptimal
                      : styles.statusBadgeWarning,
                  ]}
                >
                  <MaterialCommunityIcons
                    name={status?.isOptimal ? "shield-check" : "battery-alert"}
                    size={24}
                    color={status?.isOptimal ? Colors.success : "#D97706"}
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.statusTitle}>
                    {status?.isOptimal
                      ? "Reliability Configured"
                      : "Optimization Active"}
                  </Text>
                  <Text style={styles.statusSubtitle}>
                    {status?.isOptimal
                      ? "HealthMate is permitted to trigger precise dose reminders."
                      : "Background restrictions may delay or silence your medicine alarms."}
                  </Text>
                </View>
              </View>

              <View style={styles.deviceMetaRow}>
                <Text style={styles.deviceMetaText}>
                  Detected:{" "}
                  <Text style={{ fontWeight: "700", color: "#0F172A" }}>
                    {status?.manufacturer?.toUpperCase() || "UNKNOWN"}
                  </Text>{" "}
                  {status?.androidVersion
                    ? `(Android API ${status.androidVersion})`
                    : ""}
                </Text>
              </View>

              {/* Status Checks List */}
              <View style={styles.checksList}>
                <View style={styles.checkItem}>
                  <Ionicons
                    name={
                      status?.isIgnoringBatteryOptimizations
                        ? "checkmark-circle"
                        : "close-circle"
                    }
                    size={18}
                    color={
                      status?.isIgnoringBatteryOptimizations
                        ? Colors.success
                        : "#EF4444"
                    }
                  />
                  <Text style={styles.checkItemText}>
                    Battery Optimization:{" "}
                    {status?.isIgnoringBatteryOptimizations
                      ? "Unrestricted (Allowed)"
                      : "Restricted (Optimized)"}
                  </Text>
                </View>

                <View style={styles.checkItem}>
                  <Ionicons
                    name={
                      status?.canScheduleExactAlarms
                        ? "checkmark-circle"
                        : "close-circle"
                    }
                    size={18}
                    color={
                      status?.canScheduleExactAlarms
                        ? Colors.success
                        : "#EF4444"
                    }
                  />
                  <Text style={styles.checkItemText}>
                    Alarms & Reminders Permission:{" "}
                    {status?.canScheduleExactAlarms
                      ? "Allowed"
                      : "Denied / Missing"}
                  </Text>
                </View>
              </View>

              {/* Quick Action Deep-Links */}
              <View style={styles.actionsGrid}>
                {!status?.isIgnoringBatteryOptimizations && (
                  <TouchableOpacity
                    style={styles.actionBtnPrimary}
                    onPress={handleRequestBatteryIgnore}
                    disabled={actionLoading === "battery"}
                    activeOpacity={0.8}
                  >
                    {actionLoading === "battery" ? (
                      <ActivityIndicator size="small" color="#FFFFFF" />
                    ) : (
                      <>
                        <Ionicons name="flash" size={16} color="#FFFFFF" />
                        <Text style={styles.actionBtnPrimaryText}>
                          Disable Battery Optimization
                        </Text>
                      </>
                    )}
                  </TouchableOpacity>
                )}

                {!status?.canScheduleExactAlarms && (
                  <TouchableOpacity
                    style={styles.actionBtnSecondary}
                    onPress={handleOpenExactAlarm}
                    disabled={actionLoading === "exact"}
                    activeOpacity={0.8}
                  >
                    {actionLoading === "exact" ? (
                      <ActivityIndicator
                        size="small"
                        color={Colors.primary}
                      />
                    ) : (
                      <>
                        <Ionicons
                          name="alarm-outline"
                          size={16}
                          color={Colors.primary}
                        />
                        <Text style={styles.actionBtnSecondaryText}>
                          Allow Exact Alarms
                        </Text>
                      </>
                    )}
                  </TouchableOpacity>
                )}

                <View style={styles.quickLinksRow}>
                  <TouchableOpacity
                    style={styles.quickLinkBtn}
                    onPress={handleOpenOemSettings}
                    disabled={actionLoading === "oem"}
                    activeOpacity={0.7}
                  >
                    <Feather name="external-link" size={14} color="#64748B" />
                    <Text style={styles.quickLinkText}>
                      Autostart Settings
                    </Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={styles.quickLinkBtn}
                    onPress={handleOpenAppBattery}
                    disabled={actionLoading === "appBattery"}
                    activeOpacity={0.7}
                  >
                    <Feather name="settings" size={14} color="#64748B" />
                    <Text style={styles.quickLinkText}>App Info Details</Text>
                  </TouchableOpacity>
                </View>
              </View>
            </>
          )}
        </AppCard>

        {/* Manufacturer Specific Instructions Section */}
        <View style={styles.sectionHeaderLine}>
          <Text style={styles.sectionTitle}>Manufacturer Guides</Text>
          <Text style={styles.sectionSubtitle}>
            Custom Android skins apply non-standard background killing rules.
          </Text>
        </View>

        {/* OEM Tabs */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.tabsScroll}
          contentContainerStyle={styles.tabsContent}
        >
          {guides.map((g) => {
            const isSelected = g.id === selectedOemId;
            return (
              <TouchableOpacity
                key={g.id}
                style={[styles.oemTab, isSelected && styles.oemTabActive]}
                onPress={() => setSelectedOemId(g.id)}
                activeOpacity={0.7}
              >
                <Text
                  style={[
                    styles.oemTabText,
                    isSelected && styles.oemTabTextActive,
                  ]}
                >
                  {g.name.split("/")[0].trim()}
                </Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>

        {/* Selected OEM Guide Card */}
        <AppCard style={styles.guideCard}>
          <View style={styles.guideHeader}>
            <View style={{ flex: 1 }}>
              <Text style={styles.guideName}>{activeGuide.name}</Text>
              <Text style={styles.guideSubname}>{activeGuide.subname}</Text>
            </View>
            <View
              style={[
                styles.oemBadge,
                { backgroundColor: `${activeGuide.badgeColor}15` },
              ]}
            >
              <Text
                style={[
                  styles.oemBadgeText,
                  { color: activeGuide.badgeColor },
                ]}
              >
                Recommended
              </Text>
            </View>
          </View>

          <Text style={styles.guideDescription}>
            {activeGuide.description}
          </Text>

          <View style={styles.divider} />

          {/* Guide Steps */}
          <View style={styles.stepsList}>
            {activeGuide.steps.map((step, idx) => (
              <View key={idx} style={styles.stepItem}>
                <View style={styles.stepNumberBadge}>
                  <Text style={styles.stepNumberText}>{idx + 1}</Text>
                </View>
                <View style={styles.stepTextCol}>
                  <Text style={styles.stepTitle}>{step.title}</Text>
                  <Text style={styles.stepDescription}>
                    {step.description}
                  </Text>
                </View>
              </View>
            ))}
          </View>
        </AppCard>

        {/* Best Effort Reliability Disclaimer */}
        <View style={styles.disclaimerBox}>
          <Feather
            name="info"
            size={16}
            color="#64748B"
            style={{ marginTop: 2, marginRight: 8 }}
          />
          <Text style={styles.disclaimerText}>
            Note: Android manufacturer battery optimizations vary across device
            models and firmware versions. These steps provide best-effort guidance
            to maximize alarm delivery reliability, but cannot override all
            aggressive custom OS process killers.
          </Text>
        </View>
      </ScrollView>
    </AppScreen>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#F8F9FD",
  },
  scrollContent: {
    paddingHorizontal: Spacing.screenPaddingHorizontal,
    paddingBottom: 40,
  },
  statusCard: {
    marginBottom: 20,
    padding: 16,
  },
  statusHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 12,
  },
  statusBadgeIcon: {
    width: 48,
    height: 48,
    borderRadius: Radius.pill,
    justifyContent: "center",
    alignItems: "center",
    marginRight: 14,
  },
  statusBadgeOptimal: {
    backgroundColor: "#DCFCE7",
  },
  statusBadgeWarning: {
    backgroundColor: "#FEF3C7",
  },
  statusTitle: {
    fontSize: 16,
    fontWeight: "700",
    color: "#0F172A",
    marginBottom: 2,
  },
  statusSubtitle: {
    fontSize: 12,
    color: "#64748B",
    lineHeight: 17,
  },
  deviceMetaRow: {
    backgroundColor: "#F1F5F9",
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: Radius.sm,
    marginBottom: 12,
  },
  deviceMetaText: {
    fontSize: 12,
    color: "#64748B",
  },
  checksList: {
    gap: 8,
    marginBottom: 16,
  },
  checkItem: {
    flexDirection: "row",
    alignItems: "center",
  },
  checkItemText: {
    fontSize: 13,
    color: "#334155",
    marginLeft: 8,
    fontWeight: "500",
  },
  actionsGrid: {
    gap: 8,
    borderTopWidth: 1,
    borderTopColor: Colors.borderLight,
    paddingTop: 14,
  },
  actionBtnPrimary: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: Colors.primary,
    paddingVertical: 11,
    borderRadius: Radius.pill,
    gap: 8,
  },
  actionBtnPrimaryText: {
    color: "#FFFFFF",
    fontSize: 14,
    fontWeight: "700",
  },
  actionBtnSecondary: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: Colors.primaryLight,
    paddingVertical: 10,
    borderRadius: Radius.pill,
    gap: 8,
  },
  actionBtnSecondaryText: {
    color: Colors.primary,
    fontSize: 13,
    fontWeight: "700",
  },
  quickLinksRow: {
    flexDirection: "row",
    gap: 8,
    marginTop: 4,
  },
  quickLinkBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#F1F5F9",
    paddingVertical: 8,
    borderRadius: Radius.pill,
    gap: 6,
  },
  quickLinkText: {
    fontSize: 12,
    fontWeight: "600",
    color: "#475569",
  },
  sectionHeaderLine: {
    marginBottom: 10,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: "700",
    color: "#0F172A",
  },
  sectionSubtitle: {
    fontSize: 12,
    color: "#64748B",
    marginTop: 2,
  },
  tabsScroll: {
    marginBottom: 14,
  },
  tabsContent: {
    gap: 8,
  },
  oemTab: {
    paddingVertical: 6,
    paddingHorizontal: 14,
    backgroundColor: "#FFFFFF",
    borderRadius: Radius.pill,
    borderWidth: 1,
    borderColor: "#E2E8F0",
  },
  oemTabActive: {
    backgroundColor: Colors.primary,
    borderColor: Colors.primary,
  },
  oemTabText: {
    fontSize: 13,
    fontWeight: "600",
    color: "#475569",
  },
  oemTabTextActive: {
    color: "#FFFFFF",
  },
  guideCard: {
    padding: 16,
    marginBottom: 16,
  },
  guideHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    marginBottom: 6,
  },
  guideName: {
    fontSize: 16,
    fontWeight: "700",
    color: "#0F172A",
  },
  guideSubname: {
    fontSize: 12,
    color: "#64748B",
  },
  oemBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: Radius.pill,
  },
  oemBadgeText: {
    fontSize: 11,
    fontWeight: "700",
  },
  guideDescription: {
    fontSize: 13,
    color: "#475569",
    lineHeight: 18,
    marginTop: 4,
  },
  divider: {
    height: 1,
    backgroundColor: Colors.borderLight,
    marginVertical: 14,
  },
  stepsList: {
    gap: 12,
  },
  stepItem: {
    flexDirection: "row",
    alignItems: "flex-start",
  },
  stepNumberBadge: {
    width: 22,
    height: 22,
    borderRadius: Radius.pill,
    backgroundColor: Colors.primaryLight,
    justifyContent: "center",
    alignItems: "center",
    marginRight: 10,
    marginTop: 2,
  },
  stepNumberText: {
    fontSize: 11,
    fontWeight: "700",
    color: Colors.primary,
  },
  stepTextCol: {
    flex: 1,
  },
  stepTitle: {
    fontSize: 13,
    fontWeight: "700",
    color: "#0F172A",
    marginBottom: 2,
  },
  stepDescription: {
    fontSize: 12,
    color: "#64748B",
    lineHeight: 17,
  },
  disclaimerBox: {
    flexDirection: "row",
    backgroundColor: "#F1F5F9",
    borderRadius: Radius.card,
    padding: 12,
    alignItems: "flex-start",
  },
  disclaimerText: {
    flex: 1,
    fontSize: 11,
    color: "#64748B",
    lineHeight: 16,
  },
});
