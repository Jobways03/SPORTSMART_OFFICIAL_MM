module.exports = {
  apps: [
    {
      name: 'sportsmart-api',
      script: 'dist/main.js',
      instances: 'max',           // Use all available CPU cores
      exec_mode: 'cluster',       // Enable cluster mode
      max_memory_restart: '512M', // Auto-restart if memory exceeds 512MB
      env: {
        NODE_ENV: 'development',
        PORT: 8000,
      },
      env_production: {
        NODE_ENV: 'production',
        PORT: 8000,
      },

      // Graceful shutdown
      kill_timeout: 5000,
      listen_timeout: 10000,
      shutdown_with_message: true,

      // Logging
      error_file: './logs/api-error.log',
      out_file: './logs/api-out.log',
      merge_logs: true,
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',

      // Monitoring
      max_restarts: 10,
      min_uptime: '10s',
      autorestart: true,

      // Watch (disable in production)
      watch: false,
    },
  ],
};
