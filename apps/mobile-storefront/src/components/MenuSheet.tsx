import React, {useState} from 'react';
import {
  Modal,
  Pressable,
  ScrollView,
  Text,
  View,
} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {ChevronDown, ChevronRight, X} from 'lucide-react-native';
import {useMenu} from '../queries/useMenu';
import type {MenuNode} from '../services/menu.service';
import {Spinner} from './Spinner';

const C = {
  bg: '#f4f7fb',
  surface: '#ffffff',
  surfaceWarm: '#fafafa',
  surfaceSage: '#f5f5f5',
  border: '#e4e4e7',
  ink: '#0a0a0a',
  inkSoft: '#1a1a1a',
  textSecondary: '#52525b',
  textTertiary: '#71717a',
  textMuted: '#a1a1aa',
  sage: '#ef4444',
  sageDeep: '#dc2626',
};

interface Props {
  visible: boolean;
  onClose: () => void;
  // Fires when the user taps a leaf (or a top-level item with no
  // children). The parent typically pipes this into the search input
  // so BrowseScreen's existing query path filters to the picked label.
  onSelectLeaf: (label: string) => void;
}

// Top-level rows expand/collapse inline to reveal their children. The
// open set is keyed by item id so multiple groups can stay open
// simultaneously (e.g. Cricket + Football both expanded).
export function MenuSheet({visible, onClose, onSelectLeaf}: Props) {
  const insets = useSafeAreaInsets();
  const menuQuery = useMenu('main-menu');
  const [openIds, setOpenIds] = useState<Set<string>>(new Set());

  const toggle = (id: string) => {
    setOpenIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  // Single source of truth for "what should picking this item do".
  // Top-level groups with children only toggle; leaves and group-less
  // items navigate. Keeps the tap target predictable.
  const onPress = (item: MenuNode, isTopLevel: boolean) => {
    if (isTopLevel && item.children.length > 0) {
      toggle(item.id);
      return;
    }
    onSelectLeaf(item.label);
  };

  const tree = menuQuery.data?.items ?? [];

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}>
      <Pressable
        onPress={onClose}
        style={{
          flex: 1,
          backgroundColor: 'rgba(15, 23, 42, 0.55)',
          justifyContent: 'flex-end',
        }}>
        {/* Inner press-stop so taps inside the sheet don't bubble
            and close the backdrop. */}
        <Pressable
          onPress={() => {}}
          style={{
            backgroundColor: C.bg,
            borderTopLeftRadius: 28,
            borderTopRightRadius: 28,
            maxHeight: '88%',
            paddingBottom: Math.max(insets.bottom + 12, 24),
            shadowColor: '#000',
            shadowOpacity: 0.12,
            shadowOffset: {width: 0, height: -8},
            shadowRadius: 24,
            elevation: 24,
          }}>
          {/* Drag handle */}
          <View
            style={{
              width: 40,
              height: 4,
              borderRadius: 2,
              backgroundColor: C.border,
              alignSelf: 'center',
              marginTop: 12,
              marginBottom: 16,
            }}
          />

          {/* Header */}
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'flex-end',
              justifyContent: 'space-between',
              paddingHorizontal: 20,
              paddingBottom: 12,
              borderBottomWidth: 1,
              borderBottomColor: C.border,
            }}>
            <View style={{flex: 1}}>
              <Text
                style={{
                  fontSize: 10,
                  fontWeight: '700',
                  letterSpacing: 1.8,
                  color: C.textTertiary,
                }}>
                EVERYTHING
              </Text>
              <Text
                style={{
                  fontSize: 22,
                  fontWeight: '900',
                  color: C.ink,
                  letterSpacing: -0.6,
                  marginTop: 2,
                }}>
                Browse categories
              </Text>
            </View>
            <Pressable
              onPress={onClose}
              accessibilityLabel="Close menu"
              style={({pressed}) => ({
                width: 36,
                height: 36,
                borderRadius: 18,
                backgroundColor: C.surface,
                alignItems: 'center',
                justifyContent: 'center',
                opacity: pressed ? 0.7 : 1,
              })}>
              <X color={C.ink} size={18} />
            </Pressable>
          </View>

          {/* Body */}
          {menuQuery.isLoading ? (
            <View style={{paddingVertical: 60}}>
              <Spinner />
            </View>
          ) : tree.length === 0 ? (
            <View style={{padding: 32, alignItems: 'center'}}>
              <Text
                style={{
                  fontSize: 14,
                  color: C.textSecondary,
                  textAlign: 'center',
                }}>
                Couldn't load the menu — pull to refresh and try again.
              </Text>
            </View>
          ) : (
            <ScrollView
              contentContainerStyle={{paddingVertical: 6}}
              showsVerticalScrollIndicator={false}>
              {tree.map((item, idx) => {
                const isOpen = openIds.has(item.id);
                const hasChildren = item.children.length > 0;
                return (
                  <View
                    key={item.id}
                    style={{
                      borderBottomWidth: idx < tree.length - 1 ? 1 : 0,
                      borderBottomColor: C.border,
                    }}>
                    <Pressable
                      onPress={() => onPress(item, true)}
                      style={({pressed}) => ({
                        flexDirection: 'row',
                        alignItems: 'center',
                        paddingHorizontal: 20,
                        paddingVertical: 16,
                        opacity: pressed ? 0.7 : 1,
                      })}>
                      <Text
                        style={{
                          flex: 1,
                          fontSize: 16,
                          fontWeight: '700',
                          color: C.ink,
                          letterSpacing: -0.3,
                        }}>
                        {item.label}
                      </Text>
                      {hasChildren ? (
                        isOpen ? (
                          <ChevronDown color={C.textTertiary} size={18} />
                        ) : (
                          <ChevronRight color={C.textTertiary} size={18} />
                        )
                      ) : (
                        <ChevronRight color={C.textMuted} size={16} />
                      )}
                    </Pressable>

                    {/* Children — each second-level group is a card that
                        expands into its leaves as chips. Rendered only when
                        the parent is open so the sheet stays scroll-light. */}
                    {isOpen && hasChildren ? (
                      <View
                        style={{
                          paddingHorizontal: 14,
                          paddingTop: 4,
                          paddingBottom: 12,
                          backgroundColor: C.bg,
                        }}>
                        {item.children.map(child => {
                          const childIsOpen = openIds.has(child.id);
                          const childHasGrandchildren =
                            child.children.length > 0;
                          return (
                            <View
                              key={child.id}
                              style={{
                                backgroundColor: C.surface,
                                borderRadius: 16,
                                borderWidth: 1,
                                borderColor: C.border,
                                marginBottom: 8,
                                overflow: 'hidden',
                              }}>
                              <Pressable
                                onPress={() =>
                                  childHasGrandchildren
                                    ? toggle(child.id)
                                    : onSelectLeaf(child.label)
                                }
                                style={({pressed}) => ({
                                  flexDirection: 'row',
                                  alignItems: 'center',
                                  paddingVertical: 13,
                                  paddingHorizontal: 14,
                                  backgroundColor: pressed
                                    ? C.surfaceSage
                                    : C.surface,
                                })}>
                                {/* Accent dot anchors the group row and
                                    lights up when the group is open. */}
                                <View
                                  style={{
                                    width: 7,
                                    height: 7,
                                    borderRadius: 4,
                                    backgroundColor: childIsOpen
                                      ? C.sageDeep
                                      : C.border,
                                    marginRight: 12,
                                  }}
                                />
                                <Text
                                  style={{
                                    flex: 1,
                                    fontSize: 15,
                                    fontWeight: '700',
                                    color: C.ink,
                                    letterSpacing: -0.2,
                                  }}>
                                  {child.label}
                                </Text>
                                {childHasGrandchildren ? (
                                  <>
                                    <Text
                                      style={{
                                        fontSize: 12,
                                        fontWeight: '700',
                                        color: C.textMuted,
                                        marginRight: 8,
                                      }}>
                                      {child.children.length}
                                    </Text>
                                    {childIsOpen ? (
                                      <ChevronDown
                                        color={C.textTertiary}
                                        size={16}
                                      />
                                    ) : (
                                      <ChevronRight
                                        color={C.textTertiary}
                                        size={16}
                                      />
                                    )}
                                  </>
                                ) : (
                                  <ChevronRight color={C.textMuted} size={15} />
                                )}
                              </Pressable>

                              {/* Leaves as wrap chips — bigger tap targets and
                                  a cleaner look than a nested vertical list. */}
                              {childIsOpen && childHasGrandchildren ? (
                                <View
                                  style={{
                                    flexDirection: 'row',
                                    flexWrap: 'wrap',
                                    paddingHorizontal: 14,
                                    paddingBottom: 14,
                                    paddingTop: 2,
                                    gap: 8,
                                  }}>
                                  {child.children.map(grandchild => (
                                    <Pressable
                                      key={grandchild.id}
                                      onPress={() =>
                                        onSelectLeaf(grandchild.label)
                                      }
                                      style={({pressed}) => ({
                                        paddingVertical: 8,
                                        paddingHorizontal: 14,
                                        borderRadius: 999,
                                        backgroundColor: pressed
                                          ? C.surfaceSage
                                          : C.surfaceWarm,
                                        borderWidth: 1,
                                        borderColor: C.border,
                                      })}>
                                      <Text
                                        style={{
                                          fontSize: 13,
                                          fontWeight: '600',
                                          color: C.inkSoft,
                                          letterSpacing: -0.1,
                                        }}>
                                        {grandchild.label}
                                      </Text>
                                    </Pressable>
                                  ))}
                                </View>
                              ) : null}
                            </View>
                          );
                        })}
                      </View>
                    ) : null}
                  </View>
                );
              })}
            </ScrollView>
          )}
        </Pressable>
      </Pressable>
    </Modal>
  );
}
