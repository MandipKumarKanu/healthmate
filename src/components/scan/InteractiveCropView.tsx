import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import {
  StyleSheet,
  View,
  Text,
  Image,
  TouchableOpacity,
  GestureResponderEvent,
  LayoutChangeEvent,
} from 'react-native';
import { Feather, Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { Colors } from '../../theme/colors';
import { Radius, Spacing } from '../../theme/tokens';
import { AppButton } from '../ui/AppButton';
import { CropBounds, getImageDimensions } from '../../services/imageCropService';

interface InteractiveCropViewProps {
  imageUri: string;
  sideLabel?: string;
  onDone: (options: { crop?: CropBounds; rotation: number; enhance: boolean }) => void;
  onRetake: () => void;
}

const CORNER_HANDLE_SIZE = 28;
const MIN_CROP_DIMENSION = 50;

export function InteractiveCropView({
  imageUri,
  sideLabel = 'Front Side',
  onDone,
  onRetake,
}: InteractiveCropViewProps) {
  const [naturalDimensions, setNaturalDimensions] = useState<{ width: number; height: number }>({
    width: 0,
    height: 0,
  });
  const [containerLayout, setContainerLayout] = useState<{ width: number; height: number }>({
    width: 0,
    height: 0,
  });
  const [rotation, setRotation] = useState<number>(0);
  const [enhance, setEnhance] = useState<boolean>(false);

  // Active crop frame in container pixel coordinates
  const [cropBox, setCropBox] = useState<{ x: number; y: number; width: number; height: number }>({
    x: 0,
    y: 0,
    width: 0,
    height: 0,
  });

  // Load natural dimensions on uri change
  useEffect(() => {
    let isMounted = true;
    getImageDimensions(imageUri).then((dims) => {
      if (isMounted && dims.width > 0 && dims.height > 0) {
        setNaturalDimensions(dims);
      }
    });
    return () => {
      isMounted = false;
    };
  }, [imageUri]);

  // Adjust dimensions when rotated 90 or 270 degrees
  const isTransposed = rotation === 90 || rotation === 270;
  const currentImageWidth = isTransposed ? naturalDimensions.height : naturalDimensions.width;
  const currentImageHeight = isTransposed ? naturalDimensions.width : naturalDimensions.height;

  // Compute rendered image bounds inside preview container
  const imageDisplayRect = useMemo(() => {
    if (
      containerLayout.width <= 0 ||
      containerLayout.height <= 0 ||
      currentImageWidth <= 0 ||
      currentImageHeight <= 0
    ) {
      return { x: 0, y: 0, width: 0, height: 0, scale: 1 };
    }

    const scale = Math.min(
      containerLayout.width / currentImageWidth,
      containerLayout.height / currentImageHeight,
    );
    const displayWidth = currentImageWidth * scale;
    const displayHeight = currentImageHeight * scale;
    const offsetX = (containerLayout.width - displayWidth) / 2;
    const offsetY = (containerLayout.height - displayHeight) / 2;

    return {
      x: offsetX,
      y: offsetY,
      width: displayWidth,
      height: displayHeight,
      scale,
    };
  }, [containerLayout, currentImageWidth, currentImageHeight]);

  // Initialize or reset crop box to 90% inset of displayed image
  const resetCropToDefault = useCallback(() => {
    if (imageDisplayRect.width <= 0 || imageDisplayRect.height <= 0) return;
    const marginX = Math.round(imageDisplayRect.width * 0.05);
    const marginY = Math.round(imageDisplayRect.height * 0.05);
    setCropBox({
      x: imageDisplayRect.x + marginX,
      y: imageDisplayRect.y + marginY,
      width: Math.max(imageDisplayRect.width - marginX * 2, MIN_CROP_DIMENSION),
      height: Math.max(imageDisplayRect.height - marginY * 2, MIN_CROP_DIMENSION),
    });
  }, [imageDisplayRect]);

  // Reset crop whenever image display rect changes
  useEffect(() => {
    resetCropToDefault();
  }, [resetCropToDefault]);

  // Gestures via native Responder system
  const dragStartPos = useRef({ pageX: 0, pageY: 0 });
  const startBoxRef = useRef({ x: 0, y: 0, width: 0, height: 0 });

  const clamp = (val: number, min: number, max: number) => Math.max(min, Math.min(val, max));

  const handleGrant = (evt: GestureResponderEvent) => {
    dragStartPos.current = { pageX: evt.nativeEvent.pageX, pageY: evt.nativeEvent.pageY };
    startBoxRef.current = { ...cropBox };
  };

  const handleMove = (
    handle: 'tl' | 'tr' | 'bl' | 'br' | 'body',
    evt: GestureResponderEvent,
  ) => {
    const dx = evt.nativeEvent.pageX - dragStartPos.current.pageX;
    const dy = evt.nativeEvent.pageY - dragStartPos.current.pageY;
    const start = startBoxRef.current;
    const imgBounds = imageDisplayRect;
    const maxX = imgBounds.x + imgBounds.width;
    const maxY = imgBounds.y + imgBounds.height;

    let newX = start.x;
    let newY = start.y;
    let newW = start.width;
    let newH = start.height;

    if (handle === 'body') {
      newX = clamp(start.x + dx, imgBounds.x, maxX - start.width);
      newY = clamp(start.y + dy, imgBounds.y, maxY - start.height);
      setCropBox({ x: newX, y: newY, width: newW, height: newH });
      return;
    }

    if (handle === 'tl') {
      newX = clamp(start.x + dx, imgBounds.x, start.x + start.width - MIN_CROP_DIMENSION);
      newY = clamp(start.y + dy, imgBounds.y, start.y + start.height - MIN_CROP_DIMENSION);
      newW = start.width - (newX - start.x);
      newH = start.height - (newY - start.y);
    } else if (handle === 'tr') {
      const right = clamp(start.x + start.width + dx, start.x + MIN_CROP_DIMENSION, maxX);
      newY = clamp(start.y + dy, imgBounds.y, start.y + start.height - MIN_CROP_DIMENSION);
      newW = right - start.x;
      newH = start.height - (newY - start.y);
    } else if (handle === 'bl') {
      newX = clamp(start.x + dx, imgBounds.x, start.x + start.width - MIN_CROP_DIMENSION);
      const bottom = clamp(start.y + start.height + dy, start.y + MIN_CROP_DIMENSION, maxY);
      newW = start.width - (newX - start.x);
      newH = bottom - start.y;
    } else if (handle === 'br') {
      const right = clamp(start.x + start.width + dx, start.x + MIN_CROP_DIMENSION, maxX);
      const bottom = clamp(start.y + start.height + dy, start.y + MIN_CROP_DIMENSION, maxY);
      newW = right - start.x;
      newH = bottom - start.y;
    }

    setCropBox({ x: newX, y: newY, width: newW, height: newH });
  };

  const handleRotate = () => {
    setRotation((prev) => (prev + 90) % 360);
  };

  const handleToggleEnhance = () => {
    setEnhance((prev) => !prev);
  };

  const handleReset = () => {
    setRotation(0);
    setEnhance(false);
    resetCropToDefault();
  };

  const handleApplyDone = () => {
    if (imageDisplayRect.scale <= 0) {
      onDone({ rotation, enhance });
      return;
    }

    // Convert cropBox from display space to image pixel space
    const originX = Math.max(0, Math.round((cropBox.x - imageDisplayRect.x) / imageDisplayRect.scale));
    const originY = Math.max(0, Math.round((cropBox.y - imageDisplayRect.y) / imageDisplayRect.scale));
    const width = Math.min(
      currentImageWidth - originX,
      Math.round(cropBox.width / imageDisplayRect.scale),
    );
    const height = Math.min(
      currentImageHeight - originY,
      Math.round(cropBox.height / imageDisplayRect.scale),
    );

    const isFullImage =
      originX <= 2 &&
      originY <= 2 &&
      width >= currentImageWidth - 4 &&
      height >= currentImageHeight - 4;

    onDone({
      crop: isFullImage ? undefined : { originX, originY, width, height },
      rotation,
      enhance,
    });
  };

  return (
    <View style={styles.container}>
      {/* Top Banner with side indicator and instructions */}
      <View style={styles.topInfoBar}>
        <View style={styles.sideBadge}>
          <Text style={styles.sideBadgeText}>{sideLabel}</Text>
        </View>
        <Text style={styles.instructionText}>
          Drag corners to adjust boundaries around medicine package
        </Text>
      </View>

      {/* Main Image Viewport with Scrim & Crop Box */}
      <View
        style={styles.viewport}
        onLayout={(evt: LayoutChangeEvent) => {
          const { width, height } = evt.nativeEvent.layout;
          setContainerLayout({ width, height });
        }}
      >
        {imageDisplayRect.width > 0 && (
          <Image
            source={{ uri: imageUri }}
            style={[
              styles.displayImage,
              {
                width: imageDisplayRect.width,
                height: imageDisplayRect.height,
                left: imageDisplayRect.x,
                top: imageDisplayRect.y,
                transform: [{ rotate: `${rotation}deg` }],
              },
            ]}
            resizeMode="contain"
          />
        )}

        {/* Dark Scrim overlay around crop box */}
        {cropBox.width > 0 && (
          <>
            {/* Top scrim */}
            <View
              style={[
                styles.scrim,
                {
                  top: 0,
                  left: 0,
                  right: 0,
                  height: cropBox.y,
                },
              ]}
            />
            {/* Bottom scrim */}
            <View
              style={[
                styles.scrim,
                {
                  top: cropBox.y + cropBox.height,
                  left: 0,
                  right: 0,
                  bottom: 0,
                },
              ]}
            />
            {/* Left scrim */}
            <View
              style={[
                styles.scrim,
                {
                  top: cropBox.y,
                  left: 0,
                  width: cropBox.x,
                  height: cropBox.height,
                },
              ]}
            />
            {/* Right scrim */}
            <View
              style={[
                styles.scrim,
                {
                  top: cropBox.y,
                  left: cropBox.x + cropBox.width,
                  right: 0,
                  height: cropBox.height,
                },
              ]}
            />

            {/* Active Crop Box */}
            <View
              style={[
                styles.cropBox,
                {
                  left: cropBox.x,
                  top: cropBox.y,
                  width: cropBox.width,
                  height: cropBox.height,
                },
              ]}
            >
              {/* Internal 3x3 grid lines with body drag handler */}
              <View
                style={styles.gridContainer}
                onStartShouldSetResponder={() => true}
                onMoveShouldSetResponder={() => true}
                onResponderTerminationRequest={() => false}
                onResponderGrant={handleGrant}
                onResponderMove={(e) => handleMove('body', e)}
              >
                <View style={[styles.gridLineH, { top: '33.3%' }]} pointerEvents="none" />
                <View style={[styles.gridLineH, { top: '66.6%' }]} pointerEvents="none" />
                <View style={[styles.gridLineV, { left: '33.3%' }]} pointerEvents="none" />
                <View style={[styles.gridLineV, { left: '66.6%' }]} pointerEvents="none" />
              </View>

              {/* Corner accents */}
              <View style={[styles.cornerAccent, styles.cornerTL]} pointerEvents="none" />
              <View style={[styles.cornerAccent, styles.cornerTR]} pointerEvents="none" />
              <View style={[styles.cornerAccent, styles.cornerBL]} pointerEvents="none" />
              <View style={[styles.cornerAccent, styles.cornerBR]} pointerEvents="none" />

              {/* Interactive Corner Drag Handles */}
              <View
                style={[
                  styles.handleContainer,
                  { top: -CORNER_HANDLE_SIZE / 2, left: -CORNER_HANDLE_SIZE / 2 },
                ]}
                onStartShouldSetResponder={() => true}
                onMoveShouldSetResponder={() => true}
                onResponderTerminationRequest={() => false}
                onResponderGrant={handleGrant}
                onResponderMove={(e) => handleMove('tl', e)}
              >
                <View style={styles.handleDot} />
              </View>
              <View
                style={[
                  styles.handleContainer,
                  { top: -CORNER_HANDLE_SIZE / 2, right: -CORNER_HANDLE_SIZE / 2 },
                ]}
                onStartShouldSetResponder={() => true}
                onMoveShouldSetResponder={() => true}
                onResponderTerminationRequest={() => false}
                onResponderGrant={handleGrant}
                onResponderMove={(e) => handleMove('tr', e)}
              >
                <View style={styles.handleDot} />
              </View>
              <View
                style={[
                  styles.handleContainer,
                  { bottom: -CORNER_HANDLE_SIZE / 2, left: -CORNER_HANDLE_SIZE / 2 },
                ]}
                onStartShouldSetResponder={() => true}
                onMoveShouldSetResponder={() => true}
                onResponderTerminationRequest={() => false}
                onResponderGrant={handleGrant}
                onResponderMove={(e) => handleMove('bl', e)}
              >
                <View style={styles.handleDot} />
              </View>
              <View
                style={[
                  styles.handleContainer,
                  { bottom: -CORNER_HANDLE_SIZE / 2, right: -CORNER_HANDLE_SIZE / 2 },
                ]}
                onStartShouldSetResponder={() => true}
                onMoveShouldSetResponder={() => true}
                onResponderTerminationRequest={() => false}
                onResponderGrant={handleGrant}
                onResponderMove={(e) => handleMove('br', e)}
              >
                <View style={styles.handleDot} />
              </View>
            </View>
          </>
        )}

        {/* Enhance Mode Active Badge */}
        {enhance && (
          <View style={styles.enhanceActiveBadge} pointerEvents="none">
            <MaterialCommunityIcons name="auto-fix" size={13} color="#FFFFFF" />
            <Text style={styles.enhanceActiveBadgeText}>Contrast & Low-light Boost Active</Text>
          </View>
        )}
      </View>

      {/* Adjustment Tools Toolbar */}
      <View style={styles.toolsRow}>
        <TouchableOpacity style={styles.toolButton} onPress={resetCropToDefault} activeOpacity={0.7}>
          <MaterialCommunityIcons name="crop" size={20} color={Colors.primary} />
          <Text style={styles.toolButtonText}>Auto Fit</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.toolButton} onPress={handleRotate} activeOpacity={0.7}>
          <Feather name="rotate-cw" size={19} color={Colors.textPrimary} />
          <Text style={styles.toolButtonText}>Rotate</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.toolButton, enhance && styles.toolButtonActive]}
          onPress={handleToggleEnhance}
          activeOpacity={0.7}
        >
          <MaterialCommunityIcons
            name="auto-fix"
            size={20}
            color={enhance ? Colors.primary : Colors.textPrimary}
          />
          <Text style={[styles.toolButtonText, enhance && styles.toolButtonTextActive]}>
            {enhance ? 'Enhanced' : 'Enhance'}
          </Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.toolButton} onPress={handleReset} activeOpacity={0.7}>
          <Ionicons name="refresh" size={19} color={Colors.textSecondary} />
          <Text style={styles.toolButtonText}>Reset</Text>
        </TouchableOpacity>
      </View>

      {/* Action Footer: Retake & Done */}
      <View style={styles.footerRow}>
        <TouchableOpacity style={styles.retakeButton} onPress={onRetake} activeOpacity={0.8}>
          <Feather name="arrow-left" size={16} color={Colors.textPrimary} />
          <Text style={styles.retakeButtonText}>Retake</Text>
        </TouchableOpacity>

        <View style={styles.doneButtonWrapper}>
          <AppButton
            title="Done"
            onPress={handleApplyDone}
            variant="primary"
            size="lg"
            icon={<Feather name="check" size={18} color="#FFFFFF" />}
          />
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    width: '100%',
    alignItems: 'center',
  },
  topInfoBar: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: Spacing.sm,
    gap: 8,
  },
  sideBadge: {
    backgroundColor: Colors.primaryLight,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: Radius.pill,
  },
  sideBadgeText: {
    fontSize: 12,
    fontWeight: '700',
    color: Colors.primary,
  },
  instructionText: {
    fontSize: 12,
    color: Colors.textSecondary,
    flex: 1,
    lineHeight: 16,
  },
  viewport: {
    width: '100%',
    height: 400,
    backgroundColor: '#0F1115',
    borderRadius: Radius.card,
    overflow: 'hidden',
    position: 'relative',
  },
  displayImage: {
    position: 'absolute',
  },
  scrim: {
    position: 'absolute',
    backgroundColor: 'rgba(0, 0, 0, 0.58)',
  },
  cropBox: {
    position: 'absolute',
    borderWidth: 1.5,
    borderColor: Colors.primary,
  },
  gridContainer: {
    flex: 1,
    position: 'relative',
  },
  gridLineH: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: 1,
    backgroundColor: 'rgba(255, 255, 255, 0.3)',
  },
  gridLineV: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: 1,
    backgroundColor: 'rgba(255, 255, 255, 0.3)',
  },
  cornerAccent: {
    position: 'absolute',
    width: 16,
    height: 16,
    borderColor: Colors.primary,
  },
  cornerTL: {
    top: -2,
    left: -2,
    borderTopWidth: 3.5,
    borderLeftWidth: 3.5,
  },
  cornerTR: {
    top: -2,
    right: -2,
    borderTopWidth: 3.5,
    borderRightWidth: 3.5,
  },
  cornerBL: {
    bottom: -2,
    left: -2,
    borderBottomWidth: 3.5,
    borderLeftWidth: 3.5,
  },
  cornerBR: {
    bottom: -2,
    right: -2,
    borderBottomWidth: 3.5,
    borderRightWidth: 3.5,
  },
  handleContainer: {
    position: 'absolute',
    width: CORNER_HANDLE_SIZE,
    height: CORNER_HANDLE_SIZE,
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 10,
  },
  handleDot: {
    width: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: Colors.primary,
    borderWidth: 2,
    borderColor: '#FFFFFF',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.3,
    shadowRadius: 2,
    elevation: 3,
  },
  toolsRow: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    width: '100%',
    backgroundColor: Colors.cardBackground,
    borderRadius: Radius.card,
    paddingVertical: Spacing.md,
    marginTop: Spacing.md,
    borderWidth: 1,
    borderColor: Colors.borderLight,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 4,
    elevation: 1,
  },
  toolButton: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: Radius.sm,
  },
  toolButtonActive: {
    backgroundColor: Colors.primaryLight,
  },
  toolButtonText: {
    fontSize: 12,
    fontWeight: '600',
    color: Colors.textSecondary,
  },
  toolButtonTextActive: {
    color: Colors.primary,
    fontWeight: '700',
  },
  footerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    width: '100%',
    marginTop: Spacing.lg,
    gap: 12,
  },
  retakeButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
    paddingHorizontal: 18,
    borderRadius: Radius.md,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: Colors.border,
    gap: 6,
  },
  retakeButtonText: {
    fontSize: 15,
    fontWeight: '600',
    color: Colors.textPrimary,
  },
  doneButtonWrapper: {
    flex: 1,
  },
  enhanceActiveBadge: {
    position: 'absolute',
    top: 12,
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(7, 136, 245, 0.90)',
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: Radius.pill,
    gap: 6,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
    elevation: 4,
  },
  enhanceActiveBadgeText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#FFFFFF',
  },
});
