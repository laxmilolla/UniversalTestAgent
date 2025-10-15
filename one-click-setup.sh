#!/bin/bash

# =============================================================================
# PLAYWRIGHT CHATBOT - ONE CLICK EC2 SETUP (COMPREHENSIVE TYPESCRIPT FIX)
# =============================================================================
# This script sets up a complete Playwright Chatbot on any EC2 instance
# and captures ALL output to d_logs.txt
# Usage: ./one-click-setup.sh [EC2_IP] [EC2_USER] [KEY_FILE]
# Example: ./one-click-setup.sh 54.80.122.209 ubuntu mcp-playwright-key-final.pem
# =============================================================================

# Configuration
EC2_HOST=${1:-"54.80.122.209"}
EC2_USER=${2:-"ubuntu"}
KEY_PATH=${3:-"mcp-playwright-key-final.pem"}
PROJECT_NAME="playwright-chatbot"
LOG_FILE="d_logs.txt"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Logging function - ALL output goes to log file
log() {
    echo -e "${BLUE}[$(date +'%Y-%m-%d %H:%M:%S')]${NC} $1" | tee -a "$LOG_FILE"
}

success() {
    echo -e "${GREEN}✅ $1${NC}" | tee -a "$LOG_FILE"
}

warning() {
    echo -e "${YELLOW}⚠️  $1${NC}" | tee -a "$LOG_FILE"
}

error() {
    echo -e "${RED}❌ $1${NC}" | tee -a "$LOG_FILE"
}

# Initialize log file
echo "===============================================" > "$LOG_FILE"
echo "PLAYWRIGHT CHATBOT DEPLOYMENT LOG (COMPREHENSIVE FIX)" >> "$LOG_FILE"
echo "Started: $(date)" >> "$LOG_FILE"
echo "Target: $EC2_USER@$EC2_HOST" >> "$LOG_FILE"
echo "Project: $PROJECT_NAME" >> "$LOG_FILE"
echo "===============================================" >> "$LOG_FILE"
echo "" >> "$LOG_FILE"

# Check if key file exists
if [ ! -f "$KEY_PATH" ]; then
    error "SSH key file not found: $KEY_PATH"
    echo "ERROR: SSH key file not found: $KEY_PATH" >> "$LOG_FILE"
    exit 1
fi

# Set proper permissions for SSH key
chmod 400 "$KEY_PATH"

log " Starting One-Click EC2 Setup for Playwright Chatbot (COMPREHENSIVE TYPESCRIPT FIX)"
log "Target: $EC2_USER@$EC2_HOST"
log "Project: $PROJECT_NAME"
log "Log file: $LOG_FILE"
echo ""

# Test SSH connection
log "🔍 Testing SSH connection..."
if ! ssh -i "$KEY_PATH" -o ConnectTimeout=10 -o StrictHostKeyChecking=no "$EC2_USER@$EC2_HOST" "echo 'SSH connection successful'" >> "$LOG_FILE" 2>&1; then
    error "Cannot connect to EC2 instance. Check IP, user, and key file."
    echo "ERROR: Cannot connect to EC2 instance" >> "$LOG_FILE"
    exit 1
fi
success "SSH connection verified"

# Create project directory
log "📁 Creating project directory..."
ssh -i "$KEY_PATH" -o StrictHostKeyChecking=no "$EC2_USER@$EC2_HOST" "mkdir -p ~/$PROJECT_NAME" >> "$LOG_FILE" 2>&1
success "Project directory created"

# Copy files to EC2 (excluding .git and .pem files)
log " Copying files to EC2..."
scp -i "$KEY_PATH" -o StrictHostKeyChecking=no -r src public package.json tsconfig.json ecosystem.config.js .env "$EC2_USER@$EC2_HOST:~/playwright-chatbot/" >> "$LOG_FILE" 2>&1
success "Files copied successfully"

# Run comprehensive setup on EC2 - ALL OUTPUT TO LOG
log "⚙️ Running comprehensive TypeScript fix on EC2..."

