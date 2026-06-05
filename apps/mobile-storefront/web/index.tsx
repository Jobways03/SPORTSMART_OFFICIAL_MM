// Make Alert.alert work in the browser (react-native-web's is a no-op).
// Must run before any component renders, so it's the first import.
import './shims/install-web-alert';
import {AppRegistry} from 'react-native';
import App from '../App';
import './tailwind.css';

// react-native-web's recommended entry pattern. AppRegistry's
// runApplication mounts the root component into the DOM element
// matching `rootTag`. Without this, we'd need to manually call
// ReactDOM.createRoot — using AppRegistry keeps the entrypoint
// shape identical to RN's so App.tsx doesn't need a separate web
// version.
AppRegistry.registerComponent('MobileStorefront', () => App);

AppRegistry.runApplication('MobileStorefront', {
  rootTag: document.getElementById('root'),
});
