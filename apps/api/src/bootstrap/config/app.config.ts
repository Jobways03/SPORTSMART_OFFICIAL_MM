export const appConfig = () => ({
  name: process.env.APP_NAME || 'sportsmart-api',
  url: process.env.APP_URL || 'http://localhost:8000',
  port: Number(process.env.PORT || 8000),
});
