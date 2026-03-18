export const appConfig = () => ({
  name: process.env.APP_NAME || 'sportsmart-api',
  url: process.env.APP_URL || 'http://localhost:4000',
  port: Number(process.env.PORT || 4000),
});
