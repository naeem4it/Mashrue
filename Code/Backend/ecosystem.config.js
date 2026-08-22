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
      instances: 'max', // Scale to all available CPU cores, or set 1 for low-resource VPS
      exec_mode: 'cluster',
      watch: false,
      max_memory_restart: '500M',
      restart_delay: 3000,
      max_restarts: 10,
      env_production: {
        NODE_ENV: 'production',
        PORT: 3033
      },
      error_file: '/var/log/pm2/mashrue-error.log',
      out_file: '/var/log/pm2/mashrue-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      merge_logs: true,
      min_uptime: '10s'
    }
  ]
};
