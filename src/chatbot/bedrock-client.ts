import { BedrockRuntimeClient, InvokeModelCommand, ConverseCommand } from '@aws-sdk/client-bedrock-runtime';
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
      maxAttempts: 1
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
                tool_choice: claudeTools.length > 0 ? { type: "any" } : undefined,
        max_tokens: 2000,
        temperature: 0.9,
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
      
      const responseBody = JSON.parse(new TextDecoder().decode((response as any).body));
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

��� CRITICAL RULE - NEVER BREAK THIS: ���
1. MANDATORY: When a user asks for multiple actions in ONE request - YOU MUST ALWAYS generate ALL tool calls in a SINGLE response - NEVER ask for clarification (like "go to google.com and take a screenshot"), you MUST generate MULTIPLE tool calls in your response.
2. Do NOT stop after just one action - execute ALL requested actions in sequence.
3. Each action should be a separate tool call.

EXAMPLES OF WHAT YOU MUST DO:
- User: "go to google.com and take a screenshot" 
  → Generate TWO tool calls: playwright_navigate AND playwright_screenshot

- User: "navigate to example.com and click the login button"
  → Generate TWO tool calls: playwright_navigate AND playwright_click

- User: "go to a website and fill out a form"
  → Generate MULTIPLE tool calls: playwright_navigate, playwright_click, playwright_fill, etc.

Tool Guidelines:
1. Use playwright_navigate to go to websites
2. Use playwright_click, playwright_fill, playwright_select for interactions
3. Use playwright_screenshot to capture visual evidence
4. Use playwright_get_visible_text or playwright_get_visible_html to extract content
5. Always wait for pages to load before interacting
6. Provide clear explanations of your actions
7. If an action fails, try alternative approaches

Remember: Generate ALL tool calls needed for the user's request in one response. Don't ask for clarification - just do what they asked for.

Respond naturally and helpfully to user requests.

CRITICAL: If user asks for multiple actions, generate ALL tool calls immediately. Do not wait, do not ask, just execute all requested actions in one response.`;
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

  async generateMultimodalResponse(
    messages: Array<{ role: string; content: any }>,
    tools: MCPToolDefinition[] = []
  ): Promise<BedrockResponse> {
    console.log('DEBUG: BedrockClient.generateMultimodalResponse called');
    
    const systemPrompt = this.buildSystemPrompt(tools);
    
    // Convert messages to ConverseAPI format
    const converseMessages = messages.map(msg => {
      if (typeof msg.content === 'string') {
        return { 
          role: msg.role as 'user' | 'assistant', 
          content: [{ text: `${systemPrompt}\n\n${msg.content}` }]
        };
      } else if (msg.content && msg.content.type === 'image') {
        return {
          role: msg.role as 'user' | 'assistant',
          content: [
            { text: `${systemPrompt}\n\n${msg.content.text || 'Analyze this image'}` },
            { 
              image: {
                format: 'base64' as const,
                source: {
                  bytes: Buffer.from(msg.content.data, 'base64')
                }
              }
            }
          ]
        };
      }
      return { 
        role: msg.role as 'user' | 'assistant', 
        content: [{ text: `${systemPrompt}\n\n${String(msg.content)}` }]
      };
    });

    const command = new ConverseCommand({
      modelId: this.modelId,
      messages: converseMessages as any,
      inferenceConfig: {
        maxTokens: 2000,
        temperature: 0.9
      }
    });

    try {
      const startTime = Date.now();
      const response = await this.client.send(command);
      const duration = Date.now() - startTime;
      
      const textContent = response.output?.message?.content
        ?.map(block => block.text || '')
        .join('') || '';
      
      return {
        content: textContent,
        finishReason: 'stop' as const
      };
    } catch (error) {
      console.error('Bedrock ConverseAPI error:', error);
      throw error;
    }
  }
}
