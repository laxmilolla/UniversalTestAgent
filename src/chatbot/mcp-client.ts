import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { MCPToolDefinition, ToolCall, ToolResult } from './types';

export class MCPPlaywrightClient {
  private client: Client | null = null;
  private tools: MCPToolDefinition[] = [];
  private page: any = null; // Playwright Page object

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
            tools: {
              listChanged: true
            }
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
          required: Array.isArray(tool.inputSchema?.required) ? tool.inputSchema.required : []
        }
      }));

      console.log('DEBUG: Got tools from MCP server:', this.tools.length);
      console.log('DEBUG: Available tools:', this.tools.map(t => t.name));

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
        console.log(`DEBUG: Calling tool: ${toolCall.name} with params:`, toolCall.parameters);
        
        const result = await this.client.callTool({
          name: toolCall.name,
          arguments: toolCall.parameters
        });

        console.log(`DEBUG: Tool ${toolCall.name} result:`, result);

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

  getPage(): any {
    return this.page;
  }

  setPage(page: any): void {
    this.page = page;
  }

  disconnect(): void {
    if (this.client) {
      this.client.close();
      this.client = null;
    }
  }
}