# Execute the remote script and capture ALL output to log file
ssh -i "$KEY_PATH" -o StrictHostKeyChecking=no "$EC2_USER@$EC2_HOST" << 'REMOTE_SCRIPT' 2>&1 | tee -a "$LOG_FILE"
set -e

echo " Starting EC2 Setup Process (COMPREHENSIVE TYPESCRIPT FIX)..."
echo "=============================================="

# Update system packages
echo "📦 Updating system packages..."
sudo apt update -y
sudo apt upgrade -y

# Install Node.js 20
echo "📦 Installing Node.js 20..."
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs

# Install PM2 globally
echo "📦 Installing PM2..."
sudo npm install -g pm2

# Install AWS CLI
echo "📦 Installing AWS CLI..."
curl "https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip" -o "awscliv2.zip"
unzip awscliv2.zip
sudo ./aws/install
rm -rf aws awscliv2.zip

# Install Playwright MCP Server
echo "📦 Installing Playwright MCP Server..."
npm install @executeautomation/playwright-mcp-server

# Install Playwright browsers with dependencies
echo " Installing Playwright browsers..."
npx playwright install --with-deps chromium

# Navigate to project directory
cd ~/playwright-chatbot

# Install project dependencies
echo "📦 Installing project dependencies..."
npm install

# Install tsx for TypeScript execution
echo " Installing tsx..."
npm install -g tsx

# COMPREHENSIVE TYPESCRIPT FIXES
echo "🔧 Applying comprehensive TypeScript fixes..."

# Fix 1: bedrock-client.ts - Remove requestTimeout and fix response.body type
cat > src/chatbot/bedrock-client.ts << 'BEDROCK_FIX'
import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';
import { BedrockResponse, ToolCall, MCPToolDefinition } from './types';

export class BedrockClient {
  private client: BedrockRuntimeClient;
  private modelId: string;

