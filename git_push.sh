#!/bin/bash

echo "🔐 Git Push Helper"
echo "This will help you push to GitHub with proper authentication"
echo ""

# Change to the project directory
cd /Users/purushottamalolla/Documents/Laxmi/AIApp/UniversalTestAgent

echo "📤 Attempting to push to GitHub..."
echo "You will be prompted for your GitHub username and password/token"
echo ""

# Try to push with expect to handle authentication
expect << 'EOF'
spawn git push
expect "Username for 'https://github.com':"
send "laxmilolla\r"
expect "Password for 'https://laxmilolla@github.com':"
interact
EOF

echo ""
echo "✅ Push completed!"
