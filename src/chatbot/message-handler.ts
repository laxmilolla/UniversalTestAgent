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
    console.log('DEBUG: Added user message to history');

    try {
      // Get available tools from MCP server
      console.log('DEBUG: Getting tools from MCP server');
      const tools = this.mcpClient.getTools();
      console.log('DEBUG: Got tools:', tools.length);

      // Generate response from Bedrock
      console.log('DEBUG: Calling Bedrock client');
      const bedrockResponse = await this.bedrockClient.generateResponse(
        this.conversationHistory.map(msg => ({
          role: msg.role,
          content: msg.content
        })),
        tools
      );
      console.log('DEBUG: Got Bedrock response:', bedrockResponse);

      // Create assistant message
      const assistantMsg: ChatMessage = {
        id: this.generateId(),
        role: 'assistant',
        content: bedrockResponse.content,
        timestamp: new Date(),
        toolCalls: bedrockResponse.toolCalls
      };

      // Execute tool calls if any
      if (bedrockResponse.toolCalls && bedrockResponse.toolCalls.length > 0) {
        console.log(`DEBUG: Executing ${bedrockResponse.toolCalls.length} tool calls`);
        const toolResults = await this.mcpClient.callTools(bedrockResponse.toolCalls);
        assistantMsg.toolResults = toolResults;
        console.log('DEBUG: Tool execution completed');

        // Update assistant message with tool results
        const toolResultsText = this.formatToolResults(toolResults);
        assistantMsg.content += `\n\n**Tool Execution Results:**\n${toolResultsText}`;

        // Check if we need to continue with more actions
        if (this.shouldContinueWithMoreActions(userMessage, toolResults)) {
          console.log('DEBUG: Continuing with more actions');
          const followUpResponse = await this.continueWithMoreActions(userMessage, toolResults);
          if (followUpResponse) {
            assistantMsg.content += `\n\n${followUpResponse.content}`;
            if (followUpResponse.toolResults) {
              assistantMsg.toolResults = [...(assistantMsg.toolResults || []), ...followUpResponse.toolResults];
            }
          }
        }
      }

      this.conversationHistory.push(assistantMsg);
      console.log('DEBUG: Message processing completed successfully');
      return assistantMsg;

    } catch (error) {
      console.log('DEBUG: Error in processMessage:', error);
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

  private shouldContinueWithMoreActions(userMessage: string, toolResults: ToolResult[]): boolean {
    const message = userMessage.toLowerCase();
    const hasNavigation = toolResults.some(result => 
      result.success && 
      result.result && 
      Array.isArray(result.result) && 
      result.result.some((item: any) => item.text && item.text.includes('Navigated to'))
    );
    
    // Check if user asked for screenshot specifically
    const needsScreenshot = message.includes('screenshot') && hasNavigation;
    
    console.log('DEBUG: Should continue with more actions:', needsScreenshot);
    return needsScreenshot;
  }

  private async continueWithMoreActions(userMessage: string, previousResults: ToolResult[]): Promise<ChatMessage | null> {
    try {
      console.log('DEBUG: Continuing with more actions for:', userMessage);
      
      // Create a specific follow-up message for screenshots
      const followUpMessage = `Now take a screenshot of the current page`;
      
      const followUpMsg: ChatMessage = {
        id: this.generateId(),
        role: 'user',
        content: followUpMessage,
        timestamp: new Date()
      };
      this.conversationHistory.push(followUpMsg);

      // Get tools and generate response
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

      // Execute follow-up tool calls
      if (bedrockResponse.toolCalls && bedrockResponse.toolCalls.length > 0) {
        console.log(`DEBUG: Executing ${bedrockResponse.toolCalls.length} follow-up tool calls`);
        const toolResults = await this.mcpClient.callTools(bedrockResponse.toolCalls);
        assistantMsg.toolResults = toolResults;

        const toolResultsText = this.formatToolResults(toolResults);
        assistantMsg.content += `\n\n**Follow-up Tool Execution Results:**\n${toolResultsText}`;
      }

      this.conversationHistory.push(assistantMsg);
      return assistantMsg;

    } catch (error) {
      console.log('DEBUG: Error in continueWithMoreActions:', error);
      return null;
    }
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

  getConversationHistory(): ChatMessage[] {
    return this.conversationHistory;
  }

  clearHistory(): void {
    this.conversationHistory = [];
  }
}
