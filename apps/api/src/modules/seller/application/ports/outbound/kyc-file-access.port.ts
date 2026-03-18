export interface KycFileAccessPort {
  getKycFileUrl(fileId: string): Promise<string>;
}
