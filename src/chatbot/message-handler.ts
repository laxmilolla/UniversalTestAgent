import { BedrockClient } from './bedrock-client';
import { MCPPlaywrightClient } from './mcp-client';
import { ChatMessage, BedrockResponse, ToolCall, ToolResult } from './types';

export class MessageHandler {
  private bedrockClient: BedrockClient;
  private mcpClient: MCPPlaywrightClient;
  private conversationHistory: ChatMessage[] = [];

  constructor(bedrockClient: BedrockClient, mcpClient: MCPPlaywrightClient) {
    this.bedrockClient = bedrockClient;
    this.mcpClient = mcpClient;
  }

  async processMessage(userMessage: string): Promise<ChatMessage> {
    console.log('DEBUG: MessageHandler.processMessage called with:', userMessage);

    // Add user message to history
    const userMsg: ChatMessage = {
      id: this.generateId(),
      role: 'user',
      content: userMessage,
      timestamp: new Date()
    };
    this.conversationHistory.push(userMsg);

    try {
      // Check if this is a compound command
      const compoundCommands = this.parseCompoundCommand(userMessage);
      
      if (compoundCommands.length > 1) {
        console.log('DEBUG: Detected compound command, generating multiple tool calls');
        return await this.executeCompoundCommand(compoundCommands, userMessage);
      }

      // Single command - use normal Bedrock flow
      const tools = this.mcpClient.getTools();
      const bedrockResponse = await this.bedrockClient.generateResponse(
        this.conversationHistory.map(msg => ({
          role: msg.role,
          content: msg.content
        })),
        tools
      );

      const assistantMsg: ChatMessage = {
        id: this.generateId(),
        role: 'assistant',
        content: bedrockResponse.content,
        timestamp: new Date(),
        toolCalls: bedrockResponse.toolCalls
      };

      if (bedrockResponse.toolCalls && bedrockResponse.toolCalls.length > 0) {
        const toolResults = await this.mcpClient.callTools(bedrockResponse.toolCalls);
        assistantMsg.toolResults = toolResults;
        const toolResultsText = this.formatToolResults(toolResults);
        assistantMsg.content += `\n\n**Tool Execution Results:**\n${toolResultsText}`;
      }

      this.conversationHistory.push(assistantMsg);
      return assistantMsg;

    } catch (error) {
      console.error('Error processing message:', error);
      const errorMsg: ChatMessage = {
        id: this.generateId(),
        role: 'assistant',
        content: `Sorry, I encountered an error: ${error.message}`,
        timestamp: new Date()
      };
      this.conversationHistory.push(errorMsg);
      return errorMsg;
    }
  }

  private parseCompoundCommand(message: string): string[] {
    const commands: string[] = [];
    const lowerMessage = message.toLowerCase();

    // Common compound command patterns
    if (lowerMessage.includes(' and ')) {
      const parts = message.split(/\s+and\s+/i);
      commands.push(...parts);
    } else if (lowerMessage.includes(' then ')) {
      const parts = message.split(/\s+then\s+/i);
      commands.push(...parts);
    } else if (lowerMessage.includes(' after ')) {
      const parts = message.split(/\s+after\s+/i);
      commands.push(...parts);
    } else {
      // Single command
      commands.push(message);
    }

    return commands.map(cmd => cmd.trim()).filter(cmd => cmd.length > 0);
  }

  private async executeCompoundCommand(commands: string[], originalMessage: string): Promise<ChatMessage> {
    const allToolCalls: ToolCall[] = [];
    const allToolResults: ToolResult[] = [];
    let responseText = `I'll execute your compound request: "${originalMessage}"\n\nHere's what I'm going to do:\n`;

    // Generate tool calls for each command
    for (let i = 0; i < commands.length; i++) {
      const command = commands[i];
      responseText += `${i + 1}. ${command}\n`;
      
      const toolCalls = await this.generateToolCallsForCommand(command);
      allToolCalls.push(...toolCalls);
    }

    responseText += `\nLet's execute these actions:\n`;

    // Execute all tool calls
    if (allToolCalls.length > 0) {
      console.log(`DEBUG: Executing ${allToolCalls.length} tool calls for compound command`);
      const toolResults = await this.mcpClient.callTools(allToolCalls);
      allToolResults.push(...toolResults);
      const toolResultsText = this.formatToolResults(toolResults);
      responseText += `\n**Tool Execution Results:**\n${toolResultsText}`;
    }

    const assistantMsg: ChatMessage = {
      id: this.generateId(),
      role: 'assistant',
      content: responseText,
      timestamp: new Date(),
      toolCalls: allToolCalls,
      toolResults: allToolResults
    };

    this.conversationHistory.push(assistantMsg);
    return assistantMsg;
  }

