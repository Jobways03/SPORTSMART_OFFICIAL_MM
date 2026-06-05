// Web replacement for react-native-css-interop. The native package is
// NativeWind's RN-only runtime that compiles className -> style at
// component-render time. On web NativeWind uses Tailwind CSS classes
// directly (the babel plugin still emits className strings, and our
// PostCSS-compiled web/tailwind.css provides the actual CSS rules
// the browser applies). So the runtime helpers here can be no-ops.

import * as React from 'react';

// cssInterop(Component, mapping) — on RN, returns a wrapped component
// that translates className to style. On web, the original component
// already understands className (RN Web's createElement renders DOM,
// and Tailwind classes apply via the loaded stylesheet), so we just
// return the component unchanged.
export function cssInterop<T>(Component: T, _mapping?: unknown): T {
  return Component;
}

// remapProps is a similar API; same no-op.
export function remapProps<T>(Component: T, _mapping?: unknown): T {
  return Component;
}

// vars() returns a CSS-variables object for theming. On web, CSS
// custom properties work natively, so return a plain style object.
export function vars(values: Record<string, string>): Record<string, string> {
  return values;
}

// useColorScheme — RN's color scheme hook. On web we can read the
// media query; for v1 we just return 'light' so screens render the
// default theme.
export function useColorScheme(): 'light' | 'dark' | null {
  return 'light';
}

// useUnstableNativeVariable — used by NativeWind for theme tokens.
export function useUnstableNativeVariable(_name: string): string | undefined {
  return undefined;
}

// StyleSheet.create — NativeWind v4 exposes its own StyleSheet
// helper. RN Web has one of its own so we forward through.
import {StyleSheet} from 'react-native';
export {StyleSheet};

// styled() HOC — no-op pass-through.
export function styled<P>(
  Component: React.ComponentType<P>,
  _config?: unknown,
): React.ComponentType<P> {
  return Component;
}

// colorScheme — global handle for setting the scheme. No-op on web.
export const colorScheme = {
  set: (_value: 'light' | 'dark' | 'system') => {},
  get: () => 'light' as const,
  toggle: () => {},
};

export default {
  cssInterop,
  remapProps,
  vars,
  useColorScheme,
  useUnstableNativeVariable,
  StyleSheet,
  styled,
  colorScheme,
};
