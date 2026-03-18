export interface SellerRegisterResponseData {
  sellerId: string;
  sellerName: string;
  sellerShopName: string;
  email: string;
  phoneNumber: string;
}

export interface SellerLoginResponseData {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  seller: {
    sellerId: string;
    sellerName: string;
    sellerShopName: string;
    email: string;
    phoneNumber: string;
    roles: string[];
    status: string;
    isEmailVerified: boolean;
  };
}