  private async generateToolCallsForCommand(command: string): Promise<ToolCall[]> {
    const lowerCommand = command.toLowerCase();
    const toolCalls: ToolCall[] = [];

    // Navigation patterns
    if (lowerCommand.includes('go to') || lowerCommand.includes('navigate to') || lowerCommand.includes('visit')) {
      const urlMatch = command.match(/(?:go to|navigate to|visit)\s+([^\s]+)/i);
      if (urlMatch) {
        let url = urlMatch[1];
        if (!url.startsWith('http')) {
          url = 'https://' + url;
        }
        toolCalls.push({
          id: this.generateId(),
          name: 'playwright_navigate',
          parameters: { url: url }
        });
      }
    }

    // Screenshot patterns
    if (lowerCommand.includes('screenshot') || lowerCommand.includes('take a screenshot') || lowerCommand.includes('capture')) {
      toolCalls.push({
        id: this.generateId(),
        name: 'playwright_screenshot',
        parameters: { name: `screenshot_${Date.now()}` }
      });
    }

    // Click patterns
    if (lowerCommand.includes('click')) {
      const clickMatch = command.match(/click\s+(.+)/i);
      if (clickMatch) {
        toolCalls.push({
          id: this.generateId(),
          name: 'playwright_click',
          parameters: { selector: clickMatch[1] }
        });
      }
    }

    // Search patterns - HYBRID APPROACH
    if (lowerCommand.includes('search for')) {
      const searchMatch = command.match(/search for\s+(.+)/i);
      if (searchMatch) {
        const searchTerm = searchMatch[1];
        
        // Step 1: Try generic selectors first (fast)
        const genericSelectors = [
          'input[type="search"]',
          'input[name="q"]',
          'input[placeholder*="search"]',
          'input[aria-label*="search"]',
          'input[role="searchbox"]',
          'input[class*="search"]',
          'input[id*="search"]'
        ];

        // Step 2: Try each generic selector
        for (const selector of genericSelectors) {
          console.log("Trying selector:", selector);
          toolCalls.push({
            id: this.generateId(),
            name: 'playwright_click',
            parameters: { selector: selector }
          });
          toolCalls.push({
            id: this.generateId(),
            name: 'playwright_fill',
            parameters: { selector: selector, value: searchTerm }
          });
          toolCalls.push({
            id: this.generateId(),
            name: 'playwright_press_key',
            parameters: { key: 'Enter' }
          });
          break; // Try first selector, if it fails, we'll handle it
        }
      }
    }

    // Fill form patterns
    if (lowerCommand.includes('fill') && lowerCommand.includes('form')) {
      const fillMatch = command.match(/fill\s+(.+?)\s+with\s+(.+)/i);
      if (fillMatch) {
        toolCalls.push({
          id: this.generateId(),
          name: 'playwright_fill',
          parameters: { selector: fillMatch[1], value: fillMatch[2] }
        });
      }
    }

    return toolCalls;
  }

  private formatToolResults(toolResults: ToolResult[]): string {
    return toolResults.map(result => {
      const status = result.success ? '✅' : '❌';
      const resultText = result.success
        ? JSON.stringify(result.result, null, 2)
        : `Error: ${result.error}`;

      return `${status} Tool execution ${result.success ? 'succeeded' : 'failed'}:\n${resultText}`;
    }).join('\n\n');
  }

  private generateId(): string {
    return Math.random().toString(36).substr(2, 9);
  }

  // Add missing methods for compatibility
  async handleMessage(userMessage: string, socket: any): Promise<ChatMessage> {
    return this.processMessage(userMessage);
  }

  async getAvailableTools(): Promise<any[]> {
    return this.mcpClient.getTools();
  }

  getConversationHistory(): ChatMessage[] {
    return this.conversationHistory;
  }

  clearHistory(): void {
    this.conversationHistory = [];
  }
}
