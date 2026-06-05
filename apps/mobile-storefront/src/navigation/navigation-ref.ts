import {createNavigationContainerRef} from '@react-navigation/native';
import type {RootStackParamList} from './types';

// Imperative navigation handle used from non-component contexts (e.g. the
// shared api-client's onAuthFailure callback, which kicks the user back to
// the auth stack when their refresh token dies). Components should keep
// using useNavigation() — this is the escape hatch for code that doesn't
// have access to the navigation prop.
export const navigationRef = createNavigationContainerRef<RootStackParamList>();
