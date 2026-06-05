// Web replacement for react-native-image-picker. We create a hidden
// <input type="file"> for each call, programmatically click it, and
// resolve with the same Asset shape the native package returns.
// Camera-vs-gallery is collapsed (both go through the file picker on
// web; mobile-only browsers offer a camera shortcut via `capture` attr).

export interface Asset {
  uri?: string;
  fileName?: string | null;
  fileSize?: number | null;
  type?: string | null;
}

interface PickerResult {
  didCancel?: boolean;
  errorCode?: string;
  errorMessage?: string;
  assets?: Asset[];
}

function pick(opts: {
  multiple?: boolean;
  capture?: boolean;
}): Promise<PickerResult> {
  return new Promise(resolve => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    if (opts.multiple) input.multiple = true;
    if (opts.capture) input.setAttribute('capture', 'environment');
    input.style.display = 'none';

    // Some browsers fire focus on body after the file dialog closes
    // without selection — treat that as cancelled.
    let resolved = false;
    const onChange = () => {
      if (resolved) return;
      resolved = true;
      const files = Array.from(input.files ?? []);
      if (files.length === 0) {
        resolve({didCancel: true});
        return;
      }
      const assets: Asset[] = files.map(file => ({
        uri: URL.createObjectURL(file),
        fileName: file.name,
        fileSize: file.size,
        type: file.type,
      }));
      resolve({assets});
      document.body.removeChild(input);
    };
    const onCancel = () => {
      if (resolved) return;
      resolved = true;
      resolve({didCancel: true});
      try {
        document.body.removeChild(input);
      } catch {
        // ignore
      }
    };

    input.addEventListener('change', onChange);
    // The HTML spec doesn't standardise a cancel event, but Chrome
    // ships one. Falling back to body-focus would mis-fire too often;
    // we let resolved=true block double-resolve.
    input.addEventListener('cancel', onCancel);

    document.body.appendChild(input);
    input.click();
  });
}

export function launchImageLibrary(opts?: {
  selectionLimit?: number;
}): Promise<PickerResult> {
  const multiple = (opts?.selectionLimit ?? 1) !== 1;
  return pick({multiple});
}

export function launchCamera(): Promise<PickerResult> {
  // Mobile browsers honour the capture attribute and open the camera
  // directly; desktop browsers fall back to the file picker.
  return pick({capture: true});
}

// Match the native package's default-export shape too, just in case.
export default {launchImageLibrary, launchCamera};

// Re-export the option types the lib expects.
export type ImageLibraryOptions = {selectionLimit?: number};
export type CameraOptions = {};
