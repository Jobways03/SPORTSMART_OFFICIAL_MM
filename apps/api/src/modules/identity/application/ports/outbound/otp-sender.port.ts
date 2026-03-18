export interface OtpSenderPort {
  sendOtp(destination: string, otp: string): Promise<void>;
}
