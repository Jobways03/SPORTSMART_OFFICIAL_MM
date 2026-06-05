import React from 'react';
import {View, ViewStyle, StyleProp, StyleSheet} from 'react-native';
import Svg, {Defs, LinearGradient, Rect, Stop} from 'react-native-svg';

// Lightweight linear-gradient helper. The app doesn't pull in
// expo-linear-gradient / react-native-linear-gradient (one less native
// dep to maintain), so we paint with a single SVG <Rect> filled by a
// <LinearGradient>. SVG renders identically on iOS, Android, and web
// via react-native-svg.

interface Props {
  /** Hex / rgb colors top→bottom by default. */
  colors: string[];
  /** Optional per-color stops 0..1. Defaults to evenly spaced. */
  stops?: number[];
  /** Angle in degrees, 0 = top→bottom, 90 = left→right. */
  angle?: number;
  borderRadius?: number;
  style?: StyleProp<ViewStyle>;
  children?: React.ReactNode;
}

// Translate angle → (x1,y1,x2,y2) on the unit square. 0deg means the
// gradient runs top to bottom; clockwise from there.
function angleToVector(angle: number): {x1: string; y1: string; x2: string; y2: string} {
  const rad = ((angle - 90) * Math.PI) / 180;
  const x = Math.cos(rad);
  const y = Math.sin(rad);
  // Project onto the [0,1] unit square — the SVG userSpace assumes
  // (0,0) = top-left, (1,1) = bottom-right.
  return {
    x1: `${(0.5 - x / 2) * 100}%`,
    y1: `${(0.5 - y / 2) * 100}%`,
    x2: `${(0.5 + x / 2) * 100}%`,
    y2: `${(0.5 + y / 2) * 100}%`,
  };
}

export function Gradient({
  colors,
  stops,
  angle = 180,
  borderRadius = 0,
  style,
  children,
}: Props) {
  const idRef = React.useRef(`grad-${Math.random().toString(36).slice(2)}`);
  const id = idRef.current;
  const vec = angleToVector(angle);
  const computedStops = colors.map((c, i) => ({
    offset: stops?.[i] ?? i / Math.max(1, colors.length - 1),
    color: c,
  }));
  return (
    <View style={[{overflow: 'hidden', borderRadius}, style]}>
      {/* SVG background layer — wrapped in an absolutely-positioned
          View with pointerEvents="none" so it never intercepts touch.
          zIndex: 0 keeps it strictly behind any sibling content. */}
      <View
        pointerEvents="none"
        style={[StyleSheet.absoluteFillObject, {zIndex: 0}]}>
        <Svg width="100%" height="100%">
          <Defs>
            <LinearGradient
              id={id}
              x1={vec.x1}
              y1={vec.y1}
              x2={vec.x2}
              y2={vec.y2}>
              {computedStops.map((s, i) => (
                <Stop key={i} offset={s.offset} stopColor={s.color} />
              ))}
            </LinearGradient>
          </Defs>
          <Rect x={0} y={0} width="100%" height="100%" fill={`url(#${id})`} />
        </Svg>
      </View>
      {/* Children layer — explicit zIndex above the SVG. Wrapped so any
          lucide-react-native icon nested directly as a child can't
          clash with the background SVG's stacking on react-native-web.
          No flex props so the wrapper inherits the outer's layout —
          stretches for hero cards, content-sized for centered circles. */}
      {children != null ? (
        <View style={{zIndex: 1}}>{children}</View>
      ) : null}
    </View>
  );
}
