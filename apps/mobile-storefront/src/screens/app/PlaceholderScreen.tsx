import React from 'react';
import {Text, View} from 'react-native';
import {SafeAreaView} from 'react-native-safe-area-context';
import {Sparkles} from 'lucide-react-native';
import {Gradient} from '../../components/Gradient';

interface Props {
  title: string;
  subtitle?: string;
}

// Premium-styled placeholder for any Phase-1 scaffold route. Reuses the
// design system's medallion + dark-gradient pattern so even un-built
// surfaces feel intentional. Replaced per-screen as we ship the real ones.
const C = {
  bg: '#f4f7fb',
  surface: '#ffffff',
  surfaceSage: '#f5f5f5',
  ink: '#0a0a0a',
  textSecondary: '#52525b',
  textTertiary: '#71717a',
  sage: '#ef4444',
  sageDeep: '#dc2626',
};

export function PlaceholderScreen({title, subtitle}: Props) {
  return (
    <SafeAreaView className="flex-1" style={{backgroundColor: C.bg}}>
      <View className="flex-1 items-center justify-center px-6">
        {/* Layered medallion — outer sky-tint ring + inner gradient core
            with a Sparkles icon, matches the empty-state pattern used
            across OrdersScreen / WishlistScreen / AddressesScreen. */}
        <View
          className="w-28 h-28 rounded-full items-center justify-center mb-6"
          style={{
            backgroundColor: C.surfaceSage,
            borderWidth: 2,
            borderColor: C.surface,
            shadowColor: C.sageDeep,
            shadowOpacity: 0.18,
            shadowOffset: {width: 0, height: 8},
            shadowRadius: 16,
            elevation: 6,
          }}>
          <View
            style={{
              width: 80,
              height: 80,
              borderRadius: 40,
              overflow: 'hidden',
            }}>
            <Gradient
              colors={[C.sageDeep, C.ink]}
              angle={135}
              borderRadius={40}
              style={{
                width: '100%',
                height: '100%',
                alignItems: 'center',
                justifyContent: 'center',
              }}>
              <Sparkles color="white" size={32} />
            </Gradient>
          </View>
        </View>

        <Text
          className="text-[10px] font-bold tracking-widest mb-2"
          style={{color: C.sageDeep, letterSpacing: 2}}>
          COMING SOON
        </Text>

        <Text
          className="text-xl font-black mb-2 text-center"
          style={{color: C.ink, letterSpacing: -0.5}}>
          {title}
        </Text>

        {subtitle ? (
          <Text
            className="text-sm text-center leading-5"
            style={{color: C.textSecondary, maxWidth: 280}}>
            {subtitle}
          </Text>
        ) : (
          <Text
            className="text-sm text-center leading-5"
            style={{color: C.textTertiary, maxWidth: 280}}>
            This experience is on its way. Check back soon.
          </Text>
        )}
      </View>
    </SafeAreaView>
  );
}
