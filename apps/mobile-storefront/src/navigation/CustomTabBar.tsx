import React, {useState} from 'react';
import {Modal, Pressable, Text, View} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import type {BottomTabBarProps} from '@react-navigation/bottom-tabs';
import {StackActions} from '@react-navigation/native';
import type {LucideIcon} from 'lucide-react-native';
import {
  Flame,
  Heart,
  Home as HomeIcon,
  Package,
  Plus,
  Search,
  ShoppingBag,
  Sparkles,
  User,
  X,
} from 'lucide-react-native';
import {useCart} from '../queries/useCart';

const C = {
  bg: '#ffffff',
  surfaceWarm: '#fafafa',
  surfaceSage: '#f5f5f5',
  surfaceCoral: '#fee2e2',
  surfaceGold: '#fecaca',
  surfaceMauve: '#e4e4e7',
  border: '#e4e4e7',
  ink: '#0a0a0a',
  inkSoft: '#1a1a1a',
  textSecondary: '#52525b',
  textTertiary: '#71717a',
  textMuted: '#a1a1aa',
  sage: '#ef4444',
  sageDeep: '#dc2626',
  coral: '#fb923c',
  coralDeep: '#ea580c',
  gold: '#b91c1c',
  goldDeep: '#991b1b',
};

const ICON_FOR: Record<string, LucideIcon> = {
  HomeTab: HomeIcon,
  BrowseTab: Search,
  CartTab: ShoppingBag,
  AccountTab: User,
};

const LABEL_FOR: Record<string, string> = {
  HomeTab: 'Home',
  BrowseTab: 'Browse',
  CartTab: 'Bag',
  AccountTab: 'Account',
};

interface QuickAction {
  key: string;
  Icon: LucideIcon;
  label: string;
  caption: string;
  bg: string;
  accent: string;
  onPress: (nav: BottomTabBarProps['navigation']) => void;
}

const QUICK_ACTIONS: QuickAction[] = [
  {
    key: 'discover',
    Icon: Sparkles,
    label: 'Discover',
    caption: 'New drops & curated picks',
    bg: '#fee2e2',
    accent: '#dc2626',
    onPress: nav => nav.navigate('BrowseTab', {screen: 'Browse'}),
  },
  {
    key: 'deals',
    Icon: Flame,
    label: "Today's deals",
    caption: 'Flash sales & member offers',
    bg: '#fee2e2',
    accent: '#dc2626',
    onPress: nav => nav.navigate('BrowseTab', {screen: 'Browse'}),
  },
  {
    key: 'wishlist',
    Icon: Heart,
    label: 'Wishlist',
    caption: 'Saved for later',
    bg: '#fee2e2',
    accent: '#dc2626',
    onPress: nav => nav.navigate('AccountTab', {screen: 'Wishlist'}),
  },
  {
    key: 'orders',
    Icon: Package,
    label: 'My orders',
    caption: 'Track & manage',
    bg: '#fee2e2',
    accent: '#dc2626',
    onPress: nav => nav.navigate('AccountTab', {screen: 'Orders'}),
  },
];

// Width per slot. We have 5 visible buttons (Home, Browse, +, Bag, Account)
// so each takes a fifth. We use an explicit percentage instead of `flex: 1`
// because in some Hermes/new-arch builds the row's flex children don't
// expand to fill — they shrink-wrap to content, leaving a big empty gap
// on the right of the bar.
const SLOT_WIDTH_PCT = '20%' as const;

// In-bar quick-actions button. Rendered as a 5th equal-width tab between
// Browse and Bag so the layout is symmetric and no element overlays the
// labels. Tapping opens the quick-actions sheet rather than navigating —
// this is the "more" affordance that pairs with the four primary tabs.
function PlusTabButton({onPress}: {onPress: () => void}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Open quick actions"
      onPress={onPress}
      style={({pressed}) => ({
        width: SLOT_WIDTH_PCT,
        alignItems: 'center',
        justifyContent: 'center',
        paddingVertical: 4,
        opacity: pressed ? 0.7 : 1,
      })}>
      <View
        style={{
          width: 40,
          height: 40,
          borderRadius: 20,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: C.sageDeep,
        }}>
        <Plus color="white" size={22} strokeWidth={2.6} />
      </View>
    </Pressable>
  );
}