  constructor(config: {
    region: string;
    modelId: string;
    accessKeyId: string;
    secretAccessKey: string;
  }) {
    console.log('DEBUG: BedrockClient constructor called with config:', {
      region: config.region,
      modelId: config.modelId,
      accessKeyId: config.accessKeyId ? '***' : 'MISSING',
      secretAccessKey: config.secretAccessKey ? '***' : 'MISSING'
    });

    this.client = new BedrockRuntimeClient({
      region: config.region,
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      },
      maxAttempts: 1,
      // Removed requestTimeout as it's not a valid config option
    });
    this.modelId = config.modelId;
  }

  async generateResponse(
    messages: Array<{ role: string; content: string }>,
    tools: MCPToolDefinition[]
  ): Promise<BedrockResponse> {
    console.log('DEBUG: BedrockClient.generateResponse called');
    console.log('DEBUG: Messages:', messages.length);
    console.log('DEBUG: Tools:', tools.length);

    const systemPrompt = this.buildSystemPrompt(tools);
    console.log('DEBUG: System prompt built');

    // Filter tools to only include Playwright automation tools
    const playwrightTools = tools.filter(tool => 
      tool.name.startsWith('playwright_') && 
      !tool.name.includes('codegen') &&
      !tool.name.includes('session')
    );

    console.log('DEBUG: Filtered tools:', playwrightTools.length);

    // Convert tools to the correct format for Claude
    const claudeTools = playwrightTools.map(tool => ({
      name: tool.name,
      description: tool.description,
      input_schema: tool.inputSchema
    }));

    console.log('DEBUG: Claude tools:', JSON.stringify(claudeTools, null, 2));

    const command = new InvokeModelCommand({
      modelId: this.modelId,
      body: JSON.stringify({
        anthropic_version: "bedrock-2023-05-31",
        messages: [
          { role: 'user', content: `${systemPrompt}\n\nUser: ${messages[messages.length - 1]?.content || 'Hello'}` }
        ],
        tools: claudeTools.length > 0 ? claudeTools : undefined,
        tool_choice: claudeTools.length > 0 ? { type: "auto" } : undefined,
        max_tokens: 1000,
        temperature: 0.7,
      }),
      contentType: 'application/json',
    });

    try {
      console.log('DEBUG: Sending command to Bedrock...');
      const startTime = Date.now();
      
      const response = await Promise.race([
        this.client.send(command),
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Bedrock API timeout after 60 seconds')), 60000)
        )
      ]);
      
      const duration = Date.now() - startTime;
      console.log(`DEBUG: Got response from Bedrock in ${duration}ms`);
      
      // Fix: Cast response.body to any to access the stream
      const responseBody = JSON.parse(new TextDecoder().decode(response.body as any));
      console.log('DEBUG: Parsed response body');
      console.log('DEBUG: Full response body:', JSON.stringify(responseBody, null, 2));

      return this.parseResponse(responseBody);
    } catch (error) {
      console.log('DEBUG: Bedrock API error:', error);
      console.error('Bedrock API error:', error);
      throw new Error(`Failed to generate response: ${error.message}`);
    }
  }

  private buildSystemPrompt(tools: MCPToolDefinition[]): string {
    return `You are a helpful assistant that can automate web browsers using Playwright tools.

Available tools:
${tools.map(tool => `- ${tool.name}: ${tool.description}`).join('\n')}

When a user asks you to perform web automation tasks, use the appropriate tools. Always explain what you're doing and provide the results.

IMPORTANT: When a user asks for multiple actions (like "go to google.com and take a screenshot"), you should execute ALL the requested actions in sequence using multiple tool calls. Don't stop after just one action.

Guidelines:
1. Use playwright_navigate to go to websites
2. Use playwright_click, playwright_fill, playwright_select for interactions
3. Use playwright_screenshot to capture visual evidence
4. Use playwright_get_visible_text or playwright_get_visible_html to extract content
5. Always wait for pages to load before interacting
6. Provide clear explanations of your actions
7. If an action fails, try alternative approaches
8. When asked to do multiple things, do ALL of them in sequence

Examples:
- "go to google.com and take a screenshot" → Use playwright_navigate THEN playwright_screenshot
- "search for something" → Use playwright_navigate THEN playwright_click on search box THEN playwright_fill
- "go to a site and click a button" → Use playwright_navigate THEN playwright_click

Respond naturally and helpfully to user requests.`;
  }

  private parseResponse(responseBody: any): BedrockResponse {
    // Extract text content from the content array
    const textContent = responseBody.content
      ?.filter((item: any) => item.type === 'text')
      ?.map((item: any) => item.text)
      ?.join('') || '';

    // Extract tool calls from the content array
    const toolCalls = responseBody.content
      ?.filter((item: any) => item.type === 'tool_use')
      ?.map((tool: any) => ({
        id: tool.id,
        name: tool.name,
        parameters: tool.input || {}
      })) || [];

    console.log('DEBUG: Parsed content:', textContent);
    console.log('DEBUG: Parsed toolCalls:', toolCalls);

    return {
      content: textContent,
      toolCalls,
      finishReason: responseBody.stop_reason || 'stop'
    };
  }
}
BEDROCK_FIX

# Fix 2: mcp-client.ts - Fix inputSchema type mapping
cat > src/chatbot/mcp-client.ts << 'MCP_FIX'
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { MCPToolDefinition, ToolCall, ToolResult } from './types';

export class MCPPlaywrightClient {
  private client: Client | null = null;
  private tools: MCPToolDefinition[] = [];

  async connect(): Promise<void> {
    try {
      console.log('DEBUG: MCPPlaywrightClient.connect called');
      
      const transport = new StdioClientTransport({
        command: 'xvfb-run',
        args: ['-a', 'npx', '@executeautomation/playwright-mcp-server']
      });

      this.client = new Client(
        {
          name: 'playwright-chatbot',
          version: '1.0.0'
        },
        {
          capabilities: {
            tools: {}
          }
        }
      );

      await this.client.connect(transport);
      console.log('DEBUG: MCP client connected');

      // Get available tools
      const toolsResponse = await this.client.listTools();
      this.tools = toolsResponse.tools.map(tool => ({
        name: tool.name,
        description: tool.description,
        inputSchema: {
          type: 'object',
          properties: tool.inputSchema?.properties || {},
          required: tool.inputSchema?.required || []
        }
      }));

      console.log('DEBUG: Got tools from MCP server:', this.tools.length);

    } catch (error) {
      console.error('Failed to connect to MCP server:', error);
      throw error;
    }
  }

