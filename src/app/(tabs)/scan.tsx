import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  StyleSheet,
  View,
  ActivityIndicator,
  Text,
  TouchableOpacity,
  TextInput,
  ScrollView,
  Image,
  Modal,
} from 'react-native';
import { AppAlert as Alert } from '../../services/appAlert';
import { saveScanImage } from '../../services/scanImageStorage';
import { useRouter, useFocusEffect } from 'expo-router';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as ImagePicker from 'expo-image-picker';
import * as Clipboard from 'expo-clipboard';
import { Ionicons, Feather, MaterialCommunityIcons } from '@expo/vector-icons';
import { Colors } from '../../theme/colors';
import { Radius, Spacing, Typography, Shadows } from '../../theme/tokens';
import { AppScreen } from '../../components/ui/AppScreen';
import { AppHeader } from '../../components/ui/AppHeader';
import { AppCard } from '../../components/ui/AppCard';
import { AppButton } from '../../components/ui/AppButton';
import { MedicineIcon } from '../../components/ui/MedicineIcon';
import { MedicalDisclaimer } from '../../components/ui/MedicalDisclaimer';
import { ExtractedMedicineData } from '../../services/ocrService';
import {
  LabelScanPassDebug,
  OcrConnectionError,
  processMultiSideLabelImages,
  ScanStage,
} from '../../services/ocrRecognition';
import { cropAndAdjustImage, CropBounds } from '../../services/imageCropService';
import { scanHistoryRepository } from '../../database/repositories/scanHistoryRepository';
import { useMedicineStore } from '../../store/medicineStore';
import { DosageForm } from '../../types';
import { aiAssistantService } from '../../services/aiAssistantService';
import { networkService } from '../../services/networkService';
import { ConnectGeminiModal } from '../../components/ai/ConnectGeminiModal';
import { InteractiveCropView } from '../../components/scan/InteractiveCropView';
import { AiAnalysisProgressView } from '../../components/scan/AiAnalysisProgressView';

type ScanFlowStep = 'capture' | 'crop' | 'review' | 'analyzing' | 'result';
type TargetSide = 'front' | 'back';

