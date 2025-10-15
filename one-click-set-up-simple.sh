#!/bin/bash

# =============================================================================
# PLAYWRIGHT CHATBOT - SIMPLE RELIABLE SETUP (FIXED)
# =============================================================================
# This script avoids AWS CLI issues and focuses on core functionality
# =============================================================================

EC2_HOST=${1:-"54.80.122.209"}
EC2_USER=${2:-"ubuntu"}
KEY_PATH=${3:-"mcp-playwright-key-final.pem"}
LOG_FILE="d_logs_simple.txt"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

log() {
    echo -e "${BLUE}[$(date +'%Y-%m-%d %H:%M:%S')]${NC} $1" | tee -a "$LOG_FILE"
}

success() {
    echo -e "${GREEN}✅ $1${NC}" | tee -a "$LOG_FILE"
}

error() {
    echo -e "${RED}❌ $1${NC}" | tee -a "$LOG_FILE"
}

# Initialize log
echo "===============================================" > "$LOG_FILE"
echo "PLAYWRIGHT CHATBOT SIMPLE SETUP (FIXED)" >> "$LOG_FILE"
echo "Started: $(date)" >> "$LOG_FILE"
echo "===============================================" >> "$LOG_FILE"

log "🚀 Starting Simple Reliable Setup (FIXED)"

# Test SSH
log "🔍 Testing SSH connection..."
if ! ssh -i "$KEY_PATH" -o ConnectTimeout=10 -o StrictHostKeyChecking=no "$EC2_USER@$EC2_HOST" "echo 'SSH OK'" >> "$LOG_FILE" 2>&1; then
    error "SSH failed"
    exit 1
fi
success "SSH verified"

# Copy files
log "📁 Copying files..."
scp -i "$KEY_PATH" -o StrictHostKeyChecking=no -r src public package.json tsconfig.json ecosystem.config.js .env "$EC2_USER@$EC2_HOST:~/playwright-chatbot/" >> "$LOG_FILE" 2>&1
success "Files copied"

# Run setup on EC2
log "⚙️ Running setup on EC2..."

ssh -i "$KEY_PATH" -o StrictHostKeyChecking=no "$EC2_USER@$EC2_HOST" << 'REMOTE_SCRIPT' 2>&1 | tee -a "$LOG_FILE"
set -e

echo "🚀 Starting Simple Setup (FIXED)..."

# Update system
echo "📦 Updating system..."
sudo apt update -y

# Install Node.js
echo " Installing Node.js..."
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs

# Install PM2
echo "📦 Installing PM2..."
sudo npm install -g pm2

# Install Playwright MCP
echo " Installing Playwright MCP..."
npm install @executeautomation/playwright-mcp-server

# Install Playwright browsers
echo " Installing Playwright browsers..."
npx playwright install --with-deps chromium

# Navigate to project directory FIRST
echo "📁 Navigating to project directory..."
cd ~/playwright-chatbot

# Verify we're in the right directory
echo "📁 Current directory: $(pwd)"
echo "📁 Project contents:"
ls -la

# Install dependencies
echo "📦 Installing dependencies..."
npm install

# Install tsx
echo "📦 Installing tsx..."
sudo npm install -g tsx

# Apply TypeScript fixes
echo " Applying TypeScript fixes..."

