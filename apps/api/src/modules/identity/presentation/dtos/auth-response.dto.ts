export interface RegisterResponseData {
  userId: string;
  email: string;
  firstName: string;
  lastName: string;
}

export interface LoginResponseData {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  user: {
    userId: string;
    email: string;
    firstName: string;
    lastName: string;
    roles: string[];
  };
}
