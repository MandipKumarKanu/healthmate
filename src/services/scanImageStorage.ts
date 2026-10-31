import { Directory, File, Paths } from 'expo-file-system';
import { getDatabase } from '../database/client';

/**
 * Stable scan-image storage.
 *
 * Camera/gallery capture URIs live in the app cache (or a gallery content
 * provider), where the OS or the camera library reclaims them. Scan-history
 * rows must survive that, so every linked image is copied once into a
 * dedicated, app-private `documents/scan-images/` directory that the system
 * does not trash. Deleting a scan (or clearing/ resetting data) deletes the
 * linked file, and a cheap orphan sweep on app open removes any file no scan
 * references (e.g. after a partial save or a restore on a new device).
 */

const SCAN_IMAGE_DIR_NAME = 'scan-images';

export interface ScanImageBackupAsset {
  key: string;
  extension: string;
  base64: string;
}

export function getScanImageDirectory(): Directory {
  return new Directory(Paths.document, SCAN_IMAGE_DIR_NAME);
}

/** True when a URI points inside the managed scan-image directory. */
export function isManagedScanImageUri(uri?: string | null): boolean {
  if (!uri) return false;
  return uri.includes(`/${SCAN_IMAGE_DIR_NAME}/`);
}

/** File name portion of a URI, query/hash stripped. */
function uriBaseName(uri: string): string {
  const path = uri.split(/[?#]/)[0];
  return path.substring(path.lastIndexOf('/') + 1);
}

function extensionFor(source: File): string {
  const ext = source.extension.replace('.', '').toLowerCase();
  return /^[a-z0-9]{1,8}$/.test(ext) ? ext : 'jpg';
}

/** Returns a portable, content-bearing backup asset for a managed scan image. */
export function getScanImageBackupAsset(imageUri?: string | null): ScanImageBackupAsset | undefined {
  if (!imageUri || !isManagedScanImageUri(imageUri)) return undefined;

  try {
    const source = new File(imageUri);
    if (!source.exists || typeof source.base64Sync !== 'function') return undefined;
    const base64 = source.base64Sync();
    if (!base64) return undefined;
    return {
      key: uriBaseName(imageUri),
      extension: extensionFor(source),
      base64,
    };
  } catch (error) {
    console.warn('getScanImageBackupAsset failed:', error);
    return undefined;
  }
}

/** Restores one embedded scan image and returns its new device-local URI. */
export function restoreScanImageBackupAsset(
  asset: ScanImageBackupAsset,
  index: number,
): string | undefined {
  try {
    if (!asset.key || !asset.base64) return undefined;
    const extension = /^[a-z0-9]{1,8}$/i.test(asset.extension) ? asset.extension : 'jpg';
    const dir = getScanImageDirectory();
    if (!dir.exists) dir.create({ intermediates: true, idempotent: true });
    const destination = new File(
      dir,
      `scan_restore_${Date.now()}_${index}_${Math.floor(Math.random() * 1_000_000)}.${extension}`,
    );
    destination.writeSync(asset.base64, { encoding: 'base64' });
    return destination.uri;
  } catch (error) {
    console.warn('restoreScanImageBackupAsset failed:', error);
    return undefined;
  }
}

/**
 * Copies an image into the managed directory and returns the stable URI that
 * can be persisted in the database. Returns the input unchanged when it is
 * already managed, and `undefined` when the copy failed (a scan history row
 * without an image is better than a row pointing at soon-to-evaporate cache).
 */
export async function saveScanImage(sourceUri?: string): Promise<string | undefined> {
  if (!sourceUri) return undefined;
  if (isManagedScanImageUri(sourceUri)) return sourceUri;

  try {
    const source = new File(sourceUri);
    if (!source.exists) {
      console.warn(`saveScanImage: source does not exist (${sourceUri})`);
      return undefined;
    }

    const dir = getScanImageDirectory();
    if (!dir.exists) {
      dir.create({ intermediates: true, idempotent: true });
    }

    const fileName = `scan_${Date.now()}_${Math.floor(Math.random() * 1_000_000)}.${extensionFor(source)}`;
    const destination = new File(dir, fileName);
    await source.copy(destination, { overwrite: true });
    return destination.uri;
  } catch (error) {
    console.warn('saveScanImage: copy failed:', error);
    return undefined;
  }
}

/** Deletes the managed file for a scan-history image URI, if it still exists. */
export function deleteScanImage(imageUri?: string | null): boolean {
  if (!isManagedScanImageUri(imageUri)) return false;
  try {
    const file = new File(imageUri!);
    if (file.exists) {
      file.delete();
      return true;
    }
  } catch (error) {
    console.warn('deleteScanImage failed:', error);
  }
  return false;
}

/** Deletes every file in the managed directory (used with full data resets). */
export function deleteAllScanImages(): void {
  try {
    const dir = getScanImageDirectory();
    if (!dir.exists) return;
    for (const entry of dir.list()) {
      if (entry instanceof File) entry.delete();
    }
  } catch (error) {
    console.warn('deleteAllScanImages failed:', error);
  }
}

/**
 * Removes managed files that no scan-history row references (basename match,
 * so URIs restored from a backup taken on another device still count).
 * Fire-and-forget on app open; failures must never block startup.
 */
export function cleanupOrphanScanImages(): number {
  try {
    const dir = getScanImageDirectory();
    if (!dir.exists) return 0;

    const referenced = new Set<string>();
    const rows = getDatabase().getAllSync<{ image_uri?: string | null }>(
      'SELECT image_uri FROM scan_history;',
    );
    for (const scan of rows) {
      if (scan.image_uri) referenced.add(uriBaseName(scan.image_uri));
    }

    let deleted = 0;
    for (const entry of dir.list()) {
      if (!(entry instanceof File)) continue;
      if (!referenced.has(uriBaseName(entry.uri))) {
        entry.delete();
        deleted++;
      }
    }
    return deleted;
  } catch (error) {
    console.warn('cleanupOrphanScanImages failed:', error);
    return 0;
  }
}
