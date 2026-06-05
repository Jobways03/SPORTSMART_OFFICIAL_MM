import React from 'react';
import {Text, TouchableOpacity, View} from 'react-native';
import {SafeAreaView} from 'react-native-safe-area-context';
import {AlertCircle} from 'lucide-react-native';
import {reportError} from '../lib/sentry';

interface State {
  error: Error | null;
}

interface Props {
  children: React.ReactNode;
}

/**
 * Root-level error boundary. Catches render-time exceptions that would
 * otherwise white-screen the app (anything not caught by TanStack
 * Query's per-screen error state — usually a typeof null bug, an
 * undefined navigation param, or a transient bad-data shape from the
 * API). On error we show a recovery screen with a Try Again button
 * that re-mounts the tree.
 *
 * We can't catch errors thrown inside async handlers, event listeners,
 * or during server-side rendering — RN doesn't do SSR so that's moot,
 * and async errors should be surfaced via per-screen Alert/Toast.
 *
 * When a crash reporter (Sentry / Crashlytics) is wired up, hook into
 * componentDidCatch to forward the error + componentStack.
 */
export class ErrorBoundary extends React.Component<Props, State> {
  state: State = {error: null};

  static getDerivedStateFromError(error: Error): State {
    return {error};
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    reportError(error, {componentStack: info.componentStack});
  }

  reset = () => this.setState({error: null});

  render() {
    if (!this.state.error) return this.props.children;

    const message = this.state.error.message || 'Unknown error';
    return (
      <SafeAreaView className="flex-1 bg-white">
        <View className="flex-1 items-center justify-center px-6">
          <AlertCircle color="#dc2626" size={56} />
          <Text className="text-xl font-bold text-gray-900 mt-4 mb-2 text-center">
            Something went wrong
          </Text>
          <Text
            className="text-sm text-gray-600 text-center mb-6"
            numberOfLines={5}>
            {message}
          </Text>
          <TouchableOpacity
            className="bg-primary rounded-lg px-6 py-3"
            onPress={this.reset}
            activeOpacity={0.85}>
            <Text className="text-white font-semibold">Try again</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }
}
