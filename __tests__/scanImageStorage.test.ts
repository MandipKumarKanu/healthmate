import { beforeEach, describe, expect, it } from '@jest/globals';
import { resetDatabase } from '../src/database/client';
import { scanHistoryRepository } from '../src/database/repositories/scanHistoryRepository';
// These imports are mapped to __tests__/__mocks__/expo-file-system.js by
// jest.config.js — a small in-memory File/Directory implementation compatible
// with the SDK 58 API.
import { Directory, File, Paths } from 'expo-file-system';
import {
  cleanupOrphanScanImages,
  deleteAllScanImages,
  deleteScanImage,
  isManagedScanImageUri,
  saveScanImage,
} from '../src/services/scanImageStorage';

function managedDir(): Directory {
  return new Directory(Paths.document, 'scan-images');
}

function managedDirUri(): string {
  return managedDir().uri;
}

beforeEach(() => {
  if (managedDir().exists) managedDir().delete();
  resetDatabase();
});

describe('scanImageStorage', () => {
  it('treats only managed URIs as managed', () => {
    expect(isManagedScanImageUri(`${managedDirUri()}/scan_1.jpg`)).toBe(true);
    expect(isManagedScanImageUri('file:///cache/photo.jpg')).toBe(false);
    expect(isManagedScanImageUri(undefined)).toBe(false);
  });

  it('copies a source image into the managed directory and returns a stable URI', async () => {
    const source = new File('file:///cache/photo.jpg');
    source.create();

    const stable = await saveScanImage(source.uri);

    expect(stable).toBeDefined();
    expect(isManagedScanImageUri(stable)).toBe(true);
    expect(stable!.startsWith(`${managedDirUri()}/`)).toBe(true);
    expect(new File(stable!).exists).toBe(true);
    // The source remains untouched (it is owned by the camera/gallery).
    expect(source.exists).toBe(true);
  });

  it('returns undefined when the source image is missing', async () => {
    await expect(saveScanImage('file:///cache/never-existed.jpg')).resolves.toBeUndefined();
  });

  it('passes already-managed URIs through untouched', async () => {
    const managed = `${managedDirUri()}/scan_42.jpg`;
    new File(managed).create();
    await expect(saveScanImage(managed)).resolves.toBe(managed);
  });

  it('passes undefined through', async () => {
    await expect(saveScanImage(undefined)).resolves.toBeUndefined();
  });

  it('deletes only managed files that exist', () => {
    const managed = `${managedDirUri()}/scan_7.jpg`;
    new File(managed).create();

    expect(deleteScanImage(managed)).toBe(true);
    expect(new File(managed).exists).toBe(false);

    // Deleting a file that is already gone reports false, not an error.
    expect(deleteScanImage(managed)).toBe(false);

    // The helper must refuse to touch non-managed URIs.
    new File('file:///cache/precious.jpg').create();
    expect(deleteScanImage('file:///cache/precious.jpg')).toBe(false);
    expect(new File('file:///cache/precious.jpg').exists).toBe(true);
    expect(deleteScanImage(undefined)).toBe(false);
  });

  it('deletes every file with deleteAllScanImages', () => {
    for (const name of ['scan_1.jpg', 'scan_2.png', 'scan_3.jpg']) {
      new File(managedDir(), name).create();
    }

    deleteAllScanImages();

    for (const name of ['scan_1.jpg', 'scan_2.png', 'scan_3.jpg']) {
      expect(new File(managedDir(), name).exists).toBe(false);
    }
  });

  it('keeps files referenced by scan-history rows and removes orphans', () => {
    const orphan = new File(managedDir(), 'scan_orphan_1.jpg');
    orphan.create();
    const referenced = new File(managedDir(), 'scan_keep_1.jpg');
    referenced.create();

    scanHistoryRepository.add({
      medicineName: 'Napa',
      dosageForm: 'tablet',
      imageUri: referenced.uri,
    });

    const removed = cleanupOrphanScanImages();

    expect(removed).toBe(1);
    expect(orphan.exists).toBe(false);
    expect(referenced.exists).toBe(true);
  });

  it('counts a no-op cleanup as zero when the directory does not exist', () => {
    expect(cleanupOrphanScanImages()).toBe(0);
  });

  it('removes leftovers when no scan rows reference files (full reset)', () => {
    const leftover = new File(managedDir(), 'scan_leftover.jpg');
    leftover.create();

    expect(cleanupOrphanScanImages()).toBe(1);
    expect(leftover.exists).toBe(false);
  });

  it("matches referenced files by basename, even from another device's URI", () => {
    const local = new File(managedDir(), 'scan_from_other_device.jpg');
    local.create();

    scanHistoryRepository.add({
      medicineName: 'Seclo',
      dosageForm: 'capsule',
      // Restored rows may keep the producing device's absolute prefix.
      imageUri: 'file:///data/user/0/other.app/files/scan-images/scan_from_other_device.jpg',
    });

    expect(cleanupOrphanScanImages()).toBe(0);
    expect(local.exists).toBe(true);
  });
});
