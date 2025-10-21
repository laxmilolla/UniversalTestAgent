#!/bin/bash

# GitHub to EC2 Deployment Script
EC2_HOST="54.80.122.209"
EC2_USER="ubuntu"
KEY_PATH="mcp-playwright-key-final.pem"
PROJECT_NAME="playwright-chatbot"
GITHUB_REPO="https://github.com/laxmilolla/UniversalTestAgent.git"

echo "🚀 Deploying from GitHub to EC2..."
echo "📦 Repository: $GITHUB_REPO"
echo "🖥️  EC2 Host: $EC2_HOST"

# Set proper permissions for the key
chmod 400 "$KEY_PATH"

echo "📥 Cloning repository on EC2..."
ssh -i "$KEY_PATH" "$EC2_USER@$EC2_HOST" "
    # Remove existing project directory
    rm -rf ~/$PROJECT_NAME
    
    # Clone fresh from GitHub
    git clone $GITHUB_REPO ~/$PROJECT_NAME
    
    # Navigate to project directory
    cd ~/$PROJECT_NAME
    
    # Install dependencies
    echo '📦 Installing dependencies...'
    npm install
    
    # Build the project
    echo '🔨 Building project...'
    npm run build
    
    # Apply TypeScript fixes if needed
    echo '🔧 Applying TypeScript fixes...'
    
    # Fix bedrock-client.ts if needed
    if [ -f 'src/chatbot/bedrock-client.ts' ]; then
        sed -i 's/import \* as AWS from '\''aws-sdk'\'';/import { BedrockRuntimeClient, InvokeModelCommand } from '\''@aws-sdk\/client-bedrock-runtime'\'';/' src/chatbot/bedrock-client.ts
    fi
    
    # Fix mcp-client.ts if needed
    if [ -f 'src/chatbot/mcp-client.ts' ]; then
        sed -i 's/import \* as MCP from '\''@modelcontextprotocol\/sdk'\'';/import { Client, StdioClientTransport } from '\''@modelcontextprotocol\/sdk\/client\/stdio.js'\'';/' src/chatbot/mcp-client.ts
    fi
    
    # Restart the application with PM2
    echo '🔄 Restarting application...'
    pm2 stop all || true
    pm2 start ecosystem.config.js
    
    echo '✅ Deployment from GitHub complete!'
"

echo "🎉 Deployment successful!"
echo "🌐 Your application is available at: http://$EC2_HOST:8080"
echo "📊 Check PM2 status: ssh -i $KEY_PATH $EC2_USER@$EC2_HOST 'pm2 status'"
