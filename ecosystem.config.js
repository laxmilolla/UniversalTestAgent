module.exports = {
  apps: [{
    name: 'playwright-chatbot',
    script: 'dist/server/express-server.js',
    instances: 1,
    autorestart: true,
    watch: false,
    max_memory_restart: '1G',
    env: {
      NODE_ENV: 'production',
      PORT: 8080,
      HOST: '0.0.0.0',
      // RAG Configuration - Lower similarity threshold for better recall
      RAG_MIN_SIMILARITY: '0.3',
      RAG_TOP_K_RESULTS: '20',
      RAG_CHUNK_SIZE: '30'
    },
    error_file: './logs/err.log',
    out_file: './logs/out.log',
    log_file: './logs/combined.log',
    time: true
  }]
};
