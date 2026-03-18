export class SessionEntity {
  id: string;
  userId: string;
  refreshToken: string;
  deviceInfo: string;
  expiresAt: Date;
  createdAt: Date;
}