# Fix bedrock-client.ts
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
    this.client = new BedrockRuntimeClient({
      region: config.region,
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      },
      maxAttempts: 1,
    });
    this.modelId = config.modelId;
  }

  async generateResponse(
    messages: Array<{ role: string; content: string }>,
    tools: MCPToolDefinition[]
  ): Promise<BedrockResponse> {
    const systemPrompt = this.buildSystemPrompt(tools);

    const playwrightTools = tools.filter(tool => 
      tool.name.startsWith('playwright_') && 
      !tool.name.includes('codegen') &&
      !tool.name.includes('session')
    );

    const claudeTools = playwrightTools.map(tool => ({
      name: tool.name,
      description: tool.description,
      input_schema: tool.inputSchema
    }));

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
      const response = await this.client.send(command);
      const responseBody = JSON.parse(new TextDecoder().decode(response.body as any));
      return this.parseResponse(responseBody);
    } catch (error) {
      throw new Error(`Failed to generate response: ${error.message}`);
    }
  }

  private buildSystemPrompt(tools: MCPToolDefinition[]): string {
    return `You are a helpful assistant that can automate web browsers using Playwright tools.

Available tools:
${tools.map(tool => `- ${tool.name}: ${tool.description}`).join('\n')}

When a user asks you to perform web automation tasks, use the appropriate tools. Always explain what you're doing and provide the results.

Guidelines:
1. Use playwright_navigate to go to websites
2. Use playwright_click, playwright_fill, playwright_select for interactions
3. Use playwright_screenshot to capture visual evidence
4. Use playwright_get_visible_text or playwright_get_visible_html to extract content
5. Always wait for pages to load before interacting
6. Provide clear explanations of your actions

Respond naturally and helpfully to user requests.`;
  }

  private parseResponse(responseBody: any): BedrockResponse {
    const textContent = responseBody.content
      ?.filter((item: any) => item.type === 'text')
      ?.map((item: any) => item.text)
      ?.join('') || '';

    const toolCalls = responseBody.content
      ?.filter((item: any) => item.type === 'tool_use')
      ?.map((tool: any) => ({
        id: tool.id,
        name: tool.name,
        parameters: tool.input || {}
      })) || [];

    return {
      content: textContent,
      toolCalls,
      finishReason: responseBody.stop_reason || 'stop'
    };
  }
}
BEDROCK_FIX

# Fix mcp-client.ts
cat > src/chatbot/mcp-client.ts << 'MCP_FIX'
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { MCPToolDefinition, ToolCall, ToolResult } from './types';

export class MCPPlaywrightClient {
  private client: Client | null = null;
  private tools: MCPToolDefinition[] = [];

  async connect(): Promise<void> {
    try {
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

      const toolsResponse = await this.client.listTools();
      this.tools = toolsResponse.tools.map(tool => ({
        name: tool.name,
        description: tool.description,
        inputSchema: {
          type: 'object',
          properties: tool.inputSchema?.properties || {},
          required: Array.isArray(tool.inputSchema?.required) ? tool.inputSchema.required : []
        }
      }));

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

# Fix message-handler.ts
sed -i 's/this\.conversationHistory\.map(msg => ({/this.conversationHistory.map(msg => ({/g' src/chatbot/message-handler.ts
sed -i 's/role: msg\.role,/role: msg.role as string,/g' src/chatbot/message-handler.ts

# Fix express-server.ts
sed -i 's/server\.listen(PORT, HOST/server.listen(Number(PORT), HOST/g' src/server/express-server.ts

# Build project
echo "🔨 Building project..."
npm run build

# Start with PM2
echo "🚀 Starting PM2..."
pm2 start ecosystem.config.js

# Show status
echo "📊 PM2 Status:"
pm2 status

echo "✅ Setup Complete!"
echo " Your chatbot is running at: http://$(curl -s http://169.254.169.254/latest/meta-data/public-ipv4):8080"

REMOTE_SCRIPT

# Verify
log "🔍 Verifying deployment..."
sleep 5

# Check PM2
log "📊 Checking PM2 status..."
ssh -i "$KEY_PATH" -o StrictHostKeyChecking=no "$EC2_USER@$EC2_HOST" "cd ~/playwright-chatbot && pm2 status" >> "$LOG_FILE" 2>&1

# Test server
log " Testing server..."
if curl -s --connect-timeout 10 "http://$EC2_HOST:8080" > /dev/null 2>&1; then
    success "Server responding on port 8080"
else
    log "⚠️ Server may still be starting up"
fi

echo ""
echo "===============================================" | tee -a "$LOG_FILE"
echo "SIMPLE SETUP COMPLETED: $(date)" | tee -a "$LOG_FILE"
echo "URL: http://$EC2_HOST:8080" | tee -a "$LOG_FILE"
echo "===============================================" | tee -a "$LOG_FILE"

success "🎉 Simple setup completed! Check $LOG_FILE for logs."
echo "🌐 Access your chatbot at: http://$EC2_HOST:8080"
EOF
