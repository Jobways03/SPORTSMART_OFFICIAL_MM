import React, {useEffect, useRef} from 'react';
import {Animated, View} from 'react-native';

interface SkeletonProps {
  className?: string;
  style?: object;
}

/**
 * Generic gray-pulse rectangle. Compose into screen-specific shapes
 * (see SkeletonProductGrid, SkeletonList below). Avoids ActivityIndicator
 * on first-load: users see the page's shape before content streams in,
 * which feels faster than a centered spinner.
 */
export function Skeleton({className, style}: SkeletonProps) {
  const opacity = useRef(new Animated.Value(0.55)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, {
          toValue: 1,
          duration: 700,
          useNativeDriver: true,
        }),
        Animated.timing(opacity, {
          toValue: 0.55,
          duration: 700,
          useNativeDriver: true,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [opacity]);

  return (
    <Animated.View
      className={`bg-gray-200 rounded-md ${className ?? ''}`}
      style={[{opacity}, style]}
    />
  );
}

/**
 * 2-column product grid placeholder — matches the layout BrowseScreen
 * and HomeScreen's featured section render. 6 cards is enough to fill
 * the viewport without scrolling on most phones.
 */
export function SkeletonProductGrid({count = 6}: {count?: number}) {
  return (
    <View className="flex-row flex-wrap justify-between px-6 pt-4">
      {Array.from({length: count}).map((_, i) => (
        <View key={i} className="mb-4" style={{width: '48%'}}>
          <Skeleton className="aspect-square mb-2" />
          <Skeleton className="h-3 w-1/3 mb-1.5" />
          <Skeleton className="h-4 w-2/3 mb-1.5" />
          <Skeleton className="h-4 w-1/4" />
        </View>
      ))}
    </View>
  );
}

/**
 * Vertical-list placeholder for Orders / Returns / Tickets cards.
 */
export function SkeletonList({count = 4}: {count?: number}) {
  return (
    <View className="pt-4">
      {Array.from({length: count}).map((_, i) => (
        <View
          key={i}
          className="bg-white mx-4 mb-3 rounded-lg p-4 border border-gray-100">
          <View className="flex-row items-center justify-between mb-2">
            <Skeleton className="h-3 w-1/4" />
            <Skeleton className="h-3 w-1/6" />
          </View>
          <Skeleton className="h-5 w-2/3 mb-3" />
          <View className="flex-row items-center">
            <Skeleton className="h-6 w-20" />
            <View className="flex-1" />
            <Skeleton className="h-4 w-16" />
          </View>
        </View>
      ))}
    </View>
  );
}

/**
 * Wishlist-style row placeholder — same shape as a real wishlist row.
 */
export function SkeletonRowList({count = 5}: {count?: number}) {
  return (
    <View>
      {Array.from({length: count}).map((_, i) => (
        <View
          key={i}
          className="flex-row items-center px-6 py-4 border-b border-gray-100">
          <View className="flex-1">
            <Skeleton className="h-4 w-2/3 mb-2" />
            <Skeleton className="h-3 w-1/3 mb-2" />
            <Skeleton className="h-5 w-20" />
          </View>
        </View>
      ))}
    </View>
  );
}
