/**
 * PM2 ecosystem file for the DnDnAi bot.
 *
 * Usage:
 *   pm2 start ecosystem.config.cjs       # start (or update) the app
 *   pm2 logs dndnai                      # tail logs
 *   pm2 stop dndnai                      # stop the app
 *   pm2 restart dndnai                   # restart the app
 *   pm2 delete dndnai                    # remove from PM2's app list
 *   pm2 save                             # persist process list (needed before pm2 startup)
 *
 * Bun auto-loads .env from CWD, so DISCORD_TOKEN, GUILD_ID, ADMIN_USER_ID, etc.
 * are picked up automatically — no env block needed here.
 *
 * Logs land in ./logs/ (gitignored — see .gitignore).
 */

module.exports = {
  apps: [
    {
      name: "dndnai",
      script: "src/index.ts",
      cwd: "/home/eric/dnd/bot",
      interpreter: "/home/eric/.bun/bin/bun",
      interpreter_args: "run",

      // Restart policy
      autorestart: true,
      max_restarts: 10,
      restart_delay: 2000, // 2s between restarts
      min_uptime: "10s", // must run 10s before counting as "started"

      // Memory safety — restart if RSS exceeds 1GB (bot should never need that)
      max_memory_restart: "1G",

      // Logs
      out_file: "logs/dndnai-out.log",
      error_file: "logs/dndnai-err.log",
      merge_logs: true,
      log_date_format: "YYYY-MM-DD HH:mm:ss",

      // No clustering — Discord gateway only allows one connection per token
      instances: 1,
      exec_mode: "fork",
    },
  ],
};
