import {Platform} from 'react-native';
// Read app version from package.json so bumping the package version is
// the only place to change. Metro + Vite both resolve JSON imports
// (tsconfig has resolveJsonModule).
import {version as PKG_VERSION} from '../../package.json';

export const APP_VERSION = PKG_VERSION;
// Native build number: would come from Info.plist / Android versionCode
// via a native module like react-native-device-info. Until that's wired,
// '1' is a placeholder. CI can codegen-rewrite this constant at release.
export const APP_BUILD = '1';

// Friendly platform label for the About screen. Falls back to a generic
// 'Web' when running through Vite so we don't show an empty chip.
export const APP_PLATFORM_LABEL = (() => {
  switch (Platform.OS) {
    case 'ios':
      return 'iOS';
    case 'android':
      return 'Android';
    case 'web':
      return 'Web';
    default:
      return Platform.OS;
  }
})();
