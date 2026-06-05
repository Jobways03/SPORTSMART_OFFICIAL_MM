// Web replacement for react-native-gesture-handler. The package's
// real exports are a pile of native bridge wrappers that don't work in
// a browser. On web, react-navigation falls back to standard touch
// events and CSS transitions, so we just need to satisfy the imports
// with components/hooks that pass through to the DOM.

import * as React from 'react';
import {View, ScrollView, Pressable, FlatList, TouchableOpacity} from 'react-native';

// GestureHandlerRootView is rendered at the top of App.tsx; on web it's
// just a flex container.
export const GestureHandlerRootView = View as React.ComponentType<
  React.ComponentProps<typeof View>
>;

// Touch wrappers — re-export RN Web's built-ins under the gesture-
// handler names.
export const TouchableHighlight = TouchableOpacity;
export const TouchableWithoutFeedback = TouchableOpacity;
export const TouchableNativeFeedback = TouchableOpacity;
export {TouchableOpacity, View, ScrollView, Pressable, FlatList};

// Gestures namespace — react-navigation uses Gesture.Pan() etc. for
// swipe-back transitions. On web these are no-ops; CSS handles it.
const noopGesture = {
  enabled: () => noopGesture,
  onStart: () => noopGesture,
  onUpdate: () => noopGesture,
  onEnd: () => noopGesture,
  onFinalize: () => noopGesture,
  onTouchesDown: () => noopGesture,
  shouldCancelWhenOutside: () => noopGesture,
  activeOffsetX: () => noopGesture,
  failOffsetY: () => noopGesture,
};

export const Gesture = {
  Pan: () => noopGesture,
  Tap: () => noopGesture,
  LongPress: () => noopGesture,
  Native: () => noopGesture,
  Race: () => noopGesture,
  Simultaneous: () => noopGesture,
  Exclusive: () => noopGesture,
};

export const GestureDetector: React.FC<{
  gesture?: unknown;
  children: React.ReactNode;
}> = ({children}) => <>{children}</>;

// Handler component shims — react-navigation v5 used these directly.
// v7 uses Gesture API but some library code may still reference the
// old names. All become pass-through Views.
export const PanGestureHandler = View;
export const TapGestureHandler = View;
export const LongPressGestureHandler = View;
export const FlingGestureHandler = View;
export const RotationGestureHandler = View;
export const PinchGestureHandler = View;
export const NativeViewGestureHandler = View;
export const RawButton = TouchableOpacity;
export const BaseButton = TouchableOpacity;
export const RectButton = TouchableOpacity;
export const BorderlessButton = TouchableOpacity;

// State enum — referenced by handler-driven libraries.
export const State = {
  UNDETERMINED: 0,
  FAILED: 1,
  BEGAN: 2,
  CANCELLED: 3,
  ACTIVE: 4,
  END: 5,
};

// Directions enum — same.
export const Directions = {
  RIGHT: 1,
  LEFT: 2,
  UP: 4,
  DOWN: 8,
};

export default {
  GestureHandlerRootView,
  Gesture,
  GestureDetector,
  State,
  Directions,
};
