export interface FranchiseRegisterResponseData {
  franchiseId: string;
  franchiseCode: string;
  ownerName: string;
  businessName: string;
  email: string;
  phoneNumber: string;
}

export interface FranchiseLoginResponseData {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  franchise: {
    franchiseId: string;
    franchiseCode: string;
    ownerName: string;
    businessName: string;
    email: string;
    phoneNumber: string;
    roles: string[];
    status: string;
  };
}
