module.exports = {
  apps: [
    {
      name: "robyn-web",
      cwd: "/home/hendo420/Robyn",
      script: "/usr/local/bin/pnpm",
      args: "--filter @robyn/web start",
      env: {
        NODE_ENV: "production",
        ROBYN_ENV: "robyn-devnet",
        HOSTNAME: "0.0.0.0",
        RPC_GATEWAY_HEALTH_URL: "http://127.0.0.1:8546/health",
        PORT: "3000",
      },
      autorestart: true,
      max_memory_restart: "512M",
      time: true,
    },
    {
      name: "robyn-rpc-gateway",
      cwd: "/home/hendo420/Robyn",
      script: "/usr/local/bin/pnpm",
      args: "--filter @robyn/rpc-gateway start",
      env: {
        NODE_ENV: "production",
        PORT: "8546",
        RAW_RPC_URL: "http://127.0.0.1:8545",
      },
      autorestart: true,
      max_memory_restart: "256M",
      time: true,
    },
  ],
};
