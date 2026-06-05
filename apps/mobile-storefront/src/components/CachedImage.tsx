import React from 'react';
import {
  ImageSourcePropType,
  ImageStyle,
  StyleProp,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import FastImage, {
  FastImageProps,
  ResizeMode,
  Source,
} from 'react-native-fast-image';
import {cssInterop} from 'nativewind';

// Register FastImage with NativeWind so `className` props compile to its
// `style` prop. Without this, our existing screens that pass className
// would silently drop the styles when we swap <Image> → CachedImage.
cssInterop(FastImage, {className: 'style'});

interface Props
  extends Omit<FastImageProps, 'source' | 'resizeMode' | 'style'> {
  // Accept the same shapes as RN's <Image source={...}> so call sites
  // don't need restructuring. Remote URLs come as {uri:string}; local
  // require()'d assets come as numbers.
  source: ImageSourcePropType | Source;
  resizeMode?: 'cover' | 'contain' | 'stretch' | 'center';
  style?: StyleProp<ImageStyle>;
  className?: string;
}

const RESIZE_MAP: Record<NonNullable<Props['resizeMode']>, ResizeMode> = {
  cover: FastImage.resizeMode.cover,
  contain: FastImage.resizeMode.contain,
  stretch: FastImage.resizeMode.stretch,
  center: FastImage.resizeMode.center,
};

/**
 * Drop-in replacement for <Image> with on-disk + memory caching via
 * react-native-fast-image. Same API surface (source: {uri} | number,
 * resizeMode, style, className) so screens swap with a single import
 * change.
 *
 * Why bother: every product card, PDP image, cart line item, order row,
 * and wishlist row downloads its image on every render with RN's
 * built-in <Image>. FastImage caches them per-URL across the app
 * lifetime, plus shows the cached version even before the response
 * comes back — meaningful win on flaky mobile networks.
 */
export function CachedImage({
  source,
  resizeMode = 'cover',
  style,
  onError,
  ...rest
}: Props) {
  // Normalise: RN allows numbers (require'd assets) directly; FastImage
  // also accepts them but its TS types are strict on the {uri} shape.
  const normalisedSource =
    typeof source === 'number' ? source : (source as Source);

  // Track failed loads so we can render a styled placeholder instead of
  // a broken icon — happens when a CDN URL rate-limits or 404s, common
  // with demo Unsplash links.
  const [failed, setFailed] = React.useState(false);

  // Reset on source change so a recovered URL can render again.
  React.useEffect(() => {
    setFailed(false);
  }, [typeof source === 'number' ? source : source?.uri]);

  if (failed) {
    return (
      <View
        style={[
          {
            backgroundColor: '#fafafa',
            alignItems: 'center',
            justifyContent: 'center',
          },
          style as any,
        ]}>
        <Text style={{fontSize: 28, opacity: 0.35}}>📦</Text>
      </View>
    );
  }

  return (
    <FastImage
      {...rest}
      source={normalisedSource}
      resizeMode={RESIZE_MAP[resizeMode]}
      // RN's ImageStyle allows string values for borderRadius (e.g.
      // '50%'); FastImage's ImageStyle is number-only. Cast through
      // unknown — the values we actually pass are always numbers.
      style={style as unknown as FastImageProps['style']}
      onError={e => {
        setFailed(true);
        onError?.(e);
      }}
    />
  );
}

// Re-export for screens that previously imported StyleSheet patterns —
// FastImage's resizeMode constants are not directly compatible with RN
// <Image> string mode, but our prop translation above handles it.
export const cachedImageStyles = StyleSheet.create({
  full: {width: '100%', height: '100%'},
});