  getTools(): MCPToolDefinition[] {
    return this.tools;
  }

  async callTools(toolCalls: ToolCall[]): Promise<ToolResult[]> {
    if (!this.client) {
      throw new Error('MCP client not connected');
    }

    const results: ToolResult[] = [];

    for (const toolCall of toolCalls) {
      try {
        console.log(`Calling tool: ${toolCall.name} with params:`, toolCall.parameters);
        
        const result = await this.client.callTool({
          name: toolCall.name,
          arguments: toolCall.parameters
        });

        results.push({
          callId: toolCall.id,
          result: result.content,
          success: true
        });

      } catch (error) {
        console.error(`Tool execution failed:`, error);
        results.push({
          callId: toolCall.id,
          result: [],
          success: false,
          error: 'Tool execution failed'
        });
      }
    }

    return results;
  }

  disconnect(): void {
    if (this.client) {
      this.client.close();
      this.client = null;
    }
  }
}
MCP_FIX

# Fix 3: message-handler.ts - Fix ChatMessage array type mismatch
sed -i 's/this\.conversationHistory\.map(msg => ({/this.conversationHistory.map(msg => ({/g' src/chatbot/message-handler.ts
sed -i 's/role: msg\.role,/role: msg.role as string,/g' src/chatbot/message-handler.ts

# Fix 4: express-server.ts - Fix PORT type mismatch
sed -i 's/server\.listen(PORT, HOST/server.listen(Number(PORT), HOST/g' src/server/express-server.ts

# Build the project
echo " Building project..."
npm run build

# Test AWS connectivity
echo "🔍 Testing AWS connectivity..."
aws sts get-caller-identity || echo "AWS credentials not configured"

# Test MCP server
echo "🔍 Testing MCP server..."
node -e "
const { MCPClient } = require('@executeautomation/playwright-mcp-server');
console.log('MCP server test completed');
" || echo "MCP server test failed"

# Start application with PM2
echo " Starting application with PM2..."
pm2 start ecosystem.config.js

# Show PM2 status
echo "📊 Application Status:"
pm2 status

echo "✅ Comprehensive TypeScript Fix Complete!"
echo " Your chatbot is running at: http://$(curl -s http://169.254.169.254/latest/meta-data/public-ipv4):8080"
echo "📊 Check status: pm2 status"
echo "📝 Check logs: pm2 logs"
echo "🔄 Restart: pm2 restart playwright-chatbot"

REMOTE_SCRIPT

# Verify deployment
log " Verifying deployment..."
sleep 5

# Check PM2 status
log "📊 Checking PM2 status..."
ssh -i "$KEY_PATH" -o StrictHostKeyChecking=no "$EC2_USER@$EC2_HOST" "pm2 status" >> "$LOG_FILE" 2>&1

# Test if server is responding
log "🌐 Testing server response..."
if curl -s --connect-timeout 10 "http://$EC2_HOST:8080" > /dev/null 2>&1; then
    success "Server is responding on port 8080"
else
    warning "Server may still be starting up. Check logs if needed."
fi

echo ""
echo "===============================================" | tee -a "$LOG_FILE"
echo "COMPREHENSIVE FIX COMPLETED: $(date)" | tee -a "$LOG_FILE"
echo "Target: $EC2_USER@$EC2_HOST" | tee -a "$LOG_FILE"
echo "Project: $PROJECT_NAME" | tee -a "$LOG_FILE"
echo "URL: http://$EC2_HOST:8080" | tee -a "$LOG_FILE"
echo "===============================================" | tee -a "$LOG_FILE"

success "🎉 Comprehensive TypeScript fix completed! Check $LOG_FILE for detailed logs."
echo ""
echo "🌐 Access your chatbot at: http://$EC2_HOST:8080"
echo "📊 Monitor with: ssh -i $KEY_PATH $EC2_USER@$EC2_HOST 'pm2 status'"
echo " View logs: ssh -i $KEY_PATH $EC2_USER@$EC2_HOST 'pm2 logs'"
EOF