export default function ScanScreen() {
  const router = useRouter();
  const [permission, requestPermission] = useCameraPermissions();
  const cameraRef = useRef<CameraView | null>(null);
  const { addMedicine } = useMedicineStore();

  // Network & AI prerequisites
  const [hasApiKey, setHasApiKey] = useState<boolean | null>(null);
  const [isOnline, setIsOnline] = useState<boolean | null>(null);
  const [isCheckingPrerequisites, setIsCheckingPrerequisites] = useState(true);
  const [showConnectModal, setShowConnectModal] = useState(false);

  // Step-machine state
  const [currentStep, setCurrentStep] = useState<ScanFlowStep>('capture');
  const [targetSide, setTargetSide] = useState<TargetSide>('front');

  // Camera settings (back camera only for clear medication label photography)
  const [flashMode, setFlashMode] = useState<'off' | 'on' | 'auto'>('off');

  // Multi-side image assets (original preserved, cropped stored separately)
  const [frontOriginalUri, setFrontOriginalUri] = useState<string | null>(null);
  const [frontCroppedUri, setFrontCroppedUri] = useState<string | null>(null);
  const [backOriginalUri, setBackOriginalUri] = useState<string | null>(null);
  const [backCroppedUri, setBackCroppedUri] = useState<string | null>(null);
  const [savedScanImageUri, setSavedScanImageUri] = useState<string | null>(null);

  // Analysis progress
  const [currentStage, setCurrentStage] = useState<ScanStage>('idle');
  const [scanStepMessage, setScanStepMessage] = useState<string>('Preparing…');
  const [analysisError, setAnalysisError] = useState<string | null>(null);

  // Extracted Result state
  const [extractedData, setExtractedData] = useState<ExtractedMedicineData | null>(null);
  const [debugPasses, setDebugPasses] = useState<LabelScanPassDebug[] | null>(null);
  const [activeResultTab, setActiveResultTab] = useState<'overview' | 'safety' | 'raw_text'>(
    'overview',
  );
  const [previewImageModalUri, setPreviewImageModalUri] = useState<string | null>(null);
  const [fullTextCopied, setFullTextCopied] = useState(false);

  // Editable Form fields
  const [medName, setMedName] = useState('');
  const [medComposition, setMedComposition] = useState('');
  const [medStrength, setMedStrength] = useState('');
  const [medForm, setMedForm] = useState<DosageForm>('tablet');
  const [medExpiry, setMedExpiry] = useState('');
  const [medBatch, setMedBatch] = useState('');
  const [medMfg, setMedMfg] = useState('');
  const [medInstructions, setMedInstructions] = useState('');
  const [medWarnings, setMedWarnings] = useState('');
  const [medCommonUses, setMedCommonUses] = useState('');

  const hasSavedMedicineRef = useRef(false);

  const handleResetAll = useCallback(() => {
    setFrontOriginalUri(null);
    setFrontCroppedUri(null);
    setBackOriginalUri(null);
    setBackCroppedUri(null);
    setSavedScanImageUri(null);
    setExtractedData(null);
    setAnalysisError(null);
    setCurrentStage('idle');
    setTargetSide('front');
    setMedName('');
    setMedComposition('');
    setMedStrength('');
    setMedForm('tablet');
    setMedExpiry('');
    setMedBatch('');
    setMedMfg('');
    setMedInstructions('');
    setMedWarnings('');
    setMedCommonUses('');
    setCurrentStep('capture');
  }, []);

  const checkPrerequisites = useCallback(async () => {
    setIsCheckingPrerequisites(true);
    const [online, key] = await Promise.all([
      networkService.checkInternet().catch((error) => {
        console.warn('Could not check internet connectivity:', error);
        return false;
      }),
      aiAssistantService.getApiKey().catch((error) => {
        console.warn('Could not read Gemini key during scan setup:', error);
        return null;
      }),
    ]);
    setIsOnline(online);
    setHasApiKey(Boolean(key));
    setIsCheckingPrerequisites(false);
  }, []);

  useFocusEffect(
    useCallback(() => {
      checkPrerequisites();
      if (hasSavedMedicineRef.current) {
        hasSavedMedicineRef.current = false;
        handleResetAll();
      }
    }, [checkPrerequisites, handleResetAll]),
  );

  const toggleFlash = () => {
    setFlashMode((prev) => (prev === 'off' ? 'on' : prev === 'on' ? 'auto' : 'off'));
  };

  // ---------------------------------------------------------------------------
  // Step 1: Capture handlers
  // ---------------------------------------------------------------------------
  const handleCapturePhoto = async () => {
    if (!permission?.granted) {
      const result = await requestPermission();
      if (!result.granted) {
        Alert.alert('Camera permission needed', 'Allow camera access to scan medication packages.');
        return;
      }
    }
    try {
      const photo = await cameraRef.current?.takePictureAsync({ quality: 1.0 });
      if (!photo?.uri) {
        Alert.alert('Camera unavailable', 'Please try again or choose a photo from your gallery.');
        return;
      }
      if (targetSide === 'front') {
        setFrontOriginalUri(photo.uri);
      } else {
        setBackOriginalUri(photo.uri);
      }
      setCurrentStep('crop');
    } catch (error) {
      console.warn('Medicine package capture failed:', error);
      Alert.alert('Capture failed', 'Please try again or choose a photo from your gallery.');
    }
  };

  const handlePickFromGallery = async (forSide: TargetSide = targetSide) => {
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsEditing: false, // We use our dedicated interactive crop screen
        quality: 1,
      });
      if (!result.canceled && result.assets && result.assets.length > 0) {
        const imageUri = result.assets[0].uri;
        if (forSide === 'front') {
          setFrontOriginalUri(imageUri);
          setTargetSide('front');
        } else {
          setBackOriginalUri(imageUri);
          setTargetSide('back');
        }
        setCurrentStep('crop');
      }
    } catch (error) {
      console.warn('Unable to select medicine image:', error);
      Alert.alert('Image selection failed', 'Please try another image.');
    }
  };

  // ---------------------------------------------------------------------------
  // Step 2: Crop handlers
  // ---------------------------------------------------------------------------
  const handleCropDone = async (options: {
    crop?: CropBounds;
    rotation: number;
    enhance: boolean;
  }) => {
    const sourceUri = targetSide === 'front' ? frontOriginalUri : backOriginalUri;
    if (!sourceUri) return;

    try {
      const cropResult = await cropAndAdjustImage(sourceUri, options);
      if (targetSide === 'front') {
        setFrontCroppedUri(cropResult.uri);
      } else {
        setBackCroppedUri(cropResult.uri);
      }
      // After cropping either front or back, go straight to review packaging
      setCurrentStep('review');
    } catch (err) {
      console.warn('Crop adjustment failed:', err);
      // Fallback: use source URI
      if (targetSide === 'front') {
        setFrontCroppedUri(sourceUri);
      } else {
        setBackCroppedUri(sourceUri);
      }
      setCurrentStep('review');
    }
  };

  const handleCropRetake = () => {
    if (targetSide === 'front') {
      setFrontOriginalUri(null);
      setFrontCroppedUri(null);
      setCurrentStep('capture');
    } else {
      setBackOriginalUri(null);
      setBackCroppedUri(null);
      setCurrentStep('review');
    }
  };

  // ---------------------------------------------------------------------------
  // Step 3: Review Handlers (Add/Edit Back, Edit Front, Retake)
  // ---------------------------------------------------------------------------
  const handleStartCaptureBack = () => {
    setTargetSide('back');
    setCurrentStep('capture');
  };

  const handleRetakeFront = () => {
    setFrontOriginalUri(null);
    setFrontCroppedUri(null);
    setTargetSide('front');
    setCurrentStep('capture');
  };

  const handleRemoveBackImage = () => {
    setBackOriginalUri(null);
    setBackCroppedUri(null);
  };

  const handleEditFrontCrop = () => {
    if (frontOriginalUri) {
      setTargetSide('front');
      setCurrentStep('crop');
    }
  };

  const handleEditBackCrop = () => {
    if (backOriginalUri) {
      setTargetSide('back');
      setCurrentStep('crop');
    }
  };

  // ---------------------------------------------------------------------------
  // Step 5: Concurrent OCR & AI Processing
  // ---------------------------------------------------------------------------
  const startAnalysis = async () => {
    if (!frontCroppedUri) {
      Alert.alert('Front image missing', 'Please capture or select the front side of the medicine.');
      setCurrentStep('capture');
      return;
    }

    setCurrentStep('analyzing');
    setAnalysisError(null);
    setCurrentStage('preparing');
    setScanStepMessage('Optimizing packaging images…');

    try {
      const result = await processMultiSideLabelImages({
        frontUri: frontCroppedUri,
        backUri: backCroppedUri || undefined,
        onProgress: (stage, msg) => {
          setCurrentStage(stage);
          if (msg) setScanStepMessage(msg);
        },
      });

      // Synchronize Gemini key state in case it was rejected
      let persistedKey: string | null = null;
      try {
        persistedKey = await aiAssistantService.getApiKey();
      } catch (keyError) {
        console.warn('Could not read saved key after scan:', keyError);
      }
      setHasApiKey(Boolean(persistedKey));

      if (result.aiWarning) {
        Alert.alert(
          'Notice',
          `${result.aiWarning}\n\nReview all extracted medicine fields carefully against your physical package.`,
        );
      }

      setExtractedData(result.extracted);
      setMedName(result.extracted.medicineName || '');
      setMedComposition(result.extracted.genericName || '');
      setMedStrength(result.extracted.detectedStrength || '');
      setMedForm(result.extracted.dosageForm || 'tablet');
      setMedExpiry(result.extracted.expiryDate || '');
      setMedBatch(result.extracted.batchNumber || '');
      setMedMfg(result.extracted.manufacturer || '');
      setMedInstructions(result.extracted.instructions || '');
      setMedWarnings(result.extracted.warnings || '');
      setMedCommonUses(result.extracted.commonUses || '');

      if (__DEV__ && result.debugPasses) {
        setDebugPasses(result.debugPasses);
      }

      // Auto-save scan entry into scan history
      try {
        let stableImageUri: string | undefined;
        try {
          stableImageUri = await saveScanImage(frontCroppedUri);
          if (stableImageUri) {
            setSavedScanImageUri(stableImageUri);
          }
        } catch (copyErr) {
          console.warn('saveScanImage copy failed:', copyErr);
        }

        scanHistoryRepository.add({
          medicineName: result.extracted.medicineName || 'Scanned Medicine',
          detectedStrength: result.extracted.detectedStrength || undefined,
          dosageForm: result.extracted.dosageForm || 'tablet',
          manufacturer: result.extracted.manufacturer || undefined,
          batchNumber: result.extracted.batchNumber || undefined,
          expiryDate: result.extracted.expiryDate || undefined,
          rawText: result.rawText,
          // Keep the history row durable. saveScanImage() deliberately returns
          // undefined on copy failure because cache/content-provider URIs can
          // disappear after the scan completes.
          imageUri: stableImageUri,
        });
      } catch (historyErr) {
        console.warn('Auto-save scan to history failed:', historyErr);
      }

      setCurrentStep('result');
    } catch (error: any) {
      console.warn('Medicine scanning analysis failed:', error);
      const isConnectionIssue =
        error instanceof OcrConnectionError ||
        error?.isConnectionError ||
        error?.name === 'OcrConnectionError' ||
        error?.message?.toLowerCase().includes('connect to internet') ||
        error?.message?.toLowerCase().includes('network request failed') ||
        error?.message?.toLowerCase().includes('failed to fetch') ||
        error?.message?.toLowerCase().includes('timeout');

      if (isConnectionIssue) {
        setAnalysisError('Internet connection required for Cloud OCR & AI analysis.');
      } else {
        setAnalysisError(
          error?.message || 'Could not read medicine details. Please try again with clearer lighting.',
        );
      }
    }
  };

  // ---------------------------------------------------------------------------
  // Step 6: Final Result Actions
  // ---------------------------------------------------------------------------
  const handleCopyFullText = async () => {
    if (!extractedData?.rawText) return;
    try {
      await Clipboard.setStringAsync(extractedData.rawText);
      setFullTextCopied(true);
      setTimeout(() => setFullTextCopied(false), 2000);
    } catch (error) {
      console.warn('Copy text failed:', error);
    }
  };

  const handleSaveToCabinet = async () => {
    if (!medName.trim()) {
      Alert.alert('Notice', 'Please provide a medicine name.');
      return;
    }

    let finalImageUri: string | null | undefined = savedScanImageUri;
    if (!finalImageUri && frontCroppedUri) {
      try {
        finalImageUri = await saveScanImage(frontCroppedUri);
      } catch (copyErr) {
        console.warn('saveScanImage copy failed in handleSaveToCabinet:', copyErr);
      }
    }

    const newMed = addMedicine({
      id: `med_${Date.now()}`,
      name: medName.trim(),
      strength: medStrength.trim() || 'Standard dose',
      dosageForm: medForm,
      category: 'Prescription',
      ingredient: medComposition.trim() || extractedData?.genericName || undefined,
      packageDetails: {
        manufacturer: medMfg || undefined,
        expiryDate: medExpiry || undefined,
        batchNumber: medBatch || undefined,
        packageDetailsText: finalImageUri || undefined,
        imageUri: finalImageUri || undefined,
        originalPackageChecked: false,
      },
      informationSource: 'Extracted from medication packaging scan.',
      isSample: false,
    });

    // Mark as saved and immediately reset scan state back to initial camera capture
    hasSavedMedicineRef.current = true;
    handleResetAll();

    // Directly navigate to the medicine's detail page
    router.push(`/medicines/${newMed.id}`);
  };

  // ---------------------------------------------------------------------------
  // Render sub-views based on active step
  // ---------------------------------------------------------------------------
  const isGating =
    currentStep === 'capture' &&
    (isCheckingPrerequisites || isOnline === false || !hasApiKey);

  return (
    <AppScreen
      scrollable={currentStep !== 'crop'}
      contentContainerStyle={[
        styles.scrollContent,
        isGating && styles.gatingScrollContent,
        currentStep === 'crop' && styles.cropScrollContent,
      ]}
    >
      {/* Header */}
      <AppHeader
        title={
          currentStep === 'capture'
            ? 'Scan Medicine'
            : currentStep === 'crop'
              ? 'Crop & Adjust'
              : currentStep === 'review'
                ? 'Review Packaging'
                : currentStep === 'analyzing'
                  ? 'Analysing'
                  : 'Scan Result'
        }
        subtitle={
          currentStep === 'capture'
            ? !hasApiKey
              ? 'Connect Personal AI to start scanning'
              : targetSide === 'front'
                ? 'Capture front of medicine package'
                : 'Capture back of package (optional)'
            : currentStep === 'crop'
              ? 'Adjust crop rectangle and orientation'
              : currentStep === 'review'
                ? 'Confirm packaging images before AI analysis'
                : currentStep === 'analyzing'
                  ? 'Reading packaging with Cloud OCR & Gemini'
                  : 'Review and verify extracted details'
        }
        brandText="HealthMate AI"
        onBackPress={
          currentStep !== 'capture'
            ? () => {
                if (currentStep === 'crop') {
                  if (targetSide === 'back') setCurrentStep('review');
                  else setCurrentStep('capture');
                } else if (currentStep === 'review') {
                  setCurrentStep('capture');
                } else if (currentStep === 'result') {
                  handleResetAll();
                } else if (currentStep === 'analyzing') {
                  setCurrentStep('review');
                }
              }
            : undefined
        }
        rightAction={
          currentStep === 'capture' ? (
            <View style={styles.headerRightActions}>
              <TouchableOpacity
                style={styles.headerAddManuallyBtn}
                onPress={() => router.push('/medicines/add')}
                activeOpacity={0.8}
              >
                <Feather name="plus" size={13} color="#FFFFFF" />
                <Text style={styles.headerAddManuallyBtnText}>Add Manually</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.historyHeaderButton}
                onPress={() => router.push('/scan-history')}
                activeOpacity={0.8}
              >
                <Feather name="clock" size={14} color={Colors.primary} />
                <Text style={styles.historyHeaderText}>History</Text>
              </TouchableOpacity>
            </View>
          ) : currentStep === 'review' ? (
            <TouchableOpacity onPress={handleResetAll} activeOpacity={0.7}>
              <Text style={styles.headerSkipText}>Reset</Text>
            </TouchableOpacity>
          ) : currentStep === 'result' ? (
            <TouchableOpacity onPress={handleResetAll} activeOpacity={0.7}>
              <Feather name="rotate-ccw" size={18} color={Colors.primary} />
            </TouchableOpacity>
          ) : undefined
        }
      />

      <View
        style={[
          styles.body,
          currentStep === 'crop' && styles.cropBody,
          isGating && styles.gatingBody,
        ]}
      >
        {/* Offline Notice banner if offline */}
        {isOnline === false && currentStep === 'capture' && hasApiKey && (
          <View style={styles.internetNoticeBanner}>
            <Ionicons name="cloud-offline-outline" size={17} color={Colors.error} />
            <Text style={styles.internetNoticeText}>
              Cloud OCR & AI require an active internet connection
            </Text>
          </View>
        )}

        {/* STEP 1: CAPTURE SCREEN */}
        {currentStep === 'capture' && (
          <>
            {isCheckingPrerequisites ? (
              <View style={styles.gatingContainer}>
                <ActivityIndicator size="large" color={Colors.primary} />
                <Text style={styles.prerequisiteTitle}>Initializing Medicine Scanner…</Text>
                <Text style={styles.prerequisiteSub}>
                  Checking network and Personal AI configuration
                </Text>
              </View>
            ) : isOnline === false ? (
              <View style={styles.gatingContainer}>
                <View style={[styles.gatingIconCircle, { backgroundColor: Colors.errorLight }]}>
                  <Ionicons name="cloud-offline-outline" size={38} color={Colors.error} />
                </View>
                <Text style={styles.gatingTitle}>Internet Connection Required</Text>
                <Text style={styles.gatingSubtitle}>
                  Cloud OCR and Personal AI need an active internet connection to scan and analyze
                  medication packaging.
                </Text>
                <View style={styles.gatingActions}>
                  <TouchableOpacity
                    style={styles.gatingPrimaryBtn}
                    onPress={checkPrerequisites}
                    activeOpacity={0.8}
                  >
                    <Feather name="refresh-cw" size={16} color="#FFFFFF" />
                    <Text style={styles.gatingPrimaryBtnText}>Retry Connection</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.gatingSecondaryBtn}
                    onPress={() => router.push('/medicines/add')}
                    activeOpacity={0.8}
                  >
                    <Feather name="plus" size={16} color={Colors.primary} />
                    <Text style={styles.gatingSecondaryBtnText}>Add Manually</Text>
                  </TouchableOpacity>
                </View>
              </View>
            ) : !hasApiKey ? (
              <View style={styles.gatingContainer}>
                <View style={[styles.gatingIconCircle, { backgroundColor: Colors.primaryLight }]}>
                  <Ionicons name="sparkles" size={40} color={Colors.primary} />
                </View>
                <Text style={styles.gatingTitle}>Unlock AI Medicine Scanner</Text>
                <Text style={styles.gatingSubtitle}>
                  Connect your Personal AI (Google Gemini) to analyze packaging, auto-detect brand &
                  generic salts, dosage form, strength, and expiry dates.
                </Text>
                <View style={styles.gatingActions}>
                  <TouchableOpacity
                    style={styles.gatingPrimaryBtn}
                    onPress={() => setShowConnectModal(true)}
                    activeOpacity={0.8}
                  >
                    <Ionicons name="sparkles" size={16} color="#FFFFFF" />
                    <Text style={styles.gatingPrimaryBtnText}>Connect Personal AI</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.gatingSecondaryBtn}
                    onPress={() => router.push('/medicines/add')}
                    activeOpacity={0.8}
                  >
                    <Feather name="plus" size={16} color={Colors.primary} />
                    <Text style={styles.gatingSecondaryBtnText}>Add Manually</Text>
                  </TouchableOpacity>
                </View>
              </View>
            ) : (
              <View style={styles.cameraContainer}>
                {permission?.granted ? (
                  <View style={styles.cameraWrapper}>
                    <CameraView
                      ref={cameraRef}
                      style={styles.cameraView}
                      facing="back"
                      flash={flashMode}
                    />

                    {/* Camera Overlay with Frame and Guidance (Positioned on top of camera) */}
                    <View style={styles.overlayFrame} pointerEvents="none">
                      {/* Side indicator badge */}
                      <View style={styles.sideIndicatorPill}>
                        <Text style={styles.sideIndicatorText}>
                          {targetSide === 'front' ? '1. Front Side' : '2. Back Side (Optional)'}
                        </Text>
                      </View>

                      {/* Corner guidance marks */}
                      <View style={styles.targetCornerTL} />
                      <View style={styles.targetCornerTR} />
                      <View style={styles.targetCornerBL} />
                      <View style={styles.targetCornerBR} />

                      <Text style={styles.overlayHint}>
                        Position the medicine package clearly and capture
                      </Text>
                    </View>
                  </View>
                ) : (
                  <View style={styles.cameraPlaceholder}>
                    <Ionicons name="camera-outline" size={48} color={Colors.primary} />
                    <Text style={styles.cameraTitle}>Camera Label Scanner</Text>
                    <Text style={styles.cameraSub}>
                      Point at medicine box, bottle, or blister pack to extract details.
                    </Text>
                    <TouchableOpacity style={styles.permissionButton} onPress={requestPermission}>
                      <Text style={styles.permissionButtonText}>Grant Camera Permission</Text>
                    </TouchableOpacity>
                  </View>
                )}

                {/* Shutter and Quick Controls Row */}
                <View style={styles.controlsRow}>
                  {/* Gallery Picker */}
                  <TouchableOpacity
                    style={styles.controlCircleBtn}
                    onPress={() => handlePickFromGallery(targetSide)}
                    activeOpacity={0.7}
                    accessibilityLabel="Choose photo from gallery"
                  >
                    <Ionicons name="images-outline" size={24} color={Colors.primary} />
                  </TouchableOpacity>

                  {/* Main Shutter Button */}
                  <TouchableOpacity
                    style={styles.shutterButton}
                    onPress={handleCapturePhoto}
                    activeOpacity={0.8}
                    accessibilityLabel="Capture medicine photo"
                  >
                    <View style={styles.shutterInner} />
                  </TouchableOpacity>

                  {/* Flash Mode Toggle */}
                  <TouchableOpacity
                    style={styles.controlCircleBtn}
                    onPress={toggleFlash}
                    activeOpacity={0.7}
                    accessibilityLabel="Toggle camera flash"
                  >
                    <Ionicons
                      name={
                        flashMode === 'on'
                          ? 'flash'
                          : flashMode === 'auto'
                            ? 'flash-outline'
                            : 'flash-off-outline'
                      }
                      size={22}
                      color={flashMode === 'off' ? Colors.textSecondary : Colors.warning}
                    />
                  </TouchableOpacity>
                </View>
              </View>
            )}
          </>
        )}

        {/* STEP 2: CROP & ADJUST SCREEN */}
        {currentStep === 'crop' && (
          <InteractiveCropView
            imageUri={(targetSide === 'front' ? frontOriginalUri : backOriginalUri) || ''}
            sideLabel={targetSide === 'front' ? 'Front Side' : 'Back Side'}
            onDone={handleCropDone}
            onRetake={handleCropRetake}
          />
        )}

        {/* STEP 3: REVIEW PACKAGING SCREEN (WITH OPTIONAL BACK SIDE) */}
        {currentStep === 'review' && (
          <View style={styles.flowSection}>
            <View style={styles.reviewBanner}>
              <Ionicons name="shield-checkmark-outline" size={20} color={Colors.primary} />
              <Text style={styles.reviewBannerText}>
                Review captured packaging photos. Processing front and back sides in parallel extracts
                complete salt composition, dosage, manufacturer, and batch details.
              </Text>
            </View>

            {/* Stacked Images Review Grid (Two Cards Top & Bottom) */}
            <View style={styles.reviewImagesGrid}>
              {/* Front Packaging Review Box */}
              <View style={styles.reviewBox}>
                <View style={styles.reviewBoxHeader}>
                  <View style={styles.reviewTitleWithBadge}>
                    <View style={styles.miniCheckDot}>
                      <Feather name="check" size={10} color="#FFFFFF" />
                    </View>
                    <Text style={styles.reviewBoxTitle}>Front Packaging</Text>
                  </View>
                  <View style={styles.reviewHeaderActions}>
                    <TouchableOpacity
                      onPress={handleEditFrontCrop}
                      activeOpacity={0.7}
                      style={styles.reviewSmallActionBtn}
                    >
                      <Feather name="crop" size={12} color={Colors.primary} />
                      <Text style={styles.reviewBoxAction}>Edit</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      onPress={handleRetakeFront}
                      activeOpacity={0.7}
                      style={[styles.reviewSmallActionBtn, styles.reviewRetakeBtn]}
                    >
                      <Feather name="refresh-cw" size={11} color={Colors.textSecondary} />
                      <Text style={[styles.reviewBoxAction, { color: Colors.textSecondary }]}>
                        Retake
                      </Text>
                    </TouchableOpacity>
                  </View>
                </View>

                {frontCroppedUri && (
                  <TouchableOpacity
                    style={styles.reviewBoxImageContainer}
                    onPress={() => setPreviewImageModalUri(frontCroppedUri)}
                    activeOpacity={0.9}
                  >
                    <Image source={{ uri: frontCroppedUri }} style={styles.reviewBoxImage} />
                    <View style={styles.zoomBadge}>
                      <Feather name="maximize-2" size={11} color="#FFFFFF" />
                    </View>
                  </TouchableOpacity>
                )}
              </View>

              {/* Back Packaging Review Box */}
              <View style={styles.reviewBox}>
                <View style={styles.reviewBoxHeader}>
                  <View style={styles.reviewTitleWithBadge}>
                    {backCroppedUri ? (
                      <View style={styles.miniCheckDot}>
                        <Feather name="check" size={10} color="#FFFFFF" />
                      </View>
                    ) : null}
                    <Text style={styles.reviewBoxTitle}>Back Packaging</Text>
                    {!backCroppedUri && (
                      <View style={styles.miniOptionalBadge}>
                        <Text style={styles.miniOptionalBadgeText}>Optional</Text>
                      </View>
                    )}
                  </View>

                  {backCroppedUri ? (
                    <View style={styles.reviewHeaderActions}>
                      <TouchableOpacity
                        onPress={handleEditBackCrop}
                        activeOpacity={0.7}
                        style={styles.reviewSmallActionBtn}
                      >
                        <Feather name="crop" size={12} color={Colors.primary} />
                        <Text style={styles.reviewBoxAction}>Edit</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        onPress={handleRemoveBackImage}
                        activeOpacity={0.7}
                        style={[styles.reviewSmallActionBtn, styles.reviewDeleteBtn]}
                      >
                        <Feather name="trash-2" size={12} color={Colors.error} />
                        <Text style={[styles.reviewBoxAction, { color: Colors.error }]}>Remove</Text>
                      </TouchableOpacity>
                    </View>
                  ) : null}
                </View>

                {backCroppedUri ? (
                  <TouchableOpacity
                    style={styles.reviewBoxImageContainer}
                    onPress={() => setPreviewImageModalUri(backCroppedUri)}
                    activeOpacity={0.9}
                  >
                    <Image source={{ uri: backCroppedUri }} style={styles.reviewBoxImage} />
                    <View style={styles.zoomBadge}>
                      <Feather name="maximize-2" size={11} color="#FFFFFF" />
                    </View>
                  </TouchableOpacity>
                ) : (
                  <View style={styles.reviewBoxEmpty}>
                    <MaterialCommunityIcons
                      name="image-plus"
                      size={30}
                      color={Colors.primary}
                      style={{ marginBottom: 4 }}
                    />
                    <Text style={styles.reviewBoxEmptyText}>Add Back Packaging</Text>
                    <Text style={styles.reviewBoxEmptySub}>
                      Captures batch number, expiry date & extra salt info
                    </Text>
                    <View style={styles.reviewEmptyBtnRow}>
                      <TouchableOpacity
                        style={styles.reviewSmallAddBtn}
                        onPress={handleStartCaptureBack}
                        activeOpacity={0.8}
                      >
                        <Ionicons name="camera-outline" size={14} color="#FFFFFF" />
                        <Text style={styles.reviewSmallAddBtnText}>Camera</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={styles.reviewSmallGalleryBtn}
                        onPress={() => handlePickFromGallery('back')}
                        activeOpacity={0.8}
                      >
                        <Ionicons name="images-outline" size={14} color={Colors.primary} />
                        <Text style={styles.reviewSmallGalleryBtnText}>Gallery</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                )}
              </View>
            </View>

            {/* Primary Action Button: Analyse Medicine */}
            <View style={styles.reviewActionContainer}>
              <AppButton
                title="Analyse Medicine"
                onPress={startAnalysis}
                variant="primary"
                size="lg"
                icon={<Ionicons name="sparkles" size={18} color="#FFFFFF" />}
              />
              <TouchableOpacity
                style={styles.cancelScanBtn}
                onPress={handleResetAll}
                activeOpacity={0.7}
              >
                <Text style={styles.cancelScanBtnText}>Start Over / Reset</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}

        {/* STEP 5: AI ANALYSIS LOADING UI */}
        {currentStep === 'analyzing' && (
          <AiAnalysisProgressView
            currentStage={currentStage}
            statusMessage={scanStepMessage}
            hasBackImage={Boolean(backCroppedUri)}
            error={analysisError}
            onRetry={startAnalysis}
            onManualEntry={() => router.push('/medicines/add')}
          />
        )}

        {/* STEP 6: FINAL STRUCTURED RESULT SCREEN */}
        {currentStep === 'result' && extractedData && (
          <View style={styles.resultContainer}>
            {/* Hero Identified Medicine Summary Card */}
            <AppCard style={styles.heroResultCard}>
              <View style={styles.heroTopRow}>
                <MedicineIcon form={medForm} name={medName} size={48} />
                <View style={styles.heroInfo}>
                  <View style={styles.statusPillRow}>
                    <View style={styles.statusPill}>
                      <Feather name="check-circle" size={12} color={Colors.successDark} />
                      <Text style={styles.statusPillText}>Identified Medicine</Text>
                    </View>
                  </View>
                  <Text style={styles.heroTitle}>{medName || 'Medicine Name'}</Text>
                  <Text style={styles.heroSub}>
                    {medStrength ? `${medStrength} · ` : ''}
                    {medForm.charAt(0).toUpperCase() + medForm.slice(1)}
                    {medMfg ? ` · ${medMfg}` : ''}
                  </Text>
                </View>
              </View>
            </AppCard>

            {/* Segmented Tabs Bar */}
            <View style={styles.segmentedTabsRow}>
              <TouchableOpacity
                style={[
                  styles.segmentedTab,
                  activeResultTab === 'overview' && styles.segmentedTabActive,
                ]}
                onPress={() => setActiveResultTab('overview')}
                activeOpacity={0.7}
              >
                <Text
                  style={[
                    styles.segmentedTabText,
                    activeResultTab === 'overview' && styles.segmentedTabTextActive,
                  ]}
                >
                  Overview
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[
                  styles.segmentedTab,
                  activeResultTab === 'safety' && styles.segmentedTabActive,
                ]}
                onPress={() => setActiveResultTab('safety')}
                activeOpacity={0.7}
              >
                <Text
                  style={[
                    styles.segmentedTabText,
                    activeResultTab === 'safety' && styles.segmentedTabTextActive,
                  ]}
                >
                  Uses & Safety
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[
                  styles.segmentedTab,
                  activeResultTab === 'raw_text' && styles.segmentedTabActive,
                ]}
                onPress={() => setActiveResultTab('raw_text')}
                activeOpacity={0.7}
              >
                <Text
                  style={[
                    styles.segmentedTabText,
                    activeResultTab === 'raw_text' && styles.segmentedTabTextActive,
                  ]}
                >
                  Label Text
                </Text>
              </TouchableOpacity>
            </View>

            {/* TAB 1: OVERVIEW & EDITABLE FIELDS */}
            {activeResultTab === 'overview' && (
              <AppCard style={styles.fieldsCard}>
                <Text style={styles.fieldLabel}>Brand Name</Text>
                <TextInput
                  style={styles.fieldInput}
                  value={medName}
                  onChangeText={setMedName}
                  placeholder="e.g. Paracetamol Tablets IP"
                  placeholderTextColor="#64748B"
                />

                {/* Candidate Suggestions if present */}
                {extractedData.candidates && extractedData.candidates.length > 1 && (
                  <View style={styles.candidatesSection}>
                    <Text style={styles.candidatesLabel}>Suggested matches:</Text>
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
                            if (cand.genericName) setMedComposition(cand.genericName);
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

                <Text style={styles.fieldLabel}>Active Salt / Generic Composition</Text>
                <TextInput
                  style={styles.fieldInput}
                  value={medComposition}
                  onChangeText={setMedComposition}
                  placeholder="e.g. Paracetamol, Amoxicillin"
                  placeholderTextColor="#64748B"
                />

                <View style={styles.divider} />

                <Text style={styles.fieldLabel}>Strength / Concentration</Text>
                <TextInput
                  style={styles.fieldInput}
                  value={medStrength}
                  onChangeText={setMedStrength}
                  placeholder="e.g. 500 mg, 10 mg/ml"
                  placeholderTextColor="#64748B"
                />

                <View style={styles.divider} />

                <Text style={styles.fieldLabel}>Dosage Form</Text>
                <TextInput
                  style={styles.fieldInput}
                  value={medForm}
                  onChangeText={(val) => setMedForm(val.toLowerCase() as DosageForm)}
                  placeholder="tablet, capsule, syrup, etc."
                  placeholderTextColor="#64748B"
                />

                <View style={styles.divider} />

                <Text style={styles.fieldLabel}>Manufacturer</Text>
                <TextInput
                  style={styles.fieldInput}
                  value={medMfg}
                  onChangeText={setMedMfg}
                  placeholder="e.g. Cipla Ltd, Pfizer"
                  placeholderTextColor="#64748B"
                />

                <View style={styles.divider} />

                <Text style={styles.fieldLabel}>Expiry Date</Text>
                <TextInput
                  style={styles.fieldInput}
                  value={medExpiry}
                  onChangeText={setMedExpiry}
                  placeholder="e.g. 12/2027"
                  placeholderTextColor="#64748B"
                />

                <View style={styles.divider} />

                <Text style={styles.fieldLabel}>Batch / Lot Number</Text>
                <TextInput
                  style={styles.fieldInput}
                  value={medBatch}
                  onChangeText={setMedBatch}
                  placeholder="e.g. DEMO-1234"
                  placeholderTextColor="#64748B"
                />
              </AppCard>
            )}

            {/* TAB 2: USES & SAFETY */}
            {activeResultTab === 'safety' && (
              <View style={styles.tabContentCol}>
                {medCommonUses ? (
                  <AppCard style={styles.infoCard}>
                    <Text style={styles.infoCardHeader}>Therapeutic Uses</Text>
                    <Text style={styles.infoCardBody}>{medCommonUses}</Text>
                  </AppCard>
                ) : null}

                {medInstructions ? (
                  <AppCard style={styles.infoCard}>
                    <Text style={styles.infoCardHeader}>Packaging Instructions</Text>
                    <Text style={styles.infoCardBody}>{medInstructions}</Text>
                  </AppCard>
                ) : null}

                {medWarnings ? (
                  <AppCard style={[styles.infoCard, styles.warningCard]}>
                    <Text style={[styles.infoCardHeader, { color: Colors.warningDark }]}>
                      Statutory Warnings & Precautions
                    </Text>
                    <Text style={styles.infoCardBody}>{medWarnings}</Text>
                  </AppCard>
                ) : null}

                <MedicalDisclaimer />
              </View>
            )}

            {/* TAB 3: FULL RAW TEXT */}
            {activeResultTab === 'raw_text' && (
              <AppCard style={styles.rawTextCard}>
                <View style={styles.rawTextHeader}>
                  <Text style={styles.rawTextTitle}>Consolidated Packaging Text</Text>
                  <TouchableOpacity
                    style={styles.copyBtn}
                    onPress={handleCopyFullText}
                    activeOpacity={0.7}
                  >
                    <Feather
                      name={fullTextCopied ? 'check' : 'copy'}
                      size={13}
                      color={fullTextCopied ? Colors.success : Colors.primary}
                    />
                    <Text style={styles.copyBtnText}>{fullTextCopied ? 'Copied' : 'Copy'}</Text>
                  </TouchableOpacity>
                </View>

                <ScrollView style={styles.rawTextScroll} nestedScrollEnabled>
                  <Text style={styles.rawTextContent} selectable>
                    {extractedData.rawText || '—'}
                  </Text>
                </ScrollView>
              </AppCard>
            )}

            {/* Images Used Section */}
            <View style={styles.imagesUsedSection}>
              <Text style={styles.imagesUsedTitle}>Images Used for Identification</Text>
              <View style={styles.imagesUsedRow}>
                {frontCroppedUri && (
                  <TouchableOpacity
                    style={styles.imageUsedCard}
                    onPress={() => setPreviewImageModalUri(frontCroppedUri)}
                    activeOpacity={0.8}
                  >
                    <Image source={{ uri: frontCroppedUri }} style={styles.imageUsedThumb} />
                    <Text style={styles.imageUsedLabel}>Front Side</Text>
                  </TouchableOpacity>
                )}
                {backCroppedUri && (
                  <TouchableOpacity
                    style={styles.imageUsedCard}
                    onPress={() => setPreviewImageModalUri(backCroppedUri)}
                    activeOpacity={0.8}
                  >
                    <Image source={{ uri: backCroppedUri }} style={styles.imageUsedThumb} />
                    <Text style={styles.imageUsedLabel}>Back Side</Text>
                  </TouchableOpacity>
                )}
              </View>
            </View>

            {/* Primary Action Buttons */}
            <View style={styles.resultActionButtons}>
              <AppButton
                title="Save to My Medicines"
                onPress={handleSaveToCabinet}
                variant="primary"
                size="lg"
                icon={<Feather name="bookmark" size={18} color="#FFFFFF" />}
              />

              <View style={styles.secondaryButtonsRow}>
                <TouchableOpacity
                  style={[styles.secondaryBtn, { flex: 1 }]}
                  onPress={handleResetAll}
                  activeOpacity={0.8}
                >
                  <Feather name="camera" size={16} color={Colors.textSecondary} />
                  <Text style={[styles.secondaryBtnText, { color: Colors.textSecondary }]}>
                    Scan Another Medicine
                  </Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        )}
      </View>

      {/* Image Preview Modal (tap thumbnail to view full image) */}
      <Modal
        visible={Boolean(previewImageModalUri)}
        transparent
        animationType="fade"
        onRequestClose={() => setPreviewImageModalUri(null)}
      >
        <View style={styles.modalBackdrop}>
          <TouchableOpacity
            style={styles.modalCloseBtn}
            onPress={() => setPreviewImageModalUri(null)}
            activeOpacity={0.8}
          >
            <Ionicons name="close" size={26} color="#FFFFFF" />
          </TouchableOpacity>
          {previewImageModalUri && (
            <Image
              source={{ uri: previewImageModalUri }}
              style={styles.modalImage}
              resizeMode="contain"
            />
          )}
        </View>
      </Modal>

      {/* Personal AI Connection Modal */}
      <ConnectGeminiModal
        visible={showConnectModal}
        onClose={() => setShowConnectModal(false)}
        onKeySaved={() => setHasApiKey(true)}
        onSuccess={() => setHasApiKey(true)}
        onDisconnected={() => setHasApiKey(false)}
      />
    </AppScreen>
  );
}

