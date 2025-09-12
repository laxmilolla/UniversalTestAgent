#!/bin/bash

EC2_HOST="34.232.241.105"
EC2_USER="ubuntu"
KEY_PATH="mcp-playwright-key-final.pem"
PROJECT_NAME="playwright-chatbot"

echo "Ì∫Ä Deploying $PROJECT_NAME to EC2..."

chmod 400 "$KEY_PATH"
ssh -i "$KEY_PATH" "$EC2_USER@$EC2_HOST" "mkdir -p ~/$PROJECT_NAME"
scp -i "$KEY_PATH" -r . "$EC2_USER@$EC2_HOST:~/$PROJECT_NAME/"
ssh -i "$KEY_PATH" "$EC2_USER@$EC2_HOST" "cd ~/$PROJECT_NAME && chmod +x setup.sh && ./setup.sh"

echo "‚úÖ Deployment complete!"
echo "Ìºê Your chatbot will be available at: http://$EC2_HOST:8080"
