import express from 'express';
import { createServer } from 'http';
import { Server as SocketIOServer } from 'socket.io';
import cors from 'cors';
import dotenv from 'dotenv';
import { BedrockClient } from '../chatbot/bedrock-client';
import { MCPPlaywrightClient } from '../chatbot/mcp-client';
import { MessageHandler } from '../chatbot/message-handler';
import { logger } from '../utils/logger';

dotenv.config();

const app = express();
const server = createServer(app);
const io = new SocketIOServer(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// Initialize clients
const bedrockClient = new BedrockClient({
  region: process.env.AWS_REGION || 'us-east-1',
  modelId: process.env.BEDROCK_MODEL_ID || 'anthropic.claude-3-sonnet-20240229-v1:0',
  accessKeyId: process.env.AWS_ACCESS_KEY_ID || '',
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || ''
});

const mcpClient = new MCPPlaywrightClient();
const messageHandler = new MessageHandler(bedrockClient, mcpClient);

// Initialize MCP connection
async function initializeMCP() {
  try {
    await mcpClient.connect();
    logger.info('MCP Playwright client connected successfully');
  } catch (error) {
    logger.error('Failed to connect to MCP server:', error);
    process.exit(1);
  }
}

// WebSocket connection handling
io.on('connection', (socket) => {
  logger.info('Client connected:', socket.id);

  socket.on('message', async (data) => {
    try {
      console.log('DEBUG: Message received, calling messageHandler.processMessage');
      logger.info('Received message:', data);

      console.log('DEBUG: About to call messageHandler.processMessage');
      const response = await messageHandler.processMessage(data.message);
      console.log('DEBUG: Got response from messageHandler:', response);

      console.log('DEBUG: Sending response to client');
      socket.emit('response', {
        message: response,
        conversationHistory: messageHandler.getConversationHistory()
      });
      console.log('DEBUG: Response sent to client');

    } catch (error) {
      console.log('DEBUG: Error in message processing:', error);
      logger.error('Error handling message:', error);
      socket.emit('error', {
        message: 'Sorry, I encountered an error processing your request.',
        error: error.message
      });
    }
  });

  socket.on('get-history', () => {
    socket.emit('history', messageHandler.getConversationHistory());
  });

  socket.on('clear-history', () => {
    messageHandler.clearHistory();
    socket.emit('history-cleared');
  });

  socket.on('disconnect', () => {
    logger.info('Client disconnected:', socket.id);
  });
});

// API Routes
app.get('/api/health', (req, res) => {
  res.json({ status: 'healthy', timestamp: new Date().toISOString() });
});

app.get('/api/tools', (req, res) => {
  try {
    const tools = mcpClient.getTools();
    res.json({ tools });
  } catch (error) {
    res.status(500).json({ error: 'Failed to get tools' });
  }
});

const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || 'localhost';

// Start server
async function startServer() {
  await initializeMCP();

  server.listen(PORT, HOST, () => {
    logger.info(`íº€ Chatbot server running on http://${HOST}:${PORT}`);
    logger.info(`í³± WebSocket server ready for connections`);
  });
}

startServer().catch(error => {
  logger.error('Failed to start server:', error);
  process.exit(1);
});
