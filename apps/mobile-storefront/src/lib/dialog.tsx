import React, {useEffect, useState} from 'react';
import {Modal, Pressable, Text, View} from 'react-native';

// Imperative, app-styled replacement for React Native's `Alert.alert`,
// which is a NO-OP on react-native-web (the Vite preview we test in) —
// RNW ships `class Alert { static alert() {} }`, so any confirm/error
// dialog built on it silently does nothing and the button looks dead.
//
// `showAlert(title, message?, buttons?)` is signature-compatible with
// `Alert.alert`, so call sites are a 1:1 swap. <DialogHost/> is mounted
// once at the app root (App.tsx) and renders a real Modal, which works
// identically on web, iOS, and Android.

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

export type DialogButtonStyle = 'default' | 'cancel' | 'destructive';

export interface DialogButton {
  text: string;
  onPress?: () => void;
  style?: DialogButtonStyle;
}

interface DialogState {
  title: string;
  message?: string;
  buttons: DialogButton[];
}

// Module-level bridge so showAlert() can be called from anywhere —
// event handlers, and even plain non-React modules (e.g. imagePicker).
let emit: ((state: DialogState | null) => void) | null = null;

/**
 * Drop-in replacement for `Alert.alert(title, message?, buttons?)`.
 * Falls back to a single "OK" button when none are provided. The 4th
 * `options` arg is accepted for API-compatibility and ignored.
 */
export function showAlert(
  title: string,
  message?: string,
  buttons?: DialogButton[],
  _options?: unknown,
): void {
  emit?.({
    title,
    message,
    buttons: buttons && buttons.length > 0 ? buttons : [{text: 'OK'}],
  });
}

export function DialogHost() {
  const [state, setState] = useState<DialogState | null>(null);

  useEffect(() => {
    emit = setState;
    return () => {
      emit = null;
    };
  }, []);

  if (!state) {
    return null;
  }

  const {title, message, buttons} = state;
  const close = () => setState(null);
  const press = (button: DialogButton) => {
    close();
    button.onPress?.();
  };
  // Two buttons sit side-by-side (a confirm); one or three+ stack.
  const horizontal = buttons.length === 2;

  return (
    <Modal visible transparent animationType="fade" onRequestClose={close}>
      {/* Backdrop — tapping outside dismisses without firing a button. */}
      <Pressable
        onPress={close}
        style={{
          flex: 1,
          backgroundColor: C.backdrop,
          alignItems: 'center',
          justifyContent: 'center',
          padding: 24,
        }}>
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

          <View
            style={{
              flexDirection: horizontal ? 'row' : 'column',
              gap: 10,
              marginTop: 22,
            }}>
            {buttons.map((button, i) => {
              const destructive = button.style === 'destructive';
              const cancel = button.style === 'cancel';
              return (
                <Pressable
                  key={`${button.text}-${i}`}
                  onPress={() => press(button)}
                  accessibilityRole="button"
                  style={({pressed}) => ({
                    flex: horizontal ? 1 : undefined,
                    height: 48,
                    borderRadius: 14,
                    borderWidth: cancel ? 1 : 0,
                    borderColor: C.border,
                    alignItems: 'center',
                    justifyContent: 'center',
                    backgroundColor: cancel
                      ? pressed
                        ? C.borderPressed
                        : C.surface
                      : destructive
                        ? pressed
                          ? C.dangerPressed
                          : C.danger
                        : pressed
                          ? C.inkPressed
                          : C.ink,
                  })}>
                  <Text
                    style={{
                      fontSize: 14,
                      fontWeight: '700',
                      color: cancel ? C.ink : '#ffffff',
                    }}>
                    {button.text}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}
