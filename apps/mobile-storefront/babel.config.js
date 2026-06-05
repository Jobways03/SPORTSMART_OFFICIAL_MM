module.exports = {
  presets: [
    ['module:@react-native/babel-preset'],
    'nativewind/babel',
  ],
  plugins: [
    // .env loader — exposes RAZORPAY_KEY_ID, API_URL etc. via
    // `import { RAZORPAY_KEY_ID } from '@env'`. No native config needed
    // because this is a build-time string substitution. Values come
    // from apps/mobile-storefront/.env (gitignored) at Metro start.
    [
      'module:react-native-dotenv',
      {
        envName: 'APP_ENV',
        moduleName: '@env',
        path: '.env',
        safe: false,
        allowUndefined: true,
        verbose: false,
      },
    ],
  ],
};
