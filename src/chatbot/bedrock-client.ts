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
      requestTimeout: 60000, // 60 second timeout
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
      
      const responseBody = JSON.parse(new TextDecoder().decode(response.body));
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
