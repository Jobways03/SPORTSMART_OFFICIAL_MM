import React from 'react';
import {Modal, Pressable, Text, View} from 'react-native';

// Local palette mirrors the warm/red accent scheme used across the app
// (HomeScreen / CartScreen etc.).
const C = {
  ink: '#0a0a0a',
  inkPressed: '#1a1a1a',
  textSecondary: '#52525b',
  surface: '#ffffff',
  border: '#e4e4e7',
  borderPressed: '#d4d4d8',
  danger: '#dc2626',
  dangerPressed: '#b91c1c',
  backdrop: 'rgba(15, 23, 42, 0.55)',
};

export interface ConfirmModalProps {
  visible: boolean;
  title: string;
  message?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Renders the confirm button in red — for deletes / irreversible actions. */
  destructive?: boolean;
  /** Hide the cancel button — single-action acknowledgement (e.g. an error). */
  hideCancel?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * App-styled confirmation dialog. Replaces `Alert.alert` for in-app
 * confirms: RN's Modal renders identically on iOS, Android, and
 * react-native-web, whereas `Alert.alert` is a no-op on web.
 */
export function ConfirmModal({
  visible,
  title,
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  destructive = false,
  hideCancel = false,
  onConfirm,
  onCancel,
}: ConfirmModalProps) {
  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onCancel}>
      {/* Backdrop — tapping outside dismisses (treated as cancel). */}
      <Pressable
        onPress={onCancel}
        style={{
          flex: 1,
          backgroundColor: C.backdrop,
          alignItems: 'center',
          justifyContent: 'center',
          padding: 24,
        }}>
        {/* Inner press-stop so taps on the card don't close it. */}
        <Pressable
          onPress={() => {}}
          style={{
            width: '100%',
            maxWidth: 360,
            backgroundColor: C.surface,
            borderRadius: 24,
            padding: 22,
            shadowColor: '#000',
            shadowOpacity: 0.18,
            shadowOffset: {width: 0, height: 12},
            shadowRadius: 28,
            elevation: 24,
          }}>
          <Text
            style={{
              fontSize: 18,
              fontWeight: '800',
              color: C.ink,
              letterSpacing: -0.3,
            }}>
            {title}
          </Text>
          {message ? (
            <Text
              style={{
                fontSize: 14,
                color: C.textSecondary,
                marginTop: 8,
                lineHeight: 20,
              }}>
              {message}
            </Text>
          ) : null}

          <View style={{flexDirection: 'row', gap: 10, marginTop: 22}}>
            {!hideCancel ? (
              <Pressable
                onPress={onCancel}
                accessibilityRole="button"
                style={({pressed}) => ({
                  flex: 1,
                  height: 48,
                  borderRadius: 14,
                  borderWidth: 1,
                  borderColor: C.border,
                  alignItems: 'center',
                  justifyContent: 'center',
                  backgroundColor: pressed ? C.borderPressed : C.surface,
                })}>
                <Text style={{fontSize: 14, fontWeight: '700', color: C.ink}}>
                  {cancelLabel}
                </Text>
              </Pressable>
            ) : null}
            <Pressable
              onPress={onConfirm}
              accessibilityRole="button"
              style={({pressed}) => ({
                flex: 1,
                height: 48,
                borderRadius: 14,
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: destructive
                  ? pressed
                    ? C.dangerPressed
                    : C.danger
                  : pressed
                    ? C.inkPressed
                    : C.ink,
              })}>
              <Text style={{fontSize: 14, fontWeight: '700', color: '#ffffff'}}>
                {confirmLabel}
              </Text>
            </Pressable>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}
