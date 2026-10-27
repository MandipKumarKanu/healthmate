import React, { useState, useRef, useCallback } from "react";
import {
  StyleSheet,
  View,
  ActivityIndicator,
  Text,
  TouchableOpacity,
  TextInput,
  ScrollView,
} from "react-native";
import { AppAlert as Alert } from "../../services/appAlert";
import { useRouter, useFocusEffect } from "expo-router";
import { CameraView, useCameraPermissions } from "expo-camera";
import * as ImagePicker from "expo-image-picker";
import * as Clipboard from "expo-clipboard";
import { Ionicons, Feather } from "@expo/vector-icons";
import { Colors } from "../../theme/colors";
import { Radius, Spacing, Typography } from "../../theme/tokens";
import { AppScreen } from "../../components/ui/AppScreen";
import { AppHeader } from "../../components/ui/AppHeader";
import { AppCard } from "../../components/ui/AppCard";
import { AppButton } from "../../components/ui/AppButton";
import { ExtractedMedicineData } from "../../services/ocrService";
import {
  LabelScanPassDebug,
  processLabelImage,
  OcrConnectionError,
} from "../../services/ocrRecognition";
import { scanHistoryRepository } from "../../database/repositories/scanHistoryRepository";
import { useMedicineStore } from "../../store/medicineStore";
import { DosageForm } from "../../types";
import { aiAssistantService } from "../../services/aiAssistantService";
import { networkService } from "../../services/networkService";
import { ConnectGeminiModal } from "../../components/ai/ConnectGeminiModal";

