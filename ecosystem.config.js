module.exports = {
  apps: [{
    name: "riftbound-bot",
    script: "dist/index.js",        // compiled JS entry
    instances: 1,
    autorestart: true,
    watch: false,
    max_memory_restart: "500M",

    // envs
    env: {
      NODE_ENV: "development"
    },
    env_production: {
      NODE_ENV: "production"
    }
  }]
};
