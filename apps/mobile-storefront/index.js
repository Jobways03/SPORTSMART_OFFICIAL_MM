/**
 * @format
 */

// Hermes ships a partial URLSearchParams (no `set` / `append` / `delete`),
// so every service that builds query strings throws on the first call in
// release builds. This polyfill must load before any other code that
// might invoke fetch — keep it as the very first import.
import 'react-native-url-polyfill/auto';

import {AppRegistry} from 'react-native';
import App from './App';
import {name as appName} from './app.json';

AppRegistry.registerComponent(appName, () => App);
