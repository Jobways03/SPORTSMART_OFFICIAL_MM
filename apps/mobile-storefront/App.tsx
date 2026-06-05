import './global.css';
import {initSentry, wrapApp} from './src/lib/sentry';
import {initAnalytics, trackScreen} from './src/lib/analytics';

// Boot crash reporting + analytics before anything else so JS errors
// during the rest of module init have a reporter attached. Both inits
// are no-ops when their respective env vars are empty.
initSentry();
initAnalytics();

import React, {useRef} from 'react';
import {StatusBar} from 'react-native';
import {GestureHandlerRootView} from 'react-native-gesture-handler';
import {NavigationContainer} from '@react-navigation/native';
import {SafeAreaProvider} from 'react-native-safe-area-context';
import {QueryClient, QueryClientProvider} from '@tanstack/react-query';
import {AuthProvider} from './src/context/AuthContext';
import {RootNavigator} from './src/navigation/RootNavigator';
import {navigationRef} from './src/navigation/navigation-ref';
import {linking} from './src/navigation/linking';
import {ErrorBoundary} from './src/components/ErrorBoundary';
import {DialogHost} from './src/lib/dialog';

// Singleton — TanStack Query needs a stable instance across renders.
// Mobile defaults are tuned for flaky networks: 1 retry instead of 3
// (don't make users wait through a 3x exponential backoff on no-signal),
// 30s staleTime so back-navigation doesn't refetch immediately.
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      staleTime: 30_000,
      refetchOnWindowFocus: false,
    },
  },
});

function App() {
  // Track screen views via React Navigation state changes. The ref
  // remembers the last screen so we only emit one event per actual
  // navigation (not on every re-render).
  const lastRouteRef = useRef<string | null>(null);

  return (
    <GestureHandlerRootView style={{flex: 1}}>
      <SafeAreaProvider>
        <ErrorBoundary>
          <QueryClientProvider client={queryClient}>
            <AuthProvider>
              <StatusBar barStyle="dark-content" />
              <NavigationContainer
                ref={navigationRef}
                linking={linking}
                onStateChange={() => {
                  const route = navigationRef.getCurrentRoute();
                  if (route && route.name !== lastRouteRef.current) {
                    lastRouteRef.current = route.name;
                    trackScreen(route.name);
                  }
                }}>
                <RootNavigator />
              </NavigationContainer>
              <DialogHost />
            </AuthProvider>
          </QueryClientProvider>
        </ErrorBoundary>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

// Sentry.wrap attaches performance + profiling integrations. Safe even
// when DSN is empty — Sentry no-ops gracefully.
export default wrapApp(App);