const styles = StyleSheet.create({
  scrollContent: {
    paddingBottom: 160,
  },
  cropScrollContent: {
    flex: 1,
    paddingBottom: 0,
  },
  gatingScrollContent: {
    flexGrow: 1,
    paddingBottom: 80,
  },
  body: {
    paddingHorizontal: Spacing.screenPaddingHorizontal,
  },
  cropBody: {
    flex: 1,
    paddingBottom: Spacing.xs,
  },
  gatingBody: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    minHeight: 450,
  },
  headerRightActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  headerAddManuallyBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.primary,
    paddingVertical: 5,
    paddingHorizontal: 10,
    borderRadius: Radius.pill,
    gap: 4,
  },
  headerAddManuallyBtnText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  historyHeaderButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.primaryLight,
    paddingVertical: 5,
    paddingHorizontal: 10,
    borderRadius: Radius.pill,
  },
  historyHeaderText: {
    fontSize: 13,
    fontWeight: '600',
    color: Colors.primary,
    marginLeft: 4,
  },
  headerSkipText: {
    fontSize: 14,
    fontWeight: '700',
    color: Colors.primary,
    paddingVertical: 4,
    paddingHorizontal: 8,
  },
  internetNoticeBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FEECEE',
    borderColor: '#FECACA',
    borderWidth: 1,
    borderRadius: Radius.md,
    paddingVertical: 8,
    paddingHorizontal: 12,
    marginBottom: Spacing.md,
    gap: 8,
  },
  internetNoticeText: {
    fontSize: 12,
    color: Colors.errorDark,
    fontWeight: '600',
    flex: 1,
  },
  cameraContainer: {
    alignItems: 'center',
    marginTop: Spacing.xs,
  },
  cameraWrapper: {
    width: '100%',
    height: 380,
    borderRadius: Radius.card,
    overflow: 'hidden',
    justifyContent: 'center',
    alignItems: 'center',
    position: 'relative',
  },
  cameraView: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  cameraPlaceholder: {
    width: '100%',
    height: 340,
    borderRadius: Radius.card,
    backgroundColor: '#FFFFFF',
    borderWidth: 2,
    borderStyle: 'dashed',
    borderColor: '#D0D0DC',
    justifyContent: 'center',
    alignItems: 'center',
    padding: Spacing.xl,
  },
  cameraTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: Colors.textPrimary,
    marginTop: 12,
  },
  cameraSub: {
    fontSize: 13,
    color: Colors.textSecondary,
    textAlign: 'center',
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
    fontWeight: '600',
    fontSize: 14,
  },
  overlayFrame: {
    width: '84%',
    height: '68%',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.45)',
    borderRadius: Radius.card,
    justifyContent: 'center',
    alignItems: 'center',
  },
  sideIndicatorPill: {
    position: 'absolute',
    top: 12,
    backgroundColor: 'rgba(0, 0, 0, 0.65)',
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: Radius.pill,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.25)',
  },
  sideIndicatorText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  targetCornerTL: {
    position: 'absolute',
    top: -2,
    left: -2,
    width: 24,
    height: 24,
    borderTopWidth: 4,
    borderLeftWidth: 4,
    borderColor: Colors.primary,
  },
  targetCornerTR: {
    position: 'absolute',
    top: -2,
    right: -2,
    width: 24,
    height: 24,
    borderTopWidth: 4,
    borderRightWidth: 4,
    borderColor: Colors.primary,
  },
  targetCornerBL: {
    position: 'absolute',
    bottom: -2,
    left: -2,
    width: 24,
    height: 24,
    borderBottomWidth: 4,
    borderLeftWidth: 4,
    borderColor: Colors.primary,
  },
  targetCornerBR: {
    position: 'absolute',
    bottom: -2,
    right: -2,
    width: 24,
    height: 24,
    borderBottomWidth: 4,
    borderRightWidth: 4,
    borderColor: Colors.primary,
  },
  overlayHint: {
    position: 'absolute',
    bottom: 12,
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '600',
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    paddingVertical: 4,
    paddingHorizontal: 12,
    borderRadius: Radius.pill,
  },
  controlsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
    width: '100%',
    marginTop: Spacing.xl,
    paddingHorizontal: 10,
  },
  controlCircleBtn: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: Colors.border,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 3,
    elevation: 1,
  },
  shutterButton: {
    width: 76,
    height: 76,
    borderRadius: 38,
    borderWidth: 4,
    borderColor: Colors.primary,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    shadowColor: Colors.primary,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 6,
    elevation: 4,
  },
  shutterInner: {
    width: 58,
    height: 58,
    borderRadius: 29,
    backgroundColor: Colors.primary,
  },
  gatingContainer: {
    width: '100%',
    maxWidth: 360,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.md,
  },
  gatingIconCircle: {
    width: 80,
    height: 80,
    borderRadius: 40,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: Spacing.md,
  },
  gatingTitle: {
    fontSize: 22,
    fontWeight: '700',
    color: Colors.textPrimary,
    textAlign: 'center',
    marginBottom: Spacing.xs,
  },
  gatingSubtitle: {
    fontSize: 14,
    lineHeight: 21,
    color: Colors.textSecondary,
    textAlign: 'center',
    marginBottom: Spacing.xl,
    paddingHorizontal: Spacing.xs,
  },
  gatingActions: {
    width: '100%',
    maxWidth: 320,
    gap: Spacing.sm,
    alignItems: 'center',
  },
  gatingPrimaryBtn: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.sm,
    backgroundColor: Colors.primary,
    borderRadius: Radius.pill,
    paddingVertical: 14,
    ...Shadows.subtle,
  },
  gatingPrimaryBtnText: {
    fontSize: 15.5,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  gatingSecondaryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.md,
  },
  gatingSecondaryBtnText: {
    fontSize: 15,
    fontWeight: '600',
    color: Colors.primary,
  },
  prerequisiteTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: Colors.textPrimary,
    marginTop: Spacing.md,
    textAlign: 'center',
  },
  prerequisiteSub: {
    fontSize: 13,
    color: Colors.textSecondary,
    marginTop: Spacing.xs,
    textAlign: 'center',
  },
  flowSection: {
    marginTop: Spacing.xs,
  },
  benefitBanner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: '#F0F7FF',
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: '#D0E7FC',
    padding: 12,
    marginBottom: Spacing.md,
    gap: 8,
  },
  benefitBannerText: {
    flex: 1,
    fontSize: 12,
    lineHeight: 17,
    color: '#1E40AF',
  },
  sideCard: {
    marginBottom: Spacing.md,
    padding: Spacing.cardPadding,
  },
  sideCardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  sideBadgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  sideCheckDot: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: Colors.success,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sideCardTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: Colors.textPrimary,
  },
  optionalBadge: {
    backgroundColor: '#F1F1F5',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: Radius.pill,
  },
  optionalBadgeText: {
    fontSize: 11,
    fontWeight: '600',
    color: Colors.textSecondary,
  },
  sideActionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: 4,
    paddingHorizontal: 8,
  },
  sideActionBtnText: {
    fontSize: 13,
    fontWeight: '600',
    color: Colors.primary,
  },
  backActionsGroup: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  previewImageContainer: {
    width: '100%',
    height: 180,
    backgroundColor: '#F8F8FC',
    borderRadius: Radius.md,
    overflow: 'hidden',
  },
  previewImageThumb: {
    width: '100%',
    height: '100%',
    resizeMode: 'cover',
  },
  addBackPlaceholder: {
    width: '100%',
    height: 170,
    borderWidth: 2,
    borderStyle: 'dashed',
    borderColor: '#D5D5DF',
    borderRadius: Radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    padding: Spacing.md,
    backgroundColor: '#FAFAFD',
  },
  addBackTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: Colors.textPrimary,
  },
  addBackSub: {
    fontSize: 12,
    color: Colors.textSecondary,
    textAlign: 'center',
    marginTop: 2,
    marginBottom: 12,
  },
  addBackButtonsRow: {
    flexDirection: 'row',
    gap: 10,
  },
  addBackPrimaryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.primary,
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: Radius.pill,
    gap: 6,
  },
  addBackPrimaryBtnText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  addBackSecondaryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: Colors.border,
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: Radius.pill,
    gap: 6,
  },
  addBackSecondaryBtnText: {
    fontSize: 13,
    fontWeight: '600',
    color: Colors.primary,
  },
  addBackFooter: {
    marginTop: Spacing.sm,
  },
  reviewBanner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: '#E8F4FF',
    borderRadius: Radius.md,
    padding: 12,
    marginBottom: Spacing.md,
    gap: 8,
  },
  reviewBannerText: {
    flex: 1,
    fontSize: 12,
    lineHeight: 17,
    color: '#0369A1',
  },
  reviewImagesGrid: {
    flexDirection: 'column',
    gap: 16,
    marginBottom: Spacing.md,
  },
  reviewBox: {
    width: '100%',
    backgroundColor: Colors.cardBackground,
    borderRadius: Radius.card,
    padding: Spacing.md,
    borderWidth: 1,
    borderColor: Colors.borderLight,
    ...Shadows.card,
  },
  reviewBoxHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
    minHeight: 28,
  },
  reviewTitleWithBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  miniCheckDot: {
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: Colors.success,
    alignItems: 'center',
    justifyContent: 'center',
  },
  reviewBoxTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: Colors.textPrimary,
  },
  miniOptionalBadge: {
    backgroundColor: '#F1F1F5',
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: Radius.pill,
  },
  miniOptionalBadgeText: {
    fontSize: 11,
    fontWeight: '600',
    color: Colors.textSecondary,
  },
  reviewHeaderActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  reviewSmallActionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: 4,
    paddingHorizontal: 8,
    borderRadius: Radius.pill,
    backgroundColor: '#EFF6FF',
  },
  reviewRetakeBtn: {
    backgroundColor: '#F1F5F9',
  },
  reviewDeleteBtn: {
    backgroundColor: '#FEF2F2',
  },
  reviewBoxAction: {
    fontSize: 12,
    fontWeight: '600',
    color: Colors.primary,
  },
  reviewBoxImageContainer: {
    width: '100%',
    height: 200,
    borderRadius: Radius.md,
    overflow: 'hidden',
    position: 'relative',
    backgroundColor: '#F8F8FC',
  },
  reviewBoxImage: {
    width: '100%',
    height: '100%',
    resizeMode: 'cover',
  },
  zoomBadge: {
    position: 'absolute',
    bottom: 8,
    right: 8,
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    padding: 6,
    borderRadius: 6,
  },
  reviewBoxEmpty: {
    width: '100%',
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: '#D0D0DC',
    borderRadius: Radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FAFAFD',
    paddingVertical: 18,
    paddingHorizontal: 16,
  },
  reviewBoxEmptyText: {
    fontSize: 14,
    color: Colors.textPrimary,
    fontWeight: '700',
    marginTop: 2,
  },
  reviewBoxEmptySub: {
    fontSize: 12,
    color: Colors.textSecondary,
    textAlign: 'center',
    marginTop: 2,
    marginBottom: 12,
  },
  reviewEmptyBtnRow: {
    flexDirection: 'row',
    gap: 12,
    maxWidth: 280,
    width: '100%',
  },
  reviewSmallAddBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.primary,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: Radius.pill,
    gap: 5,
  },
  reviewSmallAddBtnText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  reviewSmallGalleryBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: Colors.border,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: Radius.pill,
    gap: 5,
  },
  reviewSmallGalleryBtnText: {
    fontSize: 12,
    fontWeight: '600',
    color: Colors.primary,
  },
  reviewActionContainer: {
    marginTop: Spacing.xs,
    gap: 12,
  },
  cancelScanBtn: {
    alignItems: 'center',
    paddingVertical: 10,
  },
  cancelScanBtnText: {
    fontSize: 14,
    color: Colors.textSecondary,
    fontWeight: '600',
  },
  resultContainer: {
    marginTop: Spacing.xs,
  },
  heroResultCard: {
    marginBottom: Spacing.md,
    padding: Spacing.cardPadding,
  },
  heroTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
  },
  heroInfo: {
    flex: 1,
  },
  statusPillRow: {
    flexDirection: 'row',
    marginBottom: 4,
  },
  statusPill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.successLight,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: Radius.pill,
    gap: 4,
  },
  statusPillText: {
    fontSize: 11,
    fontWeight: '700',
    color: Colors.successDark,
  },
  heroTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: Colors.textPrimary,
  },
  heroSub: {
    fontSize: 13,
    color: Colors.textSecondary,
    marginTop: 2,
  },
  segmentedTabsRow: {
    flexDirection: 'row',
    backgroundColor: '#EAE9F0',
    borderRadius: Radius.pill,
    padding: 3,
    marginBottom: Spacing.md,
  },
  segmentedTab: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 7,
    borderRadius: Radius.pill,
  },
  segmentedTabActive: {
    backgroundColor: '#FFFFFF',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 2,
  },
  segmentedTabText: {
    fontSize: 13,
    fontWeight: '600',
    color: Colors.textSecondary,
  },
  segmentedTabTextActive: {
    color: Colors.primary,
    fontWeight: '700',
  },
  fieldsCard: {
    marginBottom: Spacing.md,
    padding: Spacing.cardPadding,
  },
  fieldLabel: {
    fontSize: 12,
    fontWeight: '600',
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
  candidatesSection: {
    marginTop: 6,
    marginBottom: 4,
  },
  candidatesLabel: {
    fontSize: 11,
    fontWeight: '600',
    color: '#64748B',
    marginBottom: 6,
  },
  candidatesRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  candidateChip: {
    backgroundColor: '#F1F5F9',
    paddingVertical: 5,
    paddingHorizontal: 10,
    borderRadius: Radius.pill,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  candidateChipActive: {
    backgroundColor: Colors.primaryLight,
    borderColor: Colors.primary,
  },
  candidateChipText: {
    fontSize: 12,
    color: '#475569',
    fontWeight: '500',
  },
  candidateChipTextActive: {
    color: Colors.primary,
    fontWeight: '700',
  },
  tabContentCol: {
    gap: Spacing.md,
    marginBottom: Spacing.md,
  },
  infoCard: {
    padding: Spacing.cardPadding,
  },
  infoCardHeader: {
    fontSize: 14,
    fontWeight: '700',
    color: Colors.textPrimary,
    marginBottom: 6,
  },
  infoCardBody: {
    fontSize: 13,
    color: Colors.textSecondary,
    lineHeight: 19,
  },
  warningCard: {
    backgroundColor: '#FFF8EC',
    borderColor: '#FDE4BC',
    borderWidth: 1,
  },
  rawTextCard: {
    padding: Spacing.cardPadding,
    marginBottom: Spacing.md,
  },
  rawTextHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  rawTextTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: Colors.textPrimary,
  },
  copyBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#F1F5F9',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: Radius.pill,
  },
  copyBtnText: {
    fontSize: 12,
    color: Colors.primary,
    fontWeight: '600',
  },
  rawTextScroll: {
    maxHeight: 180,
    backgroundColor: '#F8F8FC',
    borderRadius: Radius.sm,
    padding: 10,
    borderWidth: 1,
    borderColor: '#F3F2F6',
  },
  rawTextContent: {
    fontSize: 12,
    color: Colors.textPrimary,
    lineHeight: 18,
  },
  imagesUsedSection: {
    marginBottom: Spacing.lg,
  },
  imagesUsedTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: Colors.textPrimary,
    marginBottom: 8,
  },
  imagesUsedRow: {
    flexDirection: 'row',
    gap: 12,
  },
  imageUsedCard: {
    width: 100,
    alignItems: 'center',
  },
  imageUsedThumb: {
    width: 100,
    height: 75,
    borderRadius: Radius.sm,
    backgroundColor: '#EAE9F0',
    marginBottom: 4,
  },
  imageUsedLabel: {
    fontSize: 11,
    color: Colors.textSecondary,
    fontWeight: '600',
  },
  resultActionButtons: {
    gap: 10,
  },
  secondaryButtonsRow: {
    flexDirection: 'row',
    gap: 10,
  },
  secondaryBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: Colors.border,
    paddingVertical: 12,
    borderRadius: Radius.md,
    gap: 6,
  },
  secondaryBtnText: {
    fontSize: 14,
    fontWeight: '600',
    color: Colors.primary,
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.92)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalCloseBtn: {
    position: 'absolute',
    top: 48,
    right: 20,
    zIndex: 10,
    padding: 8,
  },
  modalImage: {
    width: '92%',
    height: '75%',
  },
});
