export const integrationsConfig = () => ({
  razorpay: {
    keyId: process.env.RAZORPAY_KEY_ID || '',
    keySecret: process.env.RAZORPAY_KEY_SECRET || '',
  },
  shiprocket: {
    email: process.env.SHIPROCKET_EMAIL || '',
    password: process.env.SHIPROCKET_PASSWORD || '',
  },
  opensearch: {
    node: process.env.OPENSEARCH_NODE || '',
  },
});
