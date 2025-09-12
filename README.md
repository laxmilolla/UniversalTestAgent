# Playwright Chatbot with AWS Bedrock Integration

A fully functional AI-powered web automation chatbot that integrates AWS Bedrock (Claude 3 Haiku) with Playwright for browser automation.

## Features

- **AWS Bedrock Integration**: Uses Claude 3 Haiku for natural language processing
- **Playwright Automation**: Real browser automation with headless Chrome
- **Multi-action Support**: Can chain multiple actions (navigate + screenshot)
- **MCP Protocol**: Uses Model Context Protocol for tool communication
- **Real-time Chat**: WebSocket-based chat interface
- **Screenshot Capture**: Automatically captures and saves screenshots
- **Production Ready**: PM2 configuration for deployment

## Quick Start

1. **Install dependencies**:
   ```bash
   npm install
   ```

2. **Configure environment**:
   ```bash
   cp .env.example .env
   # Edit .env with your AWS credentials
   ```

3. **Run the server**:
   ```bash
   npm run dev
   ```

4. **Access the chatbot**:
   Open http://localhost:8080 in your browser

## Usage Examples

- "go to google.com and take a screenshot"
- "navigate to youtube.com and search for cats"
- "go to github.com and click on the search box"

## Screenshots

The chatbot automatically saves screenshots to the Downloads folder and displays them in the chat interface.

## Production Deployment

Use PM2 for production deployment:

```bash
pm2 start ecosystem.config.js
```

## Architecture

- **Frontend**: HTML/CSS/JavaScript with Socket.IO
- **Backend**: Express.js with TypeScript
- **AI**: AWS Bedrock (Claude 3 Haiku)
- **Automation**: Playwright with MCP server
- **Process Management**: PM2