export function CustomTabBar({state, descriptors, navigation}: BottomTabBarProps) {
  const insets = useSafeAreaInsets();
  const cartQuery = useCart();
  const cartCount = cartQuery.data?.itemCount ?? 0;

  const [sheetOpen, setSheetOpen] = useState(false);

  const onActionPress = (action: QuickAction) => {
    setSheetOpen(false);
    setTimeout(() => action.onPress(navigation), 60);
  };

  return (
    <View
      style={{
        width: '100%',
        backgroundColor: C.bg,
        borderTopWidth: 1,
        borderTopColor: C.border,
        paddingBottom: Math.max(insets.bottom, 8),
        paddingTop: 8,
        flexDirection: 'row',
        // `space-between` on the row + fixed 20% slot widths guarantees
        // the five buttons stretch edge-to-edge with even gaps — both on
        // the device and on rn-web's Vite build.
        justifyContent: 'space-between',
        alignItems: 'center',
        shadowColor: '#000',
        shadowOpacity: 0.04,
        shadowOffset: {width: 0, height: -4},
        shadowRadius: 12,
        elevation: 8,
      }}>
      {state.routes.map((route, index) => {
        const focused = state.index === index;
        const {options} = descriptors[route.key];
        const Icon = ICON_FOR[route.name] ?? HomeIcon;
        const label = LABEL_FOR[route.name] ?? route.name;
        const isCart = route.name === 'CartTab';
        const showBadge = isCart && cartCount > 0;

        const onPress = () => {
          const event = navigation.emit({
            type: 'tabPress',
            target: route.key,
            canPreventDefault: true,
          });
          if (focused || event.defaultPrevented) {
            return;
          }
          // Switching INTO Account from another tab: reset its cached stack
          // to the root menu with an explicit popToTop — navigate({screen})
          // was restoring the sub-page on a 2nd tap — then switch. Re-tapping
          // while already on Account is handled by the stack's screenLayout.
          if (route.name === 'AccountTab') {
            const nestedKey = route.state?.key;
            if (nestedKey) {
              navigation.dispatch({
                ...StackActions.popToTop(),
                target: nestedKey,
              });
              navigation.navigate('AccountTab');
            } else {
              // No cached nested key yet — navigate straight to the root.
              navigation.navigate('AccountTab', {screen: 'Account'});
            }
          } else {
            navigation.navigate(route.name);
          }
        };

        const onLongPress = () => {
          navigation.emit({type: 'tabLongPress', target: route.key});
        };

        // Insert the + tab between Browse (index 1) and Cart (index 2)
        // so the bar reads: Home · Browse · + · Bag · Account.
        const showPlusBefore = index === 2;

        return (
          <React.Fragment key={route.key}>
            {showPlusBefore ? (
              <PlusTabButton onPress={() => setSheetOpen(true)} />
            ) : null}
            <Pressable
              accessibilityRole="button"
              accessibilityState={focused ? {selected: true} : {}}
              accessibilityLabel={options.tabBarAccessibilityLabel ?? label}
              testID={options.tabBarButtonTestID}
              onPress={onPress}
              onLongPress={onLongPress}
              style={({pressed}) => ({
                width: SLOT_WIDTH_PCT,
                alignItems: 'center',
                justifyContent: 'center',
                paddingVertical: 4,
                opacity: pressed ? 0.7 : 1,
              })}>
              <View
                style={{
                  width: 52,
                  height: 36,
                  borderRadius: 18,
                  alignItems: 'center',
                  justifyContent: 'center',
                  backgroundColor: focused ? C.surfaceSage : 'transparent',
                }}>
                <Icon
                  size={focused ? 22 : 24}
                  color={focused ? C.sageDeep : C.textTertiary}
                  strokeWidth={focused ? 2.4 : 2}
                />

                {showBadge ? (
                  <View
                    style={{
                      position: 'absolute',
                      top: 0,
                      right: 6,
                      minWidth: 16,
                      height: 16,
                      borderRadius: 8,
                      paddingHorizontal: 4,
                      backgroundColor: C.sageDeep,
                      alignItems: 'center',
                      justifyContent: 'center',
                      borderWidth: 2,
                      borderColor: C.bg,
                    }}>
                    <Text
                      style={{
                        color: 'white',
                        fontSize: 9,
                        fontWeight: '800',
                        letterSpacing: 0.2,
                      }}>
                      {cartCount > 9 ? '9+' : cartCount}
                    </Text>
                  </View>
                ) : null}
              </View>
            </Pressable>
          </React.Fragment>
        );
      })}

      <Modal
        visible={sheetOpen}
        transparent
        animationType="slide"
        onRequestClose={() => setSheetOpen(false)}>
        <Pressable
          onPress={() => setSheetOpen(false)}
          style={{
            flex: 1,
            backgroundColor: 'rgba(15, 23, 42, 0.55)',
            justifyContent: 'flex-end',
          }}>
          <Pressable
            onPress={() => {}}
            style={{
              backgroundColor: '#f4f7fb',
              borderTopLeftRadius: 28,
              borderTopRightRadius: 28,
              paddingHorizontal: 20,
              paddingTop: 12,
              paddingBottom: Math.max(insets.bottom + 16, 28),
              shadowColor: '#000',
              shadowOpacity: 0.12,
              shadowOffset: {width: 0, height: -8},
              shadowRadius: 24,
              elevation: 24,
            }}>
            <View
              style={{
                width: 40,
                height: 4,
                borderRadius: 2,
                backgroundColor: C.border,
                alignSelf: 'center',
                marginBottom: 16,
              }}
            />
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'flex-end',
                justifyContent: 'space-between',
                marginBottom: 16,
              }}>
              <View style={{flex: 1}}>
                <Text
                  style={{
                    fontSize: 10,
                    fontWeight: '700',
                    letterSpacing: 1.8,
                    color: C.textTertiary,
                  }}>
                  QUICK ACTIONS
                </Text>
                <Text
                  style={{
                    fontSize: 20,
                    fontWeight: '900',
                    color: C.ink,
                    letterSpacing: -0.5,
                    marginTop: 2,
                  }}>
                  What's next?
                </Text>
              </View>
              <Pressable
                onPress={() => setSheetOpen(false)}
                accessibilityLabel="Close quick actions"
                style={({pressed}) => ({
                  width: 36,
                  height: 36,
                  borderRadius: 18,
                  backgroundColor: C.bg,
                  alignItems: 'center',
                  justifyContent: 'center',
                  opacity: pressed ? 0.7 : 1,
                })}>
                <X color={C.ink} size={18} />
              </Pressable>
            </View>

            <View
              style={{
                flexDirection: 'row',
                flexWrap: 'wrap',
                marginHorizontal: -4,
              }}>
              {QUICK_ACTIONS.map(action => (
                <View
                  key={action.key}
                  style={{width: '50%', padding: 4}}>
                  <Pressable
                    onPress={() => onActionPress(action)}
                    style={({pressed}) => ({
                      backgroundColor: C.bg,
                      borderRadius: 18,
                      padding: 16,
                      minHeight: 110,
                      opacity: pressed ? 0.85 : 1,
                      transform: [{scale: pressed ? 0.98 : 1}],
                    })}>
                    <View
                      style={{
                        width: 40,
                        height: 40,
                        borderRadius: 12,
                        backgroundColor: action.bg,
                        alignItems: 'center',
                        justifyContent: 'center',
                        marginBottom: 10,
                      }}>
                      <action.Icon color={action.accent} size={20} />
                    </View>
                    <Text
                      style={{
                        fontSize: 14,
                        fontWeight: '700',
                        color: C.ink,
                        letterSpacing: -0.2,
                        marginBottom: 2,
                      }}>
                      {action.label}
                    </Text>
                    <Text
                      style={{
                        fontSize: 11,
                        color: C.textTertiary,
                        lineHeight: 14,
                      }}>
                      {action.caption}
                    </Text>
                  </Pressable>
                </View>
              ))}
            </View>

            <Pressable
              onPress={() => {
                setSheetOpen(false);
                setTimeout(
                  () => navigation.navigate('AccountTab', {screen: 'Account'}),
                  60,
                );
              }}
              style={({pressed}) => ({
                marginTop: 12,
                backgroundColor: C.surfaceCoral,
                borderRadius: 18,
                padding: 14,
                flexDirection: 'row',
                alignItems: 'center',
                opacity: pressed ? 0.85 : 1,
              })}>
              <View
                style={{
                  width: 36,
                  height: 36,
                  borderRadius: 18,
                  backgroundColor: C.sageDeep,
                  alignItems: 'center',
                  justifyContent: 'center',
                  marginRight: 12,
                }}>
                <Sparkles color="white" size={16} />
              </View>
              <View style={{flex: 1}}>
                <Text
                  style={{
                    fontSize: 10,
                    fontWeight: '800',
                    letterSpacing: 1.8,
                    color: C.sageDeep,
                  }}>
                  SPORTSMART+
                </Text>
                <Text
                  style={{
                    fontSize: 13,
                    fontWeight: '700',
                    color: C.ink,
                    letterSpacing: -0.2,
                    marginTop: 1,
                  }}>
                  Free shipping, early drops & more
                </Text>
              </View>
              <Text
                style={{
                  fontSize: 11,
                  fontWeight: '700',
                  color: C.sageDeep,
                  letterSpacing: 0.3,
                }}>
                JOIN →
              </Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}
