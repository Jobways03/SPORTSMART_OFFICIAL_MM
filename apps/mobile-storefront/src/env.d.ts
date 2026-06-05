// Type declarations for variables exposed by react-native-dotenv.
// Values come from .env at the app root; missing keys arrive as
// `undefined` because babel config sets allowUndefined: true.
declare module '@env' {
  export const RAZORPAY_KEY_ID: string | undefined;
  export const API_URL: string | undefined;
  export const SENTRY_DSN: string | undefined;
  export const SENTRY_ENVIRONMENT: string | undefined;
  export const POSTHOG_API_KEY: string | undefined;
  export const POSTHOG_HOST: string | undefined;
}

// Lets us read the package version statically rather than via a native
// module. Both Metro and Vite resolve JSON imports out of the box.
declare module '*.json' {
  const value: any;
  export default value;
  export const version: string;
}

// react-native-razorpay ships no TypeScript types. The runtime API
// surface we use is just RazorpayCheckout.open(options) which returns
// either a success object or throws an error with {code, description}.
declare module 'react-native-razorpay' {
  interface RazorpayOptions {
    key: string | undefined;
    amount: number;
    currency: string;
    name: string;
    description?: string;
    order_id?: string;
    prefill?: {
      name?: string;
      email?: string;
      contact?: string;
    };
    theme?: {color?: string};
  }
  interface RazorpaySuccess {
    razorpay_payment_id: string;
    razorpay_order_id: string;
    razorpay_signature: string;
  }
  const RazorpayCheckout: {
    open: (options: RazorpayOptions) => Promise<RazorpaySuccess>;
  };
  export default RazorpayCheckout;
}
