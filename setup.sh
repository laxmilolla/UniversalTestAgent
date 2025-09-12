#!/bin/bash

echo " Setting up Playwright Chatbot on EC2..."

sudo apt update && sudo apt upgrade -y
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs
sudo npm install -g pm2
sudo apt install -y xvfb
npm install

# Install Playwright system dependencies
sudo npx playwright install-deps

# Install Playwright browsers
npx playwright install

# Fix version mismatch by creating symlink
cd ~/.cache/ms-playwright && ln -sf chromium-1187 chromium-1179

mkdir -p uploads screenshots logs

pm2 start ecosystem.config.js
pm2 save
pm2 startup

echo "✅ Setup complete!"
echo "🌐 Your chatbot is running at: http://$(curl -s ifconfig.me):8080"
