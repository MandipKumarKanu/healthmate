import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { calculatePresetCrop, cropAndAdjustImage } from '../src/services/imageCropService';
import {
  processMultiSideLabelImages,
  processLabelImage,
  ScanStage,
} from '../src/services/ocrRecognition';
import * as remoteOcrModule from '../src/services/remoteOcrService';
import { aiAssistantService } from '../src/services/aiAssistantService';

jest.mock('../src/services/imagePreProcessing', () => ({
  prepareImageForOcr: jest.fn(async (uri: string) => ({
    uri: `${uri}_prepared`,
    processed: true,
    width: 1000,
    height: 800,
  })),
  enhanceImageForOcr: jest.fn(async (uri: string) => ({
    uri: `${uri}_enhanced`,
    processed: true,
    width: 1000,
    height: 800,
  })),
}));

jest.mock('expo-image-manipulator', () => ({
  SaveFormat: { JPEG: 'jpeg', PNG: 'png' },
  manipulateAsync: jest.fn(async (uri: string, actions: any[]) => {
    return {
      uri: `${uri}_manipulated`,
      width: 800,
      height: 600,
    };
  }),
}));

describe('CamScanner Multi-Side Scanning & Crop Pipeline', () => {
  describe('calculatePresetCrop', () => {
    it('calculates full image bounds correctly', () => {
      const bounds = calculatePresetCrop(1000, 800, 'full');
      expect(bounds).toEqual({ originX: 0, originY: 0, width: 1000, height: 800 });
    });

    it('calculates 5% auto margin bounds correctly', () => {
      const bounds = calculatePresetCrop(1000, 800, 'auto');
      expect(bounds.originX).toBe(50);
      expect(bounds.originY).toBe(40);
      expect(bounds.width).toBe(900);
      expect(bounds.height).toBe(720);
    });

    it('calculates 4:3 centered crop within image boundaries', () => {
      const bounds = calculatePresetCrop(1000, 800, 'aspect_4_3');
      expect(bounds.originX).toBeGreaterThanOrEqual(0);
      expect(bounds.originY).toBeGreaterThanOrEqual(0);
      expect(bounds.width).toBeLessThanOrEqual(1000);
      expect(bounds.height).toBeLessThanOrEqual(800);
      expect(Math.abs(bounds.width / bounds.height - 4 / 3)).toBeLessThan(0.05);
    });

    it('calculates 1:1 centered square crop', () => {
      const bounds = calculatePresetCrop(1200, 800, 'aspect_1_1');
      expect(bounds.width).toBe(800);
      expect(bounds.height).toBe(800);
      expect(bounds.originX).toBe(200);
      expect(bounds.originY).toBe(0);
    });
  });

  describe('cropAndAdjustImage', () => {
    it('executes real crop and rotation returning distinct asset URI without mutating source', async () => {
      const sourceUri = 'file:///data/cache/original_photo.jpg';
      const result = await cropAndAdjustImage(sourceUri, {
        crop: { originX: 50, originY: 50, width: 400, height: 300 },
        rotation: 90,
      });

      expect(result.uri).toBe('file:///data/cache/original_photo.jpg_manipulated');
      expect(result.cropped).toBe(true);
      expect(result.rotation).toBe(90);
    });

    it('preserves source image when no operations are provided', async () => {
      const sourceUri = 'file:///data/cache/untouched.jpg';
      const result = await cropAndAdjustImage(sourceUri, {});
      expect(result.uri).toBe(sourceUri);
      expect(result.cropped).toBe(false);
      expect(result.rotation).toBe(0);
    });
  });

  describe('processMultiSideLabelImages', () => {
    let recognizePackagingImageSpy: any;
    let parseAiSpy: any;

    beforeEach(() => {
      recognizePackagingImageSpy = jest
        .spyOn(remoteOcrModule, 'recognizePackagingImage')
        .mockImplementation(async (uri: string) => {
          if (uri.includes('front')) {
            return {
              success: true,
              count: 2,
              text: 'Paracetamol Tablets IP\n500 mg\nCipla',
              lines: [
                { text: 'Paracetamol Tablets IP', score: 0.98 },
                { text: '500 mg', score: 0.99 },
                { text: 'Cipla', score: 0.95 },
              ],
            };
          }
          if (uri.includes('back')) {
            return {
              success: true,
              count: 3,
              text: 'Each tablet contains: Paracetamol IP 500mg\nBatch: DEMO-B882\nExp: 11/2028\nCipla Ltd.',
              lines: [
                { text: 'Each tablet contains: Paracetamol IP 500mg', score: 0.96 },
                { text: 'Batch: DEMO-B882', score: 0.97 },
                { text: 'Exp: 11/2028', score: 0.99 },
                { text: 'Cipla Ltd.', score: 0.95 },
              ],
            };
          }
          return {
            success: true,
            count: 1,
            text: 'Single side label 500mg',
            lines: [{ text: 'Single side label 500mg', score: 0.9 }],
          };
        });

      parseAiSpy = jest
        .spyOn(aiAssistantService, 'parseMedicinePackagingWithAI')
        .mockImplementation(async (rawText: string) => ({
          medicineName: 'Paracetamol',
          genericName: 'Paracetamol',
          detectedStrength: '500 mg',
          dosageForm: 'tablet',
          manufacturer: 'Cipla Ltd.',
          batchNumber: 'DEMO-B882',
          expiryDate: '11/2028',
          rawText,
        }));
    });

    afterEach(() => {
      jest.restoreAllMocks();
    });

    it('processes single front image and tracks progression stages', async () => {
      const stagesRecorded: ScanStage[] = [];
      const result = await processMultiSideLabelImages({
        frontUri: 'file:///images/front_packaging.jpg',
        onProgress: (stage) => stagesRecorded.push(stage),
      });

      expect(stagesRecorded).toEqual(['preparing', 'front_ocr', 'cleaning', 'ai_analysis', 'complete']);
      expect(recognizePackagingImageSpy).toHaveBeenCalledTimes(1);
      expect(result.frontRawText).toContain('Paracetamol');
      expect(result.backRawText).toBe('');
      expect(result.extracted.medicineName).toBe('Paracetamol');
      expect(result.extracted.detectedStrength).toBe('500 mg');
    });

    it('processes front and back images concurrently with labeled consolidation', async () => {
      const stagesRecorded: ScanStage[] = [];
      const result = await processMultiSideLabelImages({
        frontUri: 'file:///images/front_package.jpg',
        backUri: 'file:///images/back_package.jpg',
        onProgress: (stage) => stagesRecorded.push(stage),
      });

      expect(stagesRecorded).toEqual(['preparing', 'parallel_ocr', 'cleaning', 'ai_analysis', 'complete']);
      expect(recognizePackagingImageSpy).toHaveBeenCalledTimes(2);

      // Raw text consolidates both sides clearly labeled
      expect(result.rawText).toContain('[FRONT SIDE PACKAGING]');
      expect(result.rawText).toContain('[BACK SIDE PACKAGING]');
      expect(result.rawText).toContain('Batch: DEMO-B882');

      // AI received combined context
      expect(parseAiSpy).toHaveBeenCalledWith(
        expect.stringContaining('[FRONT SIDE PACKAGING]'),
      );
      expect(parseAiSpy).toHaveBeenCalledWith(
        expect.stringContaining('[BACK SIDE PACKAGING]'),
      );

      expect(result.extracted.batchNumber).toBe('DEMO-B882');
      expect(result.extracted.expiryDate).toBe('11/2028');
    });

    it('handles partial OCR failure gracefully if back image fails', async () => {
      recognizePackagingImageSpy.mockImplementation(async (uri: string) => {
        if (uri.includes('front')) {
          return {
            success: true,
            count: 1,
            text: 'Ibuprofen 400 mg Tablets',
            lines: [{ text: 'Ibuprofen 400 mg Tablets', score: 0.95 }],
          };
        }
        throw new Error('Back image blurry or network drop');
      });

      const result = await processMultiSideLabelImages({
        frontUri: 'file:///images/front_package.jpg',
        backUri: 'file:///images/back_package.jpg',
      });

      expect(result.rawText).toContain('Ibuprofen 400 mg Tablets');
      expect(result.extracted.medicineName).toBe('Paracetamol'); // From mock AI parser
    });

    it('propagates error when both front and back images fail', async () => {
      recognizePackagingImageSpy.mockRejectedValue(new Error('Network offline'));

      await expect(
        processMultiSideLabelImages({
          frontUri: 'file:///images/front_package.jpg',
          backUri: 'file:///images/back_package.jpg',
        }),
      ).rejects.toThrow('Network offline');
    });

    it('maintains backward compatibility with processLabelImage', async () => {
      const result = await processLabelImage('file:///images/front_sample.jpg');
      expect(result).toBeDefined();
      expect(result.rawText).toBeDefined();
      expect(result.extracted).toBeDefined();
    });
  });
});