export default function ScanScreen() {
  const router = useRouter();
  const [permission, requestPermission] = useCameraPermissions();
  const cameraRef = useRef<CameraView | null>(null);
  const { addMedicine } = useMedicineStore();

  const [hasApiKey, setHasApiKey] = useState<boolean | null>(null);
  const [isOnline, setIsOnline] = useState<boolean | null>(null);
  const [isCheckingPrerequisites, setIsCheckingPrerequisites] = useState(true);
  const [showConnectModal, setShowConnectModal] = useState(false);
  const [scanStepMessage, setScanStepMessage] = useState(
    "Connecting to Cloud OCR… Reading packaging text…"
  );

  const checkPrerequisites = useCallback(async () => {
    setIsCheckingPrerequisites(true);
    try {
      const [online, key] = await Promise.all([
        networkService.checkInternet(),
        aiAssistantService.getApiKey(),
      ]);
      setIsOnline(online);
      setHasApiKey(Boolean(key));
    } catch (error) {
      console.warn('Could not check scan prerequisites:', error);
      setIsOnline(false);
      setHasApiKey(false);
    } finally {
      setIsCheckingPrerequisites(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      checkPrerequisites();
    }, [checkPrerequisites])
  );

  const [capturedImage, setCapturedImage] = useState<string | null>(null);
  const [isScanning, setIsScanning] = useState(false);
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [extractedData, setExtractedData] =
    useState<ExtractedMedicineData | null>(null);
  // True when the demo text was used because the native engine is unavailable.
  const [usedFallbackEngine, setUsedFallbackEngine] = useState(false);
  // Dev only: per-pass OCR reads (color vs grayscale) for on-device comparison.
  const [debugPasses, setDebugPasses] = useState<LabelScanPassDebug[] | null>(
    null
  );
  const [expandedDebugPass, setExpandedDebugPass] = useState<string | null>(
    null
  );
  const [copiedDebugPass, setCopiedDebugPass] = useState<string | null>(null);
  // Full label text card visibility
  const [showFullText, setShowFullText] = useState(false);
  const [fullTextCopied, setFullTextCopied] = useState(false);

  // Editable fields for review
  const [medName, setMedName] = useState("");
  const [medStrength, setMedStrength] = useState("");
  const [medForm, setMedForm] = useState<DosageForm>("tablet");
  const [medExpiry, setMedExpiry] = useState("");
  const [medBatch, setMedBatch] = useState("");
  const [medMfg, setMedMfg] = useState("");

  const processImage = async (imageUri: string) => {
    setIsScanning(true);
    setScanStepMessage("Step 1/2: Reading packaging with Cloud OCR…");
    setConnectionError(null);
    setExtractedData(null);
    setUsedFallbackEngine(false);
    setShowFullText(false);
    setDebugPasses(null);
    setExpandedDebugPass(null);
    setCopiedDebugPass(null);
    try {
      setScanStepMessage("Step 2/2: Personal AI analyzing medicine details…");
      const {
        rawText,
        extracted,
        usedFallbackEngine: isDemo,
        debugPasses,
        aiWarning,
      } = await processLabelImage(imageUri);
      // Packaging interpretation can invalidate and clear a rejected Gemini key
      // while still returning the local OCR extraction. Keep the scan gate in sync.
      let persistedKey: string | null = null;
      let keyReadSucceeded = true;
      try {
        persistedKey = await aiAssistantService.getApiKey();
      } catch (keyError) {
        keyReadSucceeded = false;
        console.warn('Could not read the saved Gemini key after scanning:', keyError);
      }
      setHasApiKey(Boolean(persistedKey));
      if (hasApiKey && keyReadSucceeded && !persistedKey) {
        Alert.alert(
          'Gemini key rejected',
          'Google rejected the saved API key, so this scan used local OCR extraction only. The rejected key has been disconnected. Reconnect with a valid key to restore AI-assisted packaging interpretation.',
          [
            { text: 'Reconnect AI', onPress: () => setShowConnectModal(true) },
            { text: 'Review OCR results', style: 'cancel' },
          ],
        );
      } else if (aiWarning) {
        Alert.alert(
          'AI interpretation unavailable',
          `${aiWarning}\n\nThe OCR extraction is still available for review. Check every field against the original medicine packaging before saving.`,
          [{ text: 'Continue reviewing OCR', style: 'cancel' }],
        );
      }
      if (__DEV__ && debugPasses) {
        setDebugPasses(debugPasses);
      }
      if (!rawText) {
        Alert.alert(
          "No text detected",
          "Try a clearer, well-lit photo with the medicine label filling the frame."
        );
        return;
      }
      setUsedFallbackEngine(isDemo);
      setExtractedData(extracted);
      setMedName(extracted.medicineName || "");
      setMedStrength(extracted.detectedStrength || "");
      setMedForm(extracted.dosageForm || "tablet");
      setMedExpiry(extracted.expiryDate || "");
      setMedBatch(extracted.batchNumber || "");
      setMedMfg(extracted.manufacturer || "");

      // Auto-save all scans directly to scan history
      try {
        scanHistoryRepository.add({
          medicineName: extracted.medicineName || "Scanned Medicine",
          detectedStrength: extracted.detectedStrength || undefined,
          dosageForm: extracted.dosageForm || "tablet",
          manufacturer: extracted.manufacturer || undefined,
          batchNumber: extracted.batchNumber || undefined,
          expiryDate: extracted.expiryDate || undefined,
          rawText: rawText,
          imageUri: imageUri,
        });
      } catch (historyErr) {
        console.warn("Auto-save scan to history failed:", historyErr);
      }
    } catch (error: any) {
      console.warn("Medicine label text recognition failed:", error);
      const isConnectionIssue =
        error instanceof OcrConnectionError ||
        error?.isConnectionError ||
        error?.name === "OcrConnectionError" ||
        error?.message?.toLowerCase().includes("connect to internet") ||
        error?.message?.toLowerCase().includes("network request failed") ||
        error?.message?.toLowerCase().includes("failed to fetch") ||
        error?.message?.toLowerCase().includes("fetch failed") ||
        error?.message?.toLowerCase().includes("cleartext") ||
        error?.message?.toLowerCase().includes("timeout");

      if (isConnectionIssue) {
        setConnectionError(
          "Please connect to internet to use this feature or add manually."
        );
        Alert.alert(
          "Internet Connection Required",
          "Please connect to internet to use this feature or add manually.",
          [
            {
              text: "Add Manually",
              onPress: () => router.push("/medicines/add"),
            },
            {
              text: "Retry",
              onPress: () => processImage(imageUri),
            },
            { text: "Cancel", style: "cancel" },
          ]
        );
      } else {
        const message =
          error?.message ||
          "Please try another image or enter the medicine details manually.";
        Alert.alert("Could not read label", message, [
          {
            text: "Add Manually",
            onPress: () => router.push("/medicines/add"),
          },
          { text: "OK", style: "cancel" },
        ]);
      }
    } finally {
      setIsScanning(false);
    }
  };

  const handleCapture = async () => {
    if (!permission?.granted) {
      const result = await requestPermission();
      if (!result.granted) {
        Alert.alert(
          "Camera permission needed",
          "Allow camera access to scan a medicine label.",
        );
        return;
      }
    }
    try {
      const photo = await cameraRef.current?.takePictureAsync({ quality: 1.0 });
      if (!photo?.uri) {
        Alert.alert(
          "Camera unavailable",
          "Please try again or choose a photo from your gallery.",
        );
        return;
      }
      setCapturedImage(photo.uri);
      await processImage(photo.uri);
    } catch (error) {
      console.warn("Medicine label capture failed:", error);
      Alert.alert(
        "Capture failed",
        "Please try again or choose a photo from your gallery.",
      );
    }
  };

  const handlePickImage = async () => {
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ["images"],
        allowsEditing: true,
        quality: 1,
      });
      if (!result.canceled && result.assets && result.assets.length > 0) {
        const imageUri = result.assets[0].uri;
        setCapturedImage(imageUri);
        await processImage(imageUri);
      }
    } catch (error) {
      console.warn("Unable to select medicine image:", error);
      Alert.alert("Image selection failed", "Please try another image.");
    }
  };

  const handleCopyDebugPass = async (pass: LabelScanPassDebug) => {
    try {
      await Clipboard.setStringAsync(pass.rawText);
      setCopiedDebugPass(pass.label);
      setTimeout(() => setCopiedDebugPass(null), 2000);
    } catch (error) {
      console.warn("Copy debug pass text failed:", error);
    }
  };

  const handleReset = () => {
    setCapturedImage(null);
    setConnectionError(null);
    setExtractedData(null);
    setUsedFallbackEngine(false);
    setShowFullText(false);
    setDebugPasses(null);
    setExpandedDebugPass(null);
    setCopiedDebugPass(null);
    setMedName("");
    setMedStrength("");
    setMedForm("tablet");
    setMedExpiry("");
    setMedBatch("");
    setMedMfg("");
  };

  const fullTextLines =
    extractedData?.lines && extractedData.lines.length > 0
      ? extractedData.lines
      : extractedData?.rawText
        ? extractedData.rawText.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
        : [];

  const handleCopyFullText = async () => {
    const text = fullTextLines.join("\n");
    if (!text) return;
    try {
      await Clipboard.setStringAsync(text);
      setFullTextCopied(true);
      setTimeout(() => setFullTextCopied(false), 2000);
    } catch (error) {
      console.warn("Copy label text failed:", error);
      Alert.alert("Copy failed", "Long-press the text below to select and copy it.");
    }
  };

  const handleSaveToHistory = () => {
    if (!medName.trim()) {
      Alert.alert("Notice", "Please provide a medicine name.");
      return;
    }

    scanHistoryRepository.add({
      medicineName: medName,
      detectedStrength: medStrength || undefined,
      dosageForm: medForm,
      manufacturer: medMfg || undefined,
      batchNumber: medBatch || undefined,
      expiryDate: medExpiry || undefined,
      rawText: extractedData?.rawText,
      imageUri: capturedImage || undefined,
    });

    Alert.alert("Saved to Scan History", "Scan record has been saved.", [
      { text: "View History", onPress: () => router.push("/scan-history") },
      { text: "Done", onPress: handleReset },
    ]);
  };

  const handleAddToCabinet = () => {
    if (!medName.trim()) {
      Alert.alert("Notice", "Please provide a medicine name.");
      return;
    }

    // Save to scan history
    scanHistoryRepository.add({
      medicineName: medName,
      detectedStrength: medStrength || undefined,
      dosageForm: medForm,
      manufacturer: medMfg || undefined,
      batchNumber: medBatch || undefined,
      expiryDate: medExpiry || undefined,
      rawText: extractedData?.rawText,
      imageUri: capturedImage || undefined,
    });

    // Add to medicine cabinet
    const newMed = addMedicine({
      id: `med_${Date.now()}`,
      name: medName.trim(),
      strength: medStrength.trim() || "Standard dose",
      dosageForm: medForm,
      category: "Prescription",
      ingredient: extractedData?.genericName || undefined,
      packageDetails: {
        manufacturer: medMfg || undefined,
        expiryDate: medExpiry || undefined,
        batchNumber: medBatch || undefined,
        packageDetailsText: "Captured via camera label scan",
        // OCR extraction is not verification; keep this false until the user explicitly checks the original package.
        originalPackageChecked: false,
      },
      informationSource: "Extracted from medication label scan.",
      isSample: false,
    });

    Alert.alert(
      "Added to Cabinet",
      `${newMed.name} was successfully added to your medicine cabinet!`,
      [
        {
          text: "Set Reminder",
          onPress: () =>
            router.push(`/reminders/create?medicineId=${newMed.id}`),
        },
        { text: "Done", onPress: () => router.push("/(tabs)/medicines") },
      ],
    );
  };

  return (
    <AppScreen scrollable contentContainerStyle={styles.scrollContent}>
      <AppHeader
        title="Scan Medicine"
        subtitle="Extract details from medication packaging"
        brandText="HealthMate AI"
        rightAction={
          <View style={styles.headerRightActions}>
            <TouchableOpacity
              style={styles.headerAddManuallyBtn}
              onPress={() => router.push("/medicines/add")}
              activeOpacity={0.8}
            >
              <Feather name="plus" size={13} color="#FFFFFF" />
              <Text style={styles.headerAddManuallyBtnText}>Add Manually</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.historyHeaderButton}
              onPress={() => router.push("/scan-history")}
              activeOpacity={0.8}
            >
              <Feather name="clock" size={14} color={Colors.primary} />
              <Text style={styles.historyHeaderText}>History</Text>
            </TouchableOpacity>
          </View>
        }
      />

      <View style={styles.body}>
        {/* Notice banner: Only show when there is no internet connection */}
        {isOnline === false ? (
          <View style={styles.internetNoticeBanner}>
            <View style={styles.internetNoticeLeft}>
              <Ionicons
                name="cloud-offline-outline"
                size={17}
                color={Colors.error}
              />
              <Text
                style={[
                  styles.internetNoticeText,
                  { color: Colors.errorDark },
                ]}
              >
                Cloud OCR & AI require internet connection
              </Text>
            </View>
          </View>
        ) : null}

        {/* Connection Error Card */}
        {connectionError ? (
          <View style={styles.connectionErrorCard}>
            <View style={styles.connectionErrorRow}>
              <Ionicons
                name="cloud-offline-outline"
                size={22}
                color={Colors.error}
              />
              <View style={styles.connectionErrorTextContainer}>
                <Text style={styles.connectionErrorTitle}>
                  Internet Connection Required
                </Text>
                <Text style={styles.connectionErrorText}>
                  {connectionError}
                </Text>
              </View>
            </View>
            <View style={styles.connectionErrorButtonsRow}>
              <TouchableOpacity
                style={styles.connectionErrorManualBtn}
                onPress={() => router.push("/medicines/add")}
                activeOpacity={0.8}
              >
                <Feather name="edit-3" size={14} color="#FFFFFF" />
                <Text style={styles.connectionErrorManualBtnText}>
                  Add Manually
                </Text>
              </TouchableOpacity>
              {capturedImage ? (
                <TouchableOpacity
                  style={styles.connectionErrorRetryBtn}
                  onPress={() => processImage(capturedImage)}
                  activeOpacity={0.8}
                >
                  <Feather name="refresh-cw" size={14} color={Colors.primary} />
                  <Text style={styles.connectionErrorRetryBtnText}>
                    Retry Scan
                  </Text>
                </TouchableOpacity>
              ) : null}
            </View>
          </View>
        ) : null}

        {!capturedImage ? (
          isCheckingPrerequisites ? (
            <View style={styles.gatingCard}>
              <ActivityIndicator size="large" color={Colors.primary} />
              <Text style={styles.prerequisiteTitle}>
                Initializing Medicine Scanner…
              </Text>
              <Text style={styles.prerequisiteSub}>
                Checking network and Personal AI configuration
              </Text>
            </View>
          ) : isOnline === false ? (
            <View style={styles.gatingCard}>
              <View
                style={[
                  styles.gatingIconCircle,
                  { backgroundColor: Colors.errorLight },
                ]}
              >
                <Ionicons
                  name="cloud-offline-outline"
                  size={38}
                  color={Colors.error}
                />
              </View>
              <Text style={styles.gatingTitle}>Internet Connection Required</Text>
              <Text style={styles.gatingSubtitle}>
                Cloud OCR and Personal AI need an active internet connection to
                scan and analyze medication packaging.
              </Text>
              <View style={styles.gatingActions}>
                <TouchableOpacity
                  style={styles.gatingPrimaryBtn}
                  onPress={checkPrerequisites}
                  activeOpacity={0.8}
                >
                  <Feather name="refresh-cw" size={16} color="#FFFFFF" />
                  <Text style={styles.gatingPrimaryBtnText}>
                    Retry Connection
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.gatingSecondaryBtn}
                  onPress={() => router.push("/medicines/add")}
                  activeOpacity={0.8}
                >
                  <Feather name="plus" size={16} color={Colors.primary} />
                  <Text style={styles.gatingSecondaryBtnText}>Add Manually</Text>
                </TouchableOpacity>
              </View>
            </View>
          ) : !hasApiKey ? (
            <View style={styles.gatingCard}>
              <View
                style={[
                  styles.gatingIconCircle,
                  { backgroundColor: Colors.primaryLight },
                ]}
              >
                <Ionicons name="sparkles" size={38} color={Colors.primary} />
              </View>
              <Text style={styles.gatingTitle}>Unlock AI Medicine Scanner</Text>
              <Text style={styles.gatingSubtitle}>
                Connect your Personal AI (Google Gemini) to analyze packaging,
                auto-detect brand & generic salts, dosage form, strength, and
                expiry dates.
              </Text>

              <View style={styles.gatingFeatureList}>
                <View style={styles.gatingFeatureRow}>
                  <Ionicons
                    name="checkmark-circle"
                    size={16}
                    color={Colors.success}
                  />
                  <Text style={styles.gatingFeatureText}>
                    High-precision dosage and generic salt detection
                  </Text>
                </View>
                <View style={styles.gatingFeatureRow}>
                  <Ionicons
                    name="checkmark-circle"
                    size={16}
                    color={Colors.success}
                  />
                  <Text style={styles.gatingFeatureText}>
                    Powered by Google Gemini 3.5 Flash-Lite
                  </Text>
                </View>
                <View style={styles.gatingFeatureRow}>
                  <Ionicons
                    name="shield-checkmark"
                    size={16}
                    color={Colors.primary}
                  />
                  <Text style={styles.gatingFeatureText}>
                    Key stored securely on this device, sent to Google for AI requests
                  </Text>
                </View>
              </View>

              <View style={styles.gatingActions}>
                <TouchableOpacity
                  style={styles.gatingPrimaryBtn}
                  onPress={() => setShowConnectModal(true)}
                  activeOpacity={0.8}
                >
                  <Ionicons name="sparkles" size={16} color="#FFFFFF" />
                  <Text style={styles.gatingPrimaryBtnText}>
                    Connect Personal AI
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.gatingSecondaryBtn}
                  onPress={() => router.push("/medicines/add")}
                  activeOpacity={0.8}
                >
                  <Feather name="plus" size={16} color={Colors.primary} />
                  <Text style={styles.gatingSecondaryBtnText}>Add Manually</Text>
                </TouchableOpacity>
              </View>
            </View>
          ) : (
            // Camera Viewport & Capture Controls
            <View style={styles.cameraContainer}>
              {permission?.granted ? (
                <CameraView
                  ref={cameraRef}
                  style={styles.cameraView}
                  facing="back"
                >
                  <View style={styles.overlayFrame}>
                    <TouchableOpacity
                      style={styles.aiConnectedPill}
                      onPress={() => setShowConnectModal(true)}
                      activeOpacity={0.8}
                    >
                      <View style={styles.aiConnectedDot} />
                      <Text style={styles.aiConnectedPillText}>
                        Connected to Gemini AI
                      </Text>
                      <Feather
                        name="settings"
                        size={11}
                        color="#FFFFFF"
                        style={{ marginLeft: 4 }}
                      />
                    </TouchableOpacity>
                    <View style={styles.targetCornerTL} />
                    <View style={styles.targetCornerTR} />
                    <View style={styles.targetCornerBL} />
                    <View style={styles.targetCornerBR} />
                    <Text style={styles.overlayHint}>
                      Align medicine label within frame
                    </Text>
                  </View>
                </CameraView>
              ) : (
                // Permission or simulated viewport fallback
                <View style={styles.cameraPlaceholder}>
                  <Ionicons
                    name="camera-outline"
                    size={48}
                    color={Colors.primary}
                  />
                  <Text style={styles.cameraTitle}>Camera Label Scanner</Text>
                  <Text style={styles.cameraSub}>
                    Point at medicine box, bottle, or prescription blister pack to
                    detect medicine details.
                  </Text>

                  {!permission?.granted ? (
                    <TouchableOpacity
                      style={styles.permissionButton}
                      onPress={requestPermission}
                    >
                      <Text style={styles.permissionButtonText}>
                        Grant Camera Permission
                      </Text>
                    </TouchableOpacity>
                  ) : null}
                </View>
              )}

              {/* Controls */}
              <View style={styles.controlsRow}>
                <TouchableOpacity
                  style={styles.galleryButton}
                  onPress={handlePickImage}
                >
                  <Ionicons
                    name="images-outline"
                    size={24}
                    color={Colors.primary}
                  />
                </TouchableOpacity>

                <TouchableOpacity
                  style={styles.shutterButton}
                  onPress={handleCapture}
                  activeOpacity={0.8}
                >
                  <View style={styles.shutterInner} />
                </TouchableOpacity>

                <TouchableOpacity
                  style={styles.galleryButton}
                  onPress={() => router.push("/scan-history")}
                >
                  <Feather
                    name="clock"
                    size={22}
                    color={Colors.textSecondary}
                  />
                </TouchableOpacity>
              </View>
            </View>
          )
        ) : (
          // Review & OCR Edit Form
          <View style={styles.reviewContainer}>
            <View style={styles.reviewHeader}>
              <Text style={styles.reviewTitle}>Detected Label Information</Text>
              <View style={styles.reviewHeaderActions}>
                <TouchableOpacity onPress={handleReset} activeOpacity={0.7}>
                  <Text style={styles.retakeText}>Retake</Text>
                </TouchableOpacity>
              </View>
            </View>

            <View style={styles.ocrAlertBanner}>
              <Ionicons
                name="information-circle-outline"
                size={18}
                color="#0788F5"
              />
              <Text style={styles.ocrAlertText}>
                OCR results are automated. Review and correct text against your physical prescription label before saving.
              </Text>
            </View>

            {isScanning ? (
              <View style={styles.ocrAlertBanner}>
                <ActivityIndicator size="small" color={Colors.primary} />
                <Text style={styles.ocrAlertText}>
                  {scanStepMessage}
                </Text>
              </View>
            ) : null}

            {extractedData && !isScanning ? (
              <>
                {!extractedData.isHighConfidence ? (
                  <View style={styles.lowConfidenceChip}>
                    <Ionicons
                      name="alert-circle-outline"
                      size={14}
                      color="#B45309"
                    />
                    <Text style={styles.lowConfidenceText}>
                      Low-confidence read — double-check the fields below
                      against the package.
                    </Text>
                  </View>
                ) : null}

                {/* Full label text */}
                <AppCard style={styles.fullTextCard}>
                  <TouchableOpacity
                    style={styles.fullTextHeader}
                    onPress={() => setShowFullText((prev) => !prev)}
                    activeOpacity={0.7}
                  >
                    <Feather name="file-text" size={15} color={Colors.primary} />
                    <Text style={styles.fullTextTitle}>Full label text</Text>
                    <Text style={styles.fullTextBadge}>
                      {fullTextLines.length} lines
                    </Text>
                    {usedFallbackEngine ? (
                      <Text style={styles.fullTextBadge}>sample</Text>
                    ) : null}
                    <Ionicons
                      name={showFullText ? "chevron-up" : "chevron-down"}
                      size={14}
                      color={Colors.textTertiary}
                    />
                  </TouchableOpacity>

                  {showFullText ? (
                    <>
                      <ScrollView
                        style={styles.fullTextBody}
                        contentContainerStyle={styles.fullTextContent}
                        nestedScrollEnabled
                        showsVerticalScrollIndicator
                      >
                        {fullTextLines.length > 0 ? (
                          fullTextLines.map((line, index) => (
                            <Text
                              key={`label-line-${index}`}
                              style={styles.fullTextLine}
                              selectable
                            >
                              {line}
                            </Text>
                          ))
                        ) : (
                          <Text style={styles.fullTextLine}>—</Text>
                        )}
                      </ScrollView>
                      <TouchableOpacity
                        style={styles.copyButton}
                        onPress={handleCopyFullText}
                        activeOpacity={0.7}
                      >
                        <Feather
                          name={fullTextCopied ? "check" : "copy"}
                          size={13}
                          color={fullTextCopied ? Colors.success : Colors.primary}
                        />
                        <Text
                          style={[
                            styles.copyButtonText,
                            fullTextCopied && styles.copyButtonTextDone,
                          ]}
                        >
                          {fullTextCopied ? "Copied!" : "Copy text"}
                        </Text>
                      </TouchableOpacity>
                    </>
                  ) : null}
                </AppCard>
              </>
            ) : null}

            {/* Dev only: per-pass comparison of the color reads vs the
                grayscale + contrast pass, for tuning low-light labels. */}
            {__DEV__ && debugPasses && debugPasses.length > 0 ? (
              <AppCard style={styles.debugCard}>
                <Text style={styles.debugTitle}>
                  OCR pass comparison (dev builds only)
                </Text>
                <Text style={styles.debugHint}>
                  Same photo, different recognition passes. Compare a color pass
                  (highres/compact) against the grayscale+contrast read.
                </Text>
                {debugPasses.map((pass) => (
                  <View key={pass.label} style={styles.debugPassRow}>
                    <TouchableOpacity
                      style={styles.debugPassHeader}
                      onPress={() =>
                        setExpandedDebugPass((prev) =>
                          prev === pass.label ? null : pass.label
                        )
                      }
                      activeOpacity={0.7}
                    >
                      <Ionicons
                        name={
                          expandedDebugPass === pass.label
                            ? "chevron-down"
                            : "chevron-forward"
                        }
                        size={13}
                        color={Colors.textTertiary}
                      />
                      <Text style={styles.debugPassLabel} numberOfLines={1}>
                        {pass.label}
                      </Text>
                      <Text style={styles.debugPassScore}>
                        signals {pass.signals} · {pass.chars} chars
                      </Text>
                    </TouchableOpacity>

                    {expandedDebugPass === pass.label ? (
                      <>
                        <View style={styles.debugPassBody}>
                          {pass.rawText
                            .split(/\r?\n/)
                            .filter(Boolean)
                            .map((line, index) => (
                              <Text
                                key={`debug-line-${pass.label}-${index}`}
                                style={styles.debugPassLine}
                                selectable
                              >
                                {line}
                              </Text>
                            ))}
                        </View>
                        <TouchableOpacity
                          style={styles.debugCopyButton}
                          onPress={() => handleCopyDebugPass(pass)}
                          activeOpacity={0.7}
                        >
                          <Feather
                            name={copiedDebugPass === pass.label ? "check" : "copy"}
                            size={12}
                            color={
                              copiedDebugPass === pass.label
                                ? Colors.success
                                : Colors.primary
                            }
                          />
                          <Text style={styles.debugCopyText}>
                            {copiedDebugPass === pass.label
                              ? "Copied!"
                              : "Copy this read"}
                          </Text>
                        </TouchableOpacity>
                      </>
                    ) : null}
                  </View>
                ))}
              </AppCard>
            ) : null}

            {/* Editable Fields */}
            <AppCard style={styles.fieldsCard}>
              <Text style={styles.fieldLabel}>Medicine Name</Text>
              <TextInput
                style={styles.fieldInput}
                value={medName}
                onChangeText={setMedName}
                placeholder="Detected medicine name"
              />

              {extractedData?.candidates && extractedData.candidates.length > 1 && (
                <View style={styles.candidatesSection}>
                  <Text style={styles.candidatesLabel}>
                    Suggested matches ({Math.round((extractedData.confidenceScore ?? 0) * 100)}% match):
                  </Text>
                  <View style={styles.candidatesRow}>
                    {extractedData.candidates.map((cand) => (
                      <TouchableOpacity
                        key={cand.name}
                        style={[
                          styles.candidateChip,
                          medName.toLowerCase() === cand.name.toLowerCase() &&
                            styles.candidateChipActive,
                        ]}
                        onPress={() => {
                          setMedName(cand.name);
                          if (cand.genericName) {
                            setExtractedData((prev) =>
                              prev ? { ...prev, genericName: cand.genericName } : null
                            );
                          }
                        }}
                        activeOpacity={0.7}
                      >
                        <Text
                          style={[
                            styles.candidateChipText,
                            medName.toLowerCase() === cand.name.toLowerCase() &&
                              styles.candidateChipTextActive,
                          ]}
                        >
                          {cand.name}
                          {cand.genericName && cand.isBrand ? ` (${cand.genericName})` : ''}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                </View>
              )}

              <View style={styles.divider} />

              <Text style={styles.fieldLabel}>Strength</Text>
              <TextInput
                style={styles.fieldInput}
                value={medStrength}
                onChangeText={setMedStrength}
                placeholder="e.g. 500 mg"
              />

              <View style={styles.divider} />

              <Text style={styles.fieldLabel}>Expiry Date</Text>
              <TextInput
                style={styles.fieldInput}
                value={medExpiry}
                onChangeText={setMedExpiry}
                placeholder="e.g. Dec 2027"
              />

              <View style={styles.divider} />

              <Text style={styles.fieldLabel}>Batch / Lot Number</Text>
              <TextInput
                style={styles.fieldInput}
                value={medBatch}
                onChangeText={setMedBatch}
                placeholder="e.g. DEMO-1234"
              />

              <View style={styles.divider} />

              <Text style={styles.fieldLabel}>Manufacturer</Text>
              <TextInput
                style={styles.fieldInput}
                value={medMfg}
                onChangeText={setMedMfg}
                placeholder="e.g. PharmaCorp"
              />
            </AppCard>

            {/* Actions */}
            <View style={styles.actionButtonsContainer}>
              <AppButton
                title="Add to Medicine Cabinet"
                onPress={handleAddToCabinet}
                variant="primary"
                size="lg"
              />
            </View>
          </View>
        )}
      </View>

      <ConnectGeminiModal
        visible={showConnectModal}
        onClose={() => setShowConnectModal(false)}
        onKeySaved={() => {
          setHasApiKey(true);
        }}
        onSuccess={() => {
          setHasApiKey(true);
        }}
        onDisconnected={() => {
          setHasApiKey(false);
        }}
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
  headerRightActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  headerAddManuallyBtn: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: Colors.primary,
    paddingVertical: 5,
    paddingHorizontal: 10,
    borderRadius: Radius.pill,
    gap: 4,
  },
  headerAddManuallyBtnText: {
    fontSize: 12,
    fontWeight: "700",
    color: "#FFFFFF",
  },
  historyHeaderButton: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: Colors.primaryLight,
    paddingVertical: 5,
    paddingHorizontal: 10,
    borderRadius: Radius.pill,
  },
  historyHeaderText: {
    fontSize: 13,
    fontWeight: "600",
    color: Colors.primary,
    marginLeft: 4,
  },
  cameraContainer: {
    alignItems: "center",
    marginTop: Spacing.sm,
  },
  cameraView: {
    width: "100%",
    height: 380,
    borderRadius: Radius.card,
    overflow: "hidden",
    justifyContent: "center",
    alignItems: "center",
  },
  cameraPlaceholder: {
    width: "100%",
    height: 340,
    borderRadius: Radius.card,
    backgroundColor: "#FFFFFF",
    borderWidth: 2,
    borderStyle: "dashed",
    borderColor: "#D0D0DC",
    justifyContent: "center",
    alignItems: "center",
    padding: Spacing.xl,
  },
  cameraTitle: {
    fontSize: 18,
    fontWeight: "700",
    color: Colors.textPrimary,
    marginTop: 12,
  },
  cameraSub: {
    fontSize: 13,
    color: Colors.textSecondary,
    textAlign: "center",
    marginTop: 6,
    lineHeight: 18,
  },
  permissionButton: {
    marginTop: 16,
    backgroundColor: Colors.primary,
    paddingVertical: 10,
    paddingHorizontal: 18,
    borderRadius: Radius.pill,
  },
  permissionButtonText: {
    color: Colors.textInverse,
    fontWeight: "600",
    fontSize: 14,
  },
  overlayFrame: {
    width: "80%",
    height: "65%",
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.4)",
    borderRadius: 16,
    justifyContent: "center",
    alignItems: "center",
  },
  targetCornerTL: {
    position: "absolute",
    top: -2,
    left: -2,
    width: 24,
    height: 24,
    borderTopWidth: 4,
    borderLeftWidth: 4,
    borderColor: Colors.primary,
  },
  targetCornerTR: {
    position: "absolute",
    top: -2,
    right: -2,
    width: 24,
    height: 24,
    borderTopWidth: 4,
    borderRightWidth: 4,
    borderColor: Colors.primary,
  },
  targetCornerBL: {
    position: "absolute",
    bottom: -2,
    left: -2,
    width: 24,
    height: 24,
    borderBottomWidth: 4,
    borderLeftWidth: 4,
    borderColor: Colors.primary,
  },
  targetCornerBR: {
    position: "absolute",
    bottom: -2,
    right: -2,
    width: 24,
    height: 24,
    borderBottomWidth: 4,
    borderRightWidth: 4,
    borderColor: Colors.primary,
  },
  overlayHint: {
    color: "#FFFFFF",
    fontSize: 13,
    fontWeight: "600",
    backgroundColor: "rgba(0, 0, 0, 0.5)",
    paddingVertical: 4,
    paddingHorizontal: 10,
    borderRadius: Radius.pill,
  },
  controlsRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-around",
    width: "100%",
    marginTop: Spacing.xl,
    paddingHorizontal: 20,
  },
  galleryButton: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: Colors.border,
    justifyContent: "center",
    alignItems: "center",
  },
  shutterButton: {
    width: 72,
    height: 72,
    borderRadius: 36,
    borderWidth: 4,
    borderColor: Colors.primary,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "#FFFFFF",
  },
  shutterInner: {
    width: 54,
    height: 54,
    borderRadius: 27,
    backgroundColor: Colors.primary,
  },
  reviewContainer: {
    marginTop: Spacing.xs,
  },
  reviewHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: Spacing.sm,
  },
  reviewTitle: {
    fontSize: 17,
    fontWeight: "700",
    color: Colors.textPrimary,
  },
  retakeText: {
    fontSize: 14,
    fontWeight: "600",
    color: Colors.primary,
  },
  ocrAlertBanner: {
    flexDirection: "row",
    alignItems: "flex-start",
    backgroundColor: "#E8F4FF",
    borderRadius: Radius.md,
    padding: 12,
    marginBottom: Spacing.md,
  },
  ocrAlertText: {
    flex: 1,
    fontSize: 12,
    color: "#0369A1",
    lineHeight: 17,
    marginLeft: 8,
  },
  lowConfidenceChip: {
    flexDirection: "row",
    alignItems: "flex-start",
    backgroundColor: "#FEF6E9",
    borderRadius: Radius.md,
    padding: 10,
    marginBottom: Spacing.md,
  },
  lowConfidenceText: {
    flex: 1,
    fontSize: 12,
    color: "#B27623",
    lineHeight: 17,
    marginLeft: 6,
  },
  fullTextCard: {
    marginBottom: Spacing.md,
    padding: Spacing.cardPadding,
  },
  fullTextHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  fullTextTitle: {
    fontSize: 13,
    fontWeight: "700",
    color: Colors.textPrimary,
    flex: 1,
  },
  fullTextBadge: {
    fontSize: 11,
    fontWeight: "600",
    color: Colors.textTertiary,
    backgroundColor: "#F1F5F9",
    paddingVertical: 2,
    paddingHorizontal: 8,
    borderRadius: Radius.pill,
    overflow: "hidden",
  },
  fullTextBody: {
    marginTop: 10,
    backgroundColor: "#F8F8FC",
    borderWidth: 1,
    borderColor: "#F3F2F6",
    borderRadius: Radius.sm,
    padding: 10,
    maxHeight: 180,
    width: "100%",
  },
  fullTextContent: {
    paddingBottom: 4,
  },
  fullTextLine: {
    fontSize: 13,
    color: Colors.textPrimary,
    lineHeight: 20,
    width: "100%",
    flexWrap: "wrap",
    flexShrink: 1,
  },
  copyButton: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-end",
    marginTop: 8,
    paddingVertical: 6,
    paddingHorizontal: 12,
    backgroundColor: "#F1F5F9",
    borderRadius: Radius.pill,
  },
  copyButtonText: {
    fontSize: 12,
    fontWeight: "600",
    color: Colors.primary,
    marginLeft: 6,
  },
  copyButtonTextDone: {
    color: Colors.successDark,
  },
  fieldsCard: {
    marginBottom: Spacing.lg,
    paddingVertical: 8,
  },
  fieldLabel: {
    fontSize: 12,
    fontWeight: "600",
    color: Colors.textSecondary,
    marginBottom: 4,
  },
  fieldInput: {
    fontSize: 15,
    color: Colors.textPrimary,
    paddingVertical: 4,
  },
  divider: {
    height: 1,
    backgroundColor: Colors.borderLight,
    marginVertical: 10,
  },
  actionButtonsContainer: {
    marginTop: Spacing.sm,
  },
  debugCard: {
    marginBottom: Spacing.md,
    padding: Spacing.cardPadding,
    backgroundColor: "#FFFDF4",
    borderWidth: 1,
    borderColor: "#F1E8C8",
  },
  debugTitle: {
    fontSize: 13,
    fontWeight: "700",
    color: "#8A6D1B",
  },
  debugHint: {
    fontSize: 11,
    color: "#A08C4A",
    lineHeight: 15,
    marginTop: 3,
    marginBottom: 8,
  },
  debugPassRow: {
    borderTopWidth: 1,
    borderTopColor: "#F1E8C8",
    paddingVertical: 6,
  },
  debugPassHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  debugPassLabel: {
    flex: 1,
    fontSize: 12,
    fontWeight: "700",
    color: Colors.textPrimary,
    textTransform: "none",
  },
  debugPassScore: {
    fontSize: 11,
    color: Colors.textSecondary,
  },
  debugPassBody: {
    marginTop: 6,
    backgroundColor: "#F8F8FC",
    borderWidth: 1,
    borderColor: "#F3F2F6",
    borderRadius: Radius.sm,
    padding: 10,
    maxHeight: 220,
  },
  debugPassLine: {
    fontSize: 12,
    color: Colors.textPrimary,
    lineHeight: 18,
  },
  debugCopyButton: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-end",
    marginTop: 6,
    paddingVertical: 5,
    paddingHorizontal: 10,
    backgroundColor: "#F1F5F9",
    borderRadius: Radius.pill,
  },
  debugCopyText: {
    fontSize: 11,
    fontWeight: "600",
    color: Colors.primary,
    marginLeft: 5,
  },
  candidatesSection: {
    marginTop: 6,
    marginBottom: 4,
  },
  candidatesLabel: {
    fontSize: 11,
    fontWeight: "600",
    color: "#64748B",
    marginBottom: 6,
  },
  candidatesRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
  },
  candidateChip: {
    backgroundColor: "#F1F5F9",
    paddingVertical: 5,
    paddingHorizontal: 10,
    borderRadius: Radius.pill,
    borderWidth: 1,
    borderColor: "#E2E8F0",
  },
  candidateChipActive: {
    backgroundColor: Colors.primaryLight,
    borderColor: Colors.primary,
  },
  candidateChipText: {
    fontSize: 12,
    color: "#475569",
    fontWeight: "500",
  },
  candidateChipTextActive: {
    color: Colors.primary,
    fontWeight: "700",
  },
  internetNoticeBanner: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: "#F0F7FF",
    borderColor: "#D0E7FC",
    borderWidth: 1,
    borderRadius: Radius.md,
    paddingVertical: 9,
    paddingHorizontal: 12,
    marginBottom: Spacing.md,
    gap: 8,
  },
  internetNoticeLeft: {
    flexDirection: "row",
    alignItems: "center",
    flex: 1,
    gap: 8,
  },
  internetNoticeText: {
    fontSize: 12,
    lineHeight: 16,
    color: "#1E40AF",
    fontWeight: "500",
    flex: 1,
  },
  addManuallyPill: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: Colors.primary,
    paddingVertical: 5,
    paddingHorizontal: 10,
    borderRadius: Radius.pill,
    gap: 4,
  },
  addManuallyPillText: {
    color: "#FFFFFF",
    fontSize: 12,
    fontWeight: "600",
  },
  connectionErrorCard: {
    backgroundColor: "#FEF2F2",
    borderColor: "#FECACA",
    borderWidth: 1,
    borderRadius: Radius.md,
    padding: Spacing.cardPadding,
    marginBottom: Spacing.md,
  },
  connectionErrorRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
    marginBottom: 12,
  },
  connectionErrorTextContainer: {
    flex: 1,
  },
  connectionErrorTitle: {
    fontSize: 14,
    fontWeight: "700",
    color: Colors.error,
    marginBottom: 2,
  },
  connectionErrorText: {
    fontSize: 13,
    color: "#991B1B",
    lineHeight: 18,
  },
  connectionErrorButtonsRow: {
    flexDirection: "row",
    gap: 10,
  },
  connectionErrorManualBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: Colors.primary,
    paddingVertical: 9,
    paddingHorizontal: 14,
    borderRadius: Radius.md,
    gap: 6,
  },
  connectionErrorManualBtnText: {
    color: "#FFFFFF",
    fontSize: 13,
    fontWeight: "600",
  },
  connectionErrorRetryBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#FFFFFF",
    borderColor: Colors.primary,
    borderWidth: 1,
    paddingVertical: 9,
    paddingHorizontal: 14,
    borderRadius: Radius.md,
    gap: 6,
  },
  connectionErrorRetryBtnText: {
    color: Colors.primary,
    fontSize: 13,
    fontWeight: "600",
  },
  reviewHeaderActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  manualEntryLink: {
    paddingVertical: 4,
    paddingHorizontal: 6,
  },
  manualEntryLinkText: {
    fontSize: 13,
    fontWeight: "600",
    color: Colors.primary,
  },
  gatingCard: {
    backgroundColor: Colors.cardBackground,
    borderRadius: Radius.card,
    padding: Spacing.xl,
    alignItems: "center",
    marginTop: Spacing.sm,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.08,
    shadowRadius: 16,
    elevation: 3,
    borderWidth: 1,
    borderColor: Colors.borderLight,
  },
  gatingIconCircle: {
    width: 72,
    height: 72,
    borderRadius: 36,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: Spacing.md,
  },
  gatingTitle: {
    fontSize: 20,
    fontWeight: "700",
    color: Colors.textPrimary,
    textAlign: "center",
    marginBottom: Spacing.xs,
  },
  gatingSubtitle: {
    fontSize: 13,
    lineHeight: 19,
    color: Colors.textSecondary,
    textAlign: "center",
    marginBottom: Spacing.lg,
    paddingHorizontal: Spacing.sm,
  },
  gatingFeatureList: {
    width: "100%",
    backgroundColor: Colors.cardBackgroundSecondary,
    borderRadius: Radius.md,
    padding: Spacing.md,
    marginBottom: Spacing.xl,
    gap: Spacing.sm,
  },
  gatingFeatureRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
  },
  gatingFeatureText: {
    flex: 1,
    fontSize: 13,
    color: Colors.textPrimary,
    lineHeight: 18,
  },
  gatingActions: {
    width: "100%",
    gap: Spacing.md,
  },
  gatingPrimaryBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: Spacing.sm,
    backgroundColor: Colors.primary,
    borderRadius: Radius.md,
    paddingVertical: 14,
  },
  gatingPrimaryBtnText: {
    fontSize: 15,
    fontWeight: "700",
    color: "#FFFFFF",
  },
  gatingSecondaryBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: Spacing.xs,
    paddingVertical: Spacing.sm,
  },
  gatingSecondaryBtnText: {
    fontSize: 14,
    fontWeight: "600",
    color: Colors.primary,
  },
  prerequisiteTitle: {
    fontSize: 18,
    fontWeight: "700",
    color: Colors.textPrimary,
    marginTop: Spacing.md,
    textAlign: "center",
  },
  prerequisiteSub: {
    fontSize: 13,
    color: Colors.textSecondary,
    marginTop: Spacing.xs,
    textAlign: "center",
  },
  aiConnectedPill: {
    position: "absolute",
    top: 16,
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(0, 0, 0, 0.65)",
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: Radius.pill,
    gap: 6,
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.2)",
  },
  aiConnectedDot: {
    width: 7,
    height: 7,
    borderRadius: 3.5,
    backgroundColor: Colors.success,
  },
  aiConnectedPillText: {
    fontSize: 12,
    fontWeight: "600",
    color: "#FFFFFF",
  },
});
