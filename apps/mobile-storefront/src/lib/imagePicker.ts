import {showAlert} from './dialog';
import {
  Asset,
  CameraOptions,
  ImageLibraryOptions,
  launchCamera,
  launchImageLibrary,
} from 'react-native-image-picker';

// Wraps the picker library to: (1) cap dimensions so we don't upload
// 12-megapixel HEICs over a 3G connection, (2) reject the user-cancel
// case as undefined instead of throwing, (3) surface picker errors via
// Alert because they're nearly always permission denials and the user
// needs to know what to fix.

const COMMON: ImageLibraryOptions & CameraOptions = {
  mediaType: 'photo',
  maxWidth: 1600,
  maxHeight: 1600,
  quality: 0.8,
  includeBase64: false,
};

async function handle(assets: Asset[] | undefined): Promise<Asset[]> {
  if (!assets || assets.length === 0) return [];
  // Filter out anything missing a URI — happens if the user denies file
  // access mid-pick on iOS.
  return assets.filter(a => !!a.uri);
}

export async function pickFromGallery(opts: {
  multiple?: boolean;
  remaining?: number;
} = {}): Promise<Asset[]> {
  try {
    const res = await launchImageLibrary({
      ...COMMON,
      selectionLimit: opts.multiple ? Math.max(1, opts.remaining ?? 5) : 1,
    });
    if (res.didCancel) return [];
    if (res.errorCode) {
      showAlert(
        'Cannot open photos',
        res.errorMessage ||
          'Photo library access was denied. Allow it from Settings to attach images.',
      );
      return [];
    }
    return handle(res.assets);
  } catch (err) {
    showAlert(
      'Cannot open photos',
      err instanceof Error ? err.message : 'Try again.',
    );
    return [];
  }
}

export async function takePhoto(): Promise<Asset[]> {
  try {
    const res = await launchCamera({
      ...COMMON,
      cameraType: 'back',
      saveToPhotos: true,
    });
    if (res.didCancel) return [];
    if (res.errorCode) {
      showAlert(
        'Cannot open camera',
        res.errorMessage ||
          'Camera access was denied. Allow it from Settings to capture images.',
      );
      return [];
    }
    return handle(res.assets);
  } catch (err) {
    showAlert(
      'Cannot open camera',
      err instanceof Error ? err.message : 'Try again.',
    );
    return [];
  }
}
