import React, { useState, useRef } from "react";
import {
  StyleSheet,
  View,
  ActivityIndicator,
  Text,
  TouchableOpacity,
  TextInput,
  ScrollView,
  Alert,
} from "react-native";
import { useRouter } from "expo-router";
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
} from "../../services/ocrRecognition";
import { scanHistoryRepository } from "../../database/repositories/scanHistoryRepository";
import { useMedicineStore } from "../../store/medicineStore";
import { DosageForm } from "../../types";

export default function ScanScreen() {
  const router = useRouter();
  const [permission, requestPermission] = useCameraPermissions();
  const cameraRef = useRef<CameraView | null>(null);
  const { addMedicine } = useMedicineStore();

  const [capturedImage, setCapturedImage] = useState<string | null>(null);
  const [isScanning, setIsScanning] = useState(false);
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
    setExtractedData(null);
    setUsedFallbackEngine(false);
    setShowFullText(false);
    setDebugPasses(null);
    setExpandedDebugPass(null);
    setCopiedDebugPass(null);
    try {
      const { rawText, extracted, usedFallbackEngine: isDemo, debugPasses } =
        await processLabelImage(imageUri);
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
    } catch (error) {
      console.warn("Medicine label text recognition failed:", error);
      Alert.alert(
        "Could not read label",
        "Please try another image or enter the medicine details manually."
      );
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
          <TouchableOpacity
            style={styles.historyHeaderButton}
            onPress={() => router.push("/scan-history")}
          >
            <Feather name="clock" size={16} color={Colors.primary} />
            <Text style={styles.historyHeaderText}>History</Text>
          </TouchableOpacity>
        }
      />

      <View style={styles.body}>
        {!capturedImage ? (
          // Camera Viewport & Capture Controls
          <View style={styles.cameraContainer}>
            {permission?.granted ? (
              <CameraView
                ref={cameraRef}
                style={styles.cameraView}
                facing="back"
              >
                <View style={styles.overlayFrame}>
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
                <Feather name="clock" size={22} color={Colors.textSecondary} />
              </TouchableOpacity>
            </View>
          </View>
        ) : (
          // Review & OCR Edit Form
          <View style={styles.reviewContainer}>
            <View style={styles.reviewHeader}>
              <Text style={styles.reviewTitle}>Detected Label Information</Text>
              <TouchableOpacity onPress={handleReset}>
                <Text style={styles.retakeText}>Retake</Text>
              </TouchableOpacity>
            </View>

            <View style={styles.ocrAlertBanner}>
              <Ionicons
                name="information-circle-outline"
                size={18}
                color="#0788F5"
              />
              <Text style={styles.ocrAlertText}>
                {usedFallbackEngine
                  ? "Sample scan (OCR engine not bundled). Add the ML Kit dependency for real label scans — fields below are demo data."
                  : "OCR results are automated. Review and correct text against your physical prescription label before saving."}
              </Text>
            </View>

            {isScanning ? (
              <View style={styles.ocrAlertBanner}>
                <ActivityIndicator size="small" color={Colors.primary} />
                <Text style={styles.ocrAlertText}>
                  Reading text from the medicine label… hold the package steady.
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
                      <View style={styles.fullTextBody}>
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
                      </View>
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
                style={{ marginBottom: 10 }}
              />

              <AppButton
                title="Save Scan to History Only"
                onPress={handleSaveToHistory}
                variant="outline"
                size="md"
              />
            </View>
          </View>
        )}
      </View>
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
    maxHeight: 200,
  },
  fullTextLine: {
    fontSize: 13,
    color: Colors.textPrimary,
    lineHeight: 20,
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
});
