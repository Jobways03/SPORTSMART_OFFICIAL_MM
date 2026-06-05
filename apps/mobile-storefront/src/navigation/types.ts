import type {NavigatorScreenParams} from '@react-navigation/native';

// Root navigator — switches between the unauthenticated auth stack and the
// authenticated app shell (tabs + nested stacks).
export type RootStackParamList = {
  Auth: NavigatorScreenParams<AuthStackParamList>;
  App: NavigatorScreenParams<AppTabParamList>;
};

export type AuthStackParamList = {
  Login: undefined;
  Register: undefined;
  ForgotPassword: undefined;
  // VerifyOtp serves two flows:
  //  - 'reset' (default): password-reset OTP → navigates to ResetPassword.
  //  - 'register': email-verification OTP after sign-up → auto-logs the
  //    user in on success (password is carried through to do that).
  VerifyOtp: {email: string; mode?: 'reset' | 'register'; password?: string};
  ResetPassword: {email: string; resetToken: string};
};

export type AppTabParamList = {
  HomeTab: undefined;
  BrowseTab: NavigatorScreenParams<BrowseStackParamList>;
  CartTab: NavigatorScreenParams<CartStackParamList>;
  AccountTab: NavigatorScreenParams<AccountStackParamList>;
};

export type CartStackParamList = {
  Cart: undefined;
  Checkout: undefined;
  OrderConfirmation: {orderNumber: string; paid: boolean; cod?: boolean};
};

export type AccountStackParamList = {
  Account: undefined;
  EditProfile: undefined;
  Wishlist: undefined;
  Addresses: undefined;
  AddressForm: {addressId?: string};
  Orders: undefined;
  OrderDetail: {orderNumber: string};
  Returns: undefined;
  ReturnDetail: {returnId: string};
  CreateReturn: {masterOrderId: string};
  Wallet: undefined;
  WalletTopup: undefined;
  Invoices: undefined;
  Tickets: undefined;
  TicketDetail: {ticketId: string};
  CreateTicket: {relatedOrderNumber?: string; relatedReturnNumber?: string};
  ChangePassword: undefined;
  NotificationPreferences: undefined;
  About: undefined;
  DataExport: undefined;
  PrivacyConsent: undefined;
  AccessHistory: undefined;
  Blogs: undefined;
  BlogPost: {slug: string; title?: string};
};

// Stack inside the Browse tab — list → detail navigation. The Home tab also
// deep-links into ProductDetail via parent-nav.navigate('BrowseTab', {
// screen: 'ProductDetail', params: { productSlug } }).
export type BrowseStackParamList = {
  // Optional price bounds let the HomeScreen "Shop by price" tiles
  // deep-link into Browse with a bucket pre-applied.
  Browse: {minPrice?: number; maxPrice?: number; sort?: string; focusSearch?: boolean; openFilters?: boolean} | undefined;
  ProductDetail: {productSlug: string};
};
