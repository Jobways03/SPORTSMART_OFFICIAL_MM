export const storageConfig = () => ({
  bucket: process.env.S3_BUCKET || '',
  region: process.env.S3_REGION || '',
  accessKey: process.env.S3_ACCESS_KEY || '',
  secretKey: process.env.S3_SECRET_KEY || '',
});
