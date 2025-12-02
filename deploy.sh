#!/bin/bash

EC3_HOST="54.80.122.209"
EC3_USER="ubuntu"
KEY_PATH="mcp-playwright-key-final.pem"
PROJECT_NAME="playwright-chatbot"

echo "Ì∫Ä Deploying $PROJECT_NAME to EC3..."

chmod 400 "$KEY_PATH"
ssh -i "$KEY_PATH" "$EC3_USER@$EC3_HOST" "mkdir -p ~/$PROJECT_NAME"
scp -i "$KEY_PATH" -r . "$EC3_USER@$EC3_HOST:~/$PROJECT_NAME/"
ssh -i "$KEY_PATH" "$EC3_USER@$EC3_HOST" "cd ~/$PROJECT_NAME && chmod +x setup.sh && ./setup.sh"

echo "‚úÖ Deployment complete!"
echo "Ìºê Your chatbot will be available at: http://$EC3_HOST:8080"
