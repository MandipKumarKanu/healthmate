import React, { useState, useEffect, useMemo, useCallback } from "react";
import {
  StyleSheet,
  View,
  Text,
  TouchableOpacity,
  Animated,
  PanResponder,
  Dimensions,
  Vibration,
} from "react-native";
import { StatusBar } from "expo-status-bar";
import { useLocalSearchParams, useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { nativeAlarmService } from "../services/nativeAlarmService";
import { adherenceRepository } from "../database/repositories/adherenceRepository";
import { scheduleRepository } from "../database/repositories/scheduleRepository";
import { medicineRepository } from "../database/repositories/medicineRepository";

const { width: SCREEN_WIDTH } = Dimensions.get("window");
const SLIDER_WIDTH = Math.min(SCREEN_WIDTH - 48, 340);
const PUCK_SIZE = 58;
const MAX_DRAG = (SLIDER_WIDTH - PUCK_SIZE) / 2 - 8;
const SWIPE_THRESHOLD = MAX_DRAG * 0.75;

export default function FullScreenAlarmScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{
    scheduleId?: string;
    medicineName?: string;
    amount?: string;
    time?: string;
    label?: string;
  }>();

  const [currentTime, setCurrentTime] = useState<string>("");
  const [currentDate, setCurrentDate] = useState<string>("");
  const [completedAction, setCompletedAction] = useState<
    "taken" | "snooze" | "skipped" | null
  >(null);

  // Fallback to query params or database lookup
  const scheduleId = params.scheduleId ?? "";
  let medicineName = params.medicineName ?? "Medication";
  let amount = params.amount ?? "1 dose";
  let doseTime = params.time ?? "";
  let doseLabel = params.label ?? "";
  let medicineId = "";

  if (scheduleId) {
    const sched = scheduleRepository.getById(scheduleId);
    if (sched) {
      medicineId = sched.medicineId;
      const med = medicineRepository.getById(sched.medicineId);
      if (med) {
        medicineName = med.name;
        if (med.strength) amount = `${med.strength} · ${amount}`;
      }
      if (!doseTime && sched.times.length > 0) {
        doseTime = sched.times[0].time;
        doseLabel = sched.times[0].label ?? doseLabel;
      }
    }
  }

  // Animation values initialized via useState for React Compiler compatibility
  const [panX] = useState(() => new Animated.Value(0));
  const [pulseScale1] = useState(() => new Animated.Value(1));
  const [pulseScale2] = useState(() => new Animated.Value(1));
  const [bellSwing] = useState(() => new Animated.Value(0));

  // Clock ticker & native keyguard unlock
  useEffect(() => {
    nativeAlarmService.dismissKeyguard();

    const updateClock = () => {
      const now = new Date();
      setCurrentTime(
        now.toLocaleTimeString([], {
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
        }),
      );
      setCurrentDate(
        now.toLocaleDateString([], {
          weekday: "long",
          month: "short",
          day: "numeric",
        }),
      );
    };

    updateClock();
    const timer = setInterval(updateClock, 1000);
    return () => clearInterval(timer);
  }, []);

  // Looping pulsing ring and bell swing animations
  useEffect(() => {
    const pulse1 = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseScale1, {
          toValue: 1.45,
          duration: 1500,
          useNativeDriver: true,
        }),
        Animated.timing(pulseScale1, {
          toValue: 1,
          duration: 1500,
          useNativeDriver: true,
        }),
      ]),
    );

    const pulse2 = Animated.loop(
      Animated.sequence([
        Animated.delay(600),
        Animated.timing(pulseScale2, {
          toValue: 1.6,
          duration: 1800,
          useNativeDriver: true,
        }),
        Animated.timing(pulseScale2, {
          toValue: 1,
          duration: 1800,
          useNativeDriver: true,
        }),
      ]),
    );

    const swing = Animated.loop(
      Animated.sequence([
        Animated.timing(bellSwing, {
          toValue: -12,
          duration: 150,
          useNativeDriver: true,
        }),
        Animated.timing(bellSwing, {
          toValue: 12,
          duration: 150,
          useNativeDriver: true,
        }),
        Animated.timing(bellSwing, {
          toValue: -8,
          duration: 120,
          useNativeDriver: true,
        }),
        Animated.timing(bellSwing, {
          toValue: 8,
          duration: 120,
          useNativeDriver: true,
        }),
        Animated.timing(bellSwing, {
          toValue: 0,
          duration: 100,
          useNativeDriver: true,
        }),
        Animated.delay(1200),
      ]),
    );

    pulse1.start();
    pulse2.start();
    swing.start();

    return () => {
      pulse1.stop();
      pulse2.stop();
      swing.stop();
      nativeAlarmService.stopAlarm();
    };
  }, [bellSwing, pulseScale1, pulseScale2]);

  const handleTakeDose = useCallback(async () => {
    try {
      Vibration.vibrate(100);
      setCompletedAction("taken");
      await nativeAlarmService.stopAlarm();

      if (scheduleId && medicineId && doseTime) {
        const now = new Date();
        const todayStr = [
          now.getFullYear(),
          String(now.getMonth() + 1).padStart(2, "0"),
          String(now.getDate()).padStart(2, "0"),
        ].join("-");

        try {
          adherenceRepository.logDoseStatus(
            scheduleId,
            medicineId,
            todayStr,
            doseTime,
            "taken",
          );
        } catch (logErr) {
          console.warn("Could not record dose adherence log:", logErr);
        }
      }

      setTimeout(() => {
        router.replace("/(tabs)/home");
      }, 1200);
    } catch (e) {
      console.warn("Failed to take dose:", e);
      router.replace("/(tabs)/home");
    }
  }, [scheduleId, medicineId, doseTime, router]);

  const handleSnooze = useCallback(async () => {
    try {
      Vibration.vibrate(100);
      setCompletedAction("snooze");
      await nativeAlarmService.snoozeAlarm({
        scheduleId,
        medicineName,
        amount,
        time: doseTime,
        label: doseLabel,
        minutes: 10,
      });

      setTimeout(() => {
        router.replace("/(tabs)/home");
      }, 1200);
    } catch (e) {
      console.warn("Failed to snooze alarm:", e);
      router.replace("/(tabs)/home");
    }
  }, [scheduleId, medicineName, amount, doseTime, doseLabel, router]);

  const handleSkipDose = useCallback(async () => {
    try {
      Vibration.vibrate(50);
      setCompletedAction("skipped");
      await nativeAlarmService.stopAlarm();

      if (scheduleId && medicineId && doseTime) {
        const now = new Date();
        const todayStr = [
          now.getFullYear(),
          String(now.getMonth() + 1).padStart(2, "0"),
          String(now.getDate()).padStart(2, "0"),
        ].join("-");

        try {
          adherenceRepository.logDoseStatus(
            scheduleId,
            medicineId,
            todayStr,
            doseTime,
            "skipped",
          );
        } catch (logErr) {
          console.warn("Could not record skip adherence log:", logErr);
        }
      }

      setTimeout(() => {
        router.replace("/(tabs)/home");
      }, 1000);
    } catch (e) {
      console.warn("Failed to skip dose:", e);
      router.replace("/(tabs)/home");
    }
  }, [scheduleId, medicineId, doseTime, router]);

  // PanResponder for Interactive Swipe Slider
  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onPanResponderMove: (_, gestureState) => {
          const clampedX = Math.max(
            -MAX_DRAG,
            Math.min(MAX_DRAG, gestureState.dx),
          );
          panX.setValue(clampedX);
        },
        onPanResponderRelease: (_, gestureState) => {
          if (gestureState.dx >= SWIPE_THRESHOLD) {
            handleTakeDose();
          } else if (gestureState.dx <= -SWIPE_THRESHOLD) {
            handleSnooze();
          } else {
            Animated.spring(panX, {
              toValue: 0,
              useNativeDriver: true,
              bounciness: 12,
            }).start();
          }
        },
      }),
    [panX, handleTakeDose, handleSnooze],
  );

  const bellRotation = bellSwing.interpolate({
    inputRange: [-15, 15],
    outputRange: ["-15deg", "15deg"],
  });

  const greenFillOpacity = panX.interpolate({
    inputRange: [0, MAX_DRAG],
    outputRange: [0, 0.9],
    extrapolate: "clamp",
  });

  const amberFillOpacity = panX.interpolate({
    inputRange: [-MAX_DRAG, 0],
    outputRange: [0.9, 0],
    extrapolate: "clamp",
  });

  return (
    <View style={styles.container}>
      <StatusBar style="light" />
      <SafeAreaView style={styles.safeArea}>
        {/* Top Clock and Date Header */}
        <View style={styles.header}>
          <Text style={styles.dateText}>{currentDate.toUpperCase()}</Text>
          <Text style={styles.clockText}>{currentTime}</Text>
        </View>

        {/* Pulsing Bell Icon */}
        <View style={styles.animationArea}>
          <Animated.View
            style={[
              styles.pulseCircle,
              styles.pulseCircleOuter,
              { transform: [{ scale: pulseScale2 }] },
            ]}
          />
          <Animated.View
            style={[
              styles.pulseCircle,
              styles.pulseCircleInner,
              { transform: [{ scale: pulseScale1 }] },
            ]}
          />
          <View style={styles.bellBackground}>
            <Animated.View style={{ transform: [{ rotate: bellRotation }] }}>
              <Ionicons name="notifications" size={56} color="#FFFFFF" />
            </Animated.View>
          </View>
        </View>

        {/* Medication Details Card */}
        <View style={styles.medCard}>
          <View style={styles.doseBadge}>
            <Ionicons name="time" size={14} color="#0788F5" />
            <Text style={styles.doseBadgeText}>
              {doseLabel
                ? `${doseLabel} · ${doseTime}`
                : doseTime || "Dose Reminder"}
            </Text>
          </View>
          <Text style={styles.medName} numberOfLines={2}>
            {medicineName}
          </Text>
          <Text style={styles.medAmount}>{amount}</Text>
        </View>

        {/* Action Result Overlay */}
        {completedAction && (
          <View style={styles.actionBanner}>
            <Ionicons
              name={
                completedAction === "taken"
                  ? "checkmark-circle"
                  : completedAction === "snooze"
                    ? "alarm"
                    : "close-circle"
              }
              size={24}
              color="#FFFFFF"
            />
            <Text style={styles.actionBannerText}>
              {completedAction === "taken"
                ? "Dose Logged as Taken!"
                : completedAction === "snooze"
                  ? "Snoozed for 10 minutes"
                  : "Dose Skipped"}
            </Text>
          </View>
        )}

        {/* Interactive Swipe Slider */}
        <View style={styles.sliderSection}>
          <View style={styles.sliderTrack}>
            {/* Left Amber Snooze Fill */}
            <Animated.View
              style={[styles.sliderFillAmber, { opacity: amberFillOpacity }]}
            />
            {/* Right Green Take Fill */}
            <Animated.View
              style={[styles.sliderFillGreen, { opacity: greenFillOpacity }]}
            />

            <View style={styles.sliderLabelsRow}>
              <View style={styles.sliderLabelCol}>
                <Ionicons name="alarm-outline" size={16} color="#F59E0B" />
                <Text style={styles.sliderHintLeft}>Snooze 10m</Text>
              </View>
              <View style={styles.sliderLabelCol}>
                <Text style={styles.sliderHintRight}>Take Dose</Text>
                <Ionicons name="checkmark-outline" size={16} color="#10B981" />
              </View>
            </View>

            {/* Draggable Puck */}
            <Animated.View
              {...panResponder.panHandlers}
              style={[
                styles.sliderPuck,
                {
                  transform: [{ translateX: panX }],
                },
              ]}
            >
              <Ionicons name="swap-horizontal" size={26} color="#0B111E" />
            </Animated.View>
          </View>
          <Text style={styles.sliderInstruction}>
            Swipe right to Take • Swipe left to Snooze
          </Text>
        </View>

        {/* Quick Action Buttons */}
        <View style={styles.quickButtonsRow}>
          <TouchableOpacity
            style={styles.btnTake}
            activeOpacity={0.8}
            onPress={handleTakeDose}
          >
            <Ionicons name="checkmark-circle" size={20} color="#FFFFFF" />
            <Text style={styles.btnTakeText}>Take Dose</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.btnSnooze}
            activeOpacity={0.8}
            onPress={handleSnooze}
          >
            <Ionicons name="time" size={20} color="#FFFFFF" />
            <Text style={styles.btnSnoozeText}>Snooze 10m</Text>
          </TouchableOpacity>
        </View>

        <TouchableOpacity
          style={styles.btnSkip}
          activeOpacity={0.7}
          onPress={handleSkipDose}
        >
          <Text style={styles.btnSkipText}>Skip this dose</Text>
        </TouchableOpacity>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#070D18",
  },
  safeArea: {
    flex: 1,
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 24,
    paddingTop: 16,
    paddingBottom: 24,
  },
  header: {
    alignItems: "center",
    marginTop: 8,
  },
  dateText: {
    fontSize: 13,
    fontWeight: "700",
    letterSpacing: 2,
    color: "#0788F5",
    marginBottom: 4,
  },
  clockText: {
    fontSize: 44,
    fontWeight: "800",
    color: "#FFFFFF",
    fontVariant: ["tabular-nums"],
    letterSpacing: 1,
  },
  animationArea: {
    alignItems: "center",
    justifyContent: "center",
    width: 180,
    height: 180,
    marginVertical: 10,
  },
  pulseCircle: {
    position: "absolute",
    borderRadius: 999,
  },
  pulseCircleOuter: {
    width: 170,
    height: 170,
    backgroundColor: "rgba(7, 136, 245, 0.12)",
  },
  pulseCircleInner: {
    width: 130,
    height: 130,
    backgroundColor: "rgba(7, 136, 245, 0.22)",
  },
  bellBackground: {
    width: 96,
    height: 96,
    borderRadius: 48,
    backgroundColor: "#0788F5",
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#0788F5",
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.6,
    shadowRadius: 18,
    elevation: 12,
  },
  medCard: {
    width: "100%",
    backgroundColor: "#0F1A2E",
    borderRadius: 24,
    padding: 22,
    alignItems: "center",
    borderWidth: 1,
    borderColor: "#1D2F4E",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.4,
    shadowRadius: 16,
    elevation: 8,
  },
  doseBadge: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(7, 136, 245, 0.15)",
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
    gap: 6,
    marginBottom: 12,
  },
  doseBadgeText: {
    fontSize: 13,
    fontWeight: "600",
    color: "#60A5FA",
  },
  medName: {
    fontSize: 26,
    fontWeight: "800",
    color: "#FFFFFF",
    textAlign: "center",
    marginBottom: 6,
  },
  medAmount: {
    fontSize: 16,
    color: "#94A3B8",
    fontWeight: "500",
  },
  actionBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: "#1E293B",
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#334155",
  },
  actionBannerText: {
    fontSize: 15,
    fontWeight: "700",
    color: "#FFFFFF",
  },
  sliderSection: {
    width: "100%",
    alignItems: "center",
    marginVertical: 12,
  },
  sliderTrack: {
    width: SLIDER_WIDTH,
    height: 66,
    backgroundColor: "#111D33",
    borderRadius: 33,
    justifyContent: "center",
    alignItems: "center",
    borderWidth: 1.5,
    borderColor: "#1E3256",
    overflow: "hidden",
  },
  sliderFillGreen: {
    position: "absolute",
    right: 0,
    top: 0,
    bottom: 0,
    left: "50%",
    backgroundColor: "#10B981",
  },
  sliderFillAmber: {
    position: "absolute",
    left: 0,
    top: 0,
    bottom: 0,
    right: "50%",
    backgroundColor: "#F59E0B",
  },
  sliderLabelsRow: {
    flexDirection: "row",
    width: "100%",
    justifyContent: "space-between",
    paddingHorizontal: 18,
  },
  sliderLabelCol: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  sliderHintLeft: {
    fontSize: 12,
    fontWeight: "700",
    color: "#F59E0B",
  },
  sliderHintRight: {
    fontSize: 12,
    fontWeight: "700",
    color: "#10B981",
  },
  sliderPuck: {
    position: "absolute",
    width: PUCK_SIZE,
    height: PUCK_SIZE,
    borderRadius: PUCK_SIZE / 2,
    backgroundColor: "#FFFFFF",
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35,
    shadowRadius: 8,
    elevation: 6,
  },
  sliderInstruction: {
    fontSize: 12,
    fontWeight: "500",
    color: "#64748B",
    marginTop: 8,
  },
  quickButtonsRow: {
    flexDirection: "row",
    gap: 12,
    width: "100%",
  },
  btnTake: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: "#10B981",
    paddingVertical: 14,
    borderRadius: 16,
    shadowColor: "#10B981",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 8,
    elevation: 4,
  },
  btnTakeText: {
    color: "#FFFFFF",
    fontSize: 15,
    fontWeight: "700",
  },
  btnSnooze: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: "#D97706",
    paddingVertical: 14,
    borderRadius: 16,
    shadowColor: "#D97706",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 8,
    elevation: 4,
  },
  btnSnoozeText: {
    color: "#FFFFFF",
    fontSize: 15,
    fontWeight: "700",
  },
  btnSkip: {
    paddingVertical: 8,
    paddingHorizontal: 16,
  },
  btnSkipText: {
    color: "#64748B",
    fontSize: 14,
    fontWeight: "600",
  },
});
