/**
 * Mashrue (mashrue.com) — PM2 Production Process Manager Ecosystem
 * Usage: pm2 start ecosystem.config.js --env production
 */

module.exports = {
  apps: [
    {
      name: 'mashrue-api',
      script: 'server.js',
      cwd: '/var/www/mashrue/backend',
      instances: 1,
      exec_mode: 'fork',
      watch: false,
      max_memory_restart: '500M',
      env: {
        NODE_ENV: 'production',
        PORT: 3033
      }
    }
  ]
};
