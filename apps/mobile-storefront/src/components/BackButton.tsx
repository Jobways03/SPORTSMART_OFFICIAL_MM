import React from 'react';
import {TouchableOpacity} from 'react-native';
import {useNavigation} from '@react-navigation/native';
import {ChevronLeft} from 'lucide-react-native';

interface BackButtonProps {
  /** Override the default behavior (goBack, or jump to Home on a tab root). */
  onPress?: () => void;
  /** Chevron color — default dark ink; pass 'white' over a dark hero. */
  color?: string;
  /** Circle background — default light grey; pass translucent white over dark. */
  background?: string;
}

// Circular back button matching the one used across the detail screens
// (OrderDetail, Wallet, etc.). Rendered on every screen so back navigation
// is always available. On a tab root (nothing to pop) it falls back to the
// Home tab when that tab is reachable; otherwise it's an inert affordance.
export function BackButton({
  onPress,
  color = '#0a0a0a',
  background = '#fafafa',
}: BackButtonProps) {
  const navigation = useNavigation();

  const handlePress = () => {
    if (onPress) {
      onPress();
      return;
    }
    if (navigation.canGoBack()) {
      navigation.goBack();
      return;
    }
    // Tab root: nothing to pop — jump to the Home tab if it exists.
    const parent: any = navigation.getParent();
    if (parent?.getState?.().routeNames?.includes?.('HomeTab')) {
      parent.navigate('HomeTab');
    }
  };

  return (
    <TouchableOpacity
      accessibilityRole="button"
      accessibilityLabel="Go back"
      onPress={handlePress}
      activeOpacity={0.7}
      className="w-10 h-10 rounded-full items-center justify-center"
      style={{backgroundColor: background}}>
      <ChevronLeft color={color} size={20} />
    </TouchableOpacity>
  );
}
