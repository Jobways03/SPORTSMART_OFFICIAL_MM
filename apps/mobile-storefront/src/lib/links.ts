// Single source of truth for external URLs used across screens
// (AboutScreen, RegisterScreen Terms/Privacy, LoginScreen support
// fallback). Centralising here means a dev/staging env-var swap or
// a typo-fix lands in one place.

export const LINKS = {
  website: 'https://sportsmart.com',
  privacy: 'https://sportsmart.com/privacy',
  terms: 'https://sportsmart.com/terms',
  openSource: 'https://sportsmart.com/open-source',
  supportEmail: 'support@sportsmart.com',
  social: {
    instagram: 'https://instagram.com/sportsmart',
    twitter: 'https://twitter.com/sportsmart',
    youtube: 'https://youtube.com/@sportsmart',
    github: 'https://github.com/sportsmart',
  },
} as const;

export const supportMailto = (subject = 'Mobile app support') =>
  `mailto:${LINKS.supportEmail}?subject=${encodeURIComponent(subject)}`;
