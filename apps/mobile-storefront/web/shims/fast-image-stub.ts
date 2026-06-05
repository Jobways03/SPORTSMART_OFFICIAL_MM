// Web replacement for react-native-fast-image. RN Web's <Image> caches
// via the browser's HTTP cache, so we just re-export Image with the
// same resizeMode-constant API surface the native package exposes.

import {Image, ImageStyle} from 'react-native';

type FastImageProps = React.ComponentProps<typeof Image>;

// FastImage's resizeMode constants are strings that match RN's Image
// `resizeMode` values, so this is a straight passthrough.
const resizeMode = {
  cover: 'cover' as const,
  contain: 'contain' as const,
  stretch: 'stretch' as const,
  center: 'center' as const,
};

const FastImage = Image as React.ComponentType<FastImageProps> & {
  resizeMode: typeof resizeMode;
};
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(FastImage as any).resizeMode = resizeMode;

export default FastImage;
export {resizeMode};
export type {FastImageProps, ImageStyle};
