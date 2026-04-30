-- Add AFFILIATE_ADMIN to the AdminRole enum so admins managing the
-- affiliate program (port 4006) can be scoped to that role only,
-- rather than reusing the platform-wide SUPER_ADMIN.
ALTER TYPE "AdminRole" ADD VALUE IF NOT EXISTS 'AFFILIATE_ADMIN';
