require("dotenv").config();
import express from 'express';
import { createServer } from 'http';
import { Server as SocketIOServer } from 'socket.io';
import path from 'path';
import { MessageHandler } from '../chatbot/message-handler';
import { BedrockClient } from '../chatbot/bedrock-client';
import { MCPPlaywrightClient } from '../chatbot/mcp-client';
import { S3Uploader } from '../utils/s3-client';
import { logger } from '../utils/logger';
import { upload } from '../middleware/upload';
import multer from 'multer';
import { FileProcessor } from '../utils/file-processor';
import { LearningOrchestrator } from '../utils/learning-orchestrator';
import { PlaywrightLearningOrchestrator } from '../utils/playwright-learning-orchestrator';
import { TestGenerationOrchestrator } from '../utils/test-generation-orchestrator';
import { TestStorage } from '../utils/storage';
import { SimpleRAGClient } from '../utils/simple-rag-client';

const app = express();
const server = createServer(app);
const io = new SocketIOServer(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

// Make Socket.IO globally accessible for LLM Inspector
(global as any).io = io;

const PORT = process.env.PORT || 8080;

// Initialize clients
const bedrockClient = new BedrockClient({
  region: process.env.AWS_REGION || 'us-east-1',
  modelId: process.env.BEDROCK_MODEL_ID || 'anthropic.claude-3-5-sonnet-20241022-v2:0',
  accessKeyId: process.env.AWS_ACCESS_KEY_ID || '',
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || ''
});

const mcpClient = new MCPPlaywrightClient();
const s3Uploader = new S3Uploader();

// Connect to MCP server with better error handling
mcpClient.connect()
  .then(() => {
    logger.info('MCP server connected successfully');
  })
  .catch(error => {
    logger.warn('MCP server connection failed (this is expected on Windows):', error.message);
    logger.info('Server will continue without MCP functionality');
  });

const messageHandler = new MessageHandler(bedrockClient, mcpClient);

// Initialize the learning orchestrator
const learningOrchestrator = new LearningOrchestrator(bedrockClient);

// Initialize the playwright learning orchestrator
const playwrightLearningOrchestrator = new PlaywrightLearningOrchestrator(bedrockClient, mcpClient);

// Initialize Phase 2 components
const testStorage = new TestStorage();
const testGenerationOrchestrator = new TestGenerationOrchestrator(bedrockClient, mcpClient, testStorage, playwrightLearningOrchestrator.getRagClient());

// Middleware
app.use(express.json());
app.use(express.static(path.join(__dirname, '../../public')));

// Routes
app.get('/api/tools', async (req, res) => {
  try {
    const tools = mcpClient.getTools();
    res.json({ tools });
  } catch (error) {
    logger.error('Failed to get tools:', error);
    res.json({ tools: [] }); // Return empty tools array if MCP fails
  }
});

// S3 upload endpoint
app.post('/api/upload-screenshot', async (req, res) => {
  try {
    const { filePath } = req.body;
    if (!filePath) {
      return res.status(400).json({ error: 'File path is required' });
    }

    const s3Url = await s3Uploader.uploadScreenshot(filePath);
    res.json({ 
      success: true, 
      url: s3Url,
      message: 'Screenshot uploaded to S3 successfully'
    });
  } catch (error) {
    logger.error('Failed to upload screenshot:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Failed to upload screenshot to S3' 
    });
  }
});

// S3 upload endpoint for any file
app.post('/api/upload-file', async (req, res) => {
  try {
    const { filePath, contentType } = req.body;
    if (!filePath) {
      return res.status(400).json({ error: 'File path is required' });
    }

    const s3Url = await s3Uploader.uploadFile(filePath, contentType);
    res.json({ 
      success: true, 
      url: s3Url,
      message: 'File uploaded to S3 successfully'
    });
  } catch (error) {
    logger.error('Failed to upload file:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Failed to upload file to S3' 
    });
  }
});

// Test S3 endpoint
app.get('/api/test-s3', async (req, res) => {
  try {
    // Test S3 configuration
    const config = {
      region: process.env.AWS_REGION || 'us-east-1',
      bucket: process.env.S3_BUCKET_NAME || 'playwright-chatbot-screenshots-v2',
      hasCredentials: !!(process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY)
    };
    
    res.json({ 
      success: true, 
      message: 'S3 configuration loaded',
      config 
    });
  } catch (error) {
    logger.error('S3 test failed:', error);
    res.status(500).json({ 
      success: false, 
      error: 'S3 test failed' 
    });
  }
});

// Learning Phase API endpoints
app.post('/api/learn/upload/tsv', upload.single('tsv'), (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ success: false, error: 'No TSV file uploaded' });
        }
        
        // Process TSV file
        const content = req.file.buffer.toString('utf-8');
        const data = FileProcessor.parseTSV(content);
        
        res.json({ 
            success: true, 
            message: 'TSV file uploaded and processed successfully',
            filename: req.file.originalname,
            size: req.file.size,
            records: data.length,
            fields: data.length > 0 ? Object.keys(data[0]).length : 0
        });
    } catch (error) {
        res.status(500).json({ success: false, error: 'Failed to upload TSV file' });
    }
});

app.post('/api/learn/upload/screenshot', upload.single('screenshot'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ success: false, error: 'No screenshot uploaded' });
        }
        
        // Create BedrockClient with proper configuration
        const { BedrockClient } = require('../chatbot/bedrock-client');
        const bedrockClient = new BedrockClient({
            region: process.env.AWS_REGION || 'us-east-1',
            modelId: process.env.BEDROCK_MODEL_ID || 'anthropic.claude-3-5-sonnet-20241022-v2:0',
            accessKeyId: process.env.AWS_ACCESS_KEY_ID || '',
            secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || ''
        });
        
        // Process screenshot with AI analysis
        const { LearningOrchestrator } = require('../utils/learning-orchestrator');
        const learningOrchestrator = new LearningOrchestrator(bedrockClient);
        const analysis = await learningOrchestrator.analyzeUIScreenshot(req.file);
        
        // Store analysis results globally for API access
        (global as any).screenshotAnalysis = analysis;
        
        res.json({ 
            success: true, 
            message: 'Screenshot analyzed successfully',
            analysis: analysis,
            filename: req.file.originalname,
            size: req.file.size,
            elementsDetected: analysis.totalElements || 0
        });
    } catch (error) {
        logger.error('Failed to process screenshot:', error);
        res.status(500).json({ success: false, error: 'Failed to process screenshot' });
    }
});

app.post('/api/learn/upload/schema', upload.single('schema'), (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ success: false, error: 'No schema file uploaded' });
        }
        
        // TODO: Process schema file
        res.json({ 
            success: true, 
            message: 'Schema file uploaded successfully',
            filename: req.file.originalname,
            size: req.file.size
        });
    } catch (error) {
        res.status(500).json({ success: false, error: 'Failed to upload schema file' });
    }
});

// New API endpoint for screenshot analysis
app.get('/api/learn/screenshot-analysis', (req, res) => {
    try {
        const analysis = (global as any).screenshotAnalysis;
        if (!analysis) {
            return res.status(404).json({ 
                success: false, 
                error: 'No screenshot analysis available' 
            });
        }
        
        res.json({
            success: true,
            analysis: analysis,
            elementsDetected: analysis.totalElements || 0,
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        logger.error('Failed to get screenshot analysis:', error);
        res.status(500).json({ success: false, error: 'Failed to get screenshot analysis' });
    }
});

app.post('/api/learn/start', async (req, res) => {
    try {
        const { websiteUrl, tsvData } = req.body;
        
        console.log('Starting learning process with:', { websiteUrl, tsvDataCount: tsvData?.length });
        
        const learningResults = await playwrightLearningOrchestrator.performCompleteLearning(websiteUrl, tsvData || []);
        
        // Store learning results globally for frontend access
        (global as any).learningResults = learningResults;
        
        res.json({
            success: true,
            message: 'Learning process completed successfully with Playwright',
            results: learningResults.results,
            analysis: learningResults.analysis,
            executionTrace: learningResults.executionTrace, // Add this line
            llmResponses: (global as any).llmResponses || [], // Add this line
            lastLLMResponse: (global as any).lastLLMResponse || null // Add this line
        });
    } catch (error) {
        console.error('Learning process failed:', error);
        res.status(500).json({ 
            success: false, 
            error: error.message,
            executionTrace: [] // Add this line
        });
    }
});

// Phase 2: Test Generation API endpoints
app.post('/api/test/generate', async (req, res) => {
    try {
        const { learningResults, testOptions } = req.body;
        
        if (!learningResults) {
            return res.status(400).json({
                success: false,
                error: 'Learning results are required'
            });
        }
        
        console.log('Starting test generation with learning results:', learningResults);
        
        const testGeneration = await testGenerationOrchestrator.generateTestCases(learningResults, testOptions);
        
        if (testGeneration.success) {
            res.json({
                success: true,
                message: 'Test cases generated successfully',
                testCases: testGeneration.testCases,
                statistics: testGeneration.statistics
            });
        } else {
            res.status(500).json({
                success: false,
                error: testGeneration.error || 'Test generation failed'
            });
        }
    } catch (error) {
        console.error('Test generation failed:', error);
        res.status(500).json({ 
            success: false, 
            error: 'Failed to generate test cases' 
        });
    }
});

app.get('/api/test/cases', async (req, res) => {
    try {
        const testCases = await testStorage.getAllTestCases();
        res.json({
            success: true,
            testCases: testCases,
            count: testCases.length
        });
    } catch (error) {
        console.error('Failed to get test cases:', error);
        res.status(500).json({ 
            success: false, 
            error: 'Failed to retrieve test cases' 
        });
    }
});

app.get('/api/test/cases/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const testCase = await testStorage.getTestCase(id);
        
        if (testCase) {
            res.json({
                success: true,
                testCase: testCase
            });
        } else {
            res.status(404).json({
                success: false,
                error: 'Test case not found'
            });
        }
    } catch (error) {
        console.error('Failed to get test case:', error);
        res.status(500).json({ 
            success: false, 
            error: 'Failed to retrieve test case' 
        });
    }
});

app.put('/api/test/cases/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const testCase = req.body;
        
        await testStorage.updateTestCase(testCase);
        
        res.json({
            success: true,
            message: 'Test case updated successfully'
        });
    } catch (error) {
        console.error('Failed to update test case:', error);
        res.status(500).json({ 
            success: false, 
            error: 'Failed to update test case' 
        });
    }
});

app.delete('/api/test/cases/:id', async (req, res) => {
    try {
        const { id } = req.params;
        
        await testStorage.deleteTestCase(id);
        
        res.json({
            success: true,
            message: 'Test case deleted successfully'
        });
    } catch (error) {
        console.error('Failed to delete test case:', error);
        res.status(500).json({ 
            success: false, 
            error: 'Failed to delete test case' 
        });
    }
});

app.post('/api/test/execute', async (req, res) => {
    try {
        const { testCaseIds, options } = req.body;
        
        if (!testCaseIds || !Array.isArray(testCaseIds)) {
            return res.status(400).json({
                success: false,
                error: 'Test case IDs are required'
            });
        }
        
        console.log('Starting test execution for test cases:', testCaseIds);
        
        const execution = await testGenerationOrchestrator.executeTestCases(testCaseIds, options);
        
        if (execution.success) {
            res.json({
                success: true,
                message: 'Test execution completed',
                results: execution.results,
                statistics: execution.statistics
            });
        } else {
            res.status(500).json({
                success: false,
                error: execution.error || 'Test execution failed'
            });
        }
    } catch (error) {
        console.error('Test execution failed:', error);
        res.status(500).json({ 
            success: false, 
            error: 'Failed to execute test cases' 
        });
    }
});

app.get('/api/test/results', async (req, res) => {
    try {
        const testResults = await testStorage.getAllTestResults();
        res.json({
            success: true,
            testResults: testResults,
            count: testResults.length
        });
    } catch (error) {
        console.error('Failed to get test results:', error);
        res.status(500).json({ 
            success: false, 
            error: 'Failed to retrieve test results' 
        });
    }
});

app.get('/api/test/statistics', async (req, res) => {
    try {
        const statistics = await testStorage.getTestStatistics();
        res.json({
            success: true,
            statistics: statistics
        });
    } catch (error) {
        console.error('Failed to get test statistics:', error);
        res.status(500).json({ 
            success: false, 
            error: 'Failed to retrieve test statistics' 
        });
    }
});

app.post('/api/test/export', async (req, res) => {
    try {
        const { format = 'json' } = req.body;
        
        const testCases = await testStorage.exportTestCases();
        
        if (format === 'json') {
            res.json({
                success: true,
                testCases: testCases,
                count: testCases.length
            });
        } else {
            res.status(400).json({
                success: false,
                error: 'Only JSON format is currently supported'
            });
        }
    } catch (error) {
        console.error('Failed to export test cases:', error);
        res.status(500).json({ 
            success: false, 
            error: 'Failed to export test cases' 
        });
    }
});

app.post('/api/test/import', async (req, res) => {
    try {
        const { testCases } = req.body;
        
        if (!testCases || !Array.isArray(testCases)) {
            return res.status(400).json({
                success: false,
                error: 'Test cases array is required'
            });
        }
        
        await testStorage.importTestCases(testCases);
        
        res.json({
            success: true,
            message: 'Test cases imported successfully',
            count: testCases.length
        });
    } catch (error) {
        console.error('Failed to import test cases:', error);
        res.status(500).json({ 
            success: false, 
            error: 'Failed to import test cases' 
        });
    }
});

// LLM Response Debugging Endpoints
app.get('/api/debug/llm-responses', (req, res) => {
    try {
        const responses = (global as any).llmResponses || [];
        const lastResponse = (global as any).lastLLMResponse || null;
        
        res.json({
            success: true,
            responses: responses,
            lastResponse: lastResponse,
            count: responses.length
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

app.get('/api/debug/llm-response', (req, res) => {
    try {
        const lastResponse = (global as any).lastLLMResponse || null;
        
        res.json({
            success: true,
            response: lastResponse
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Test LLM connectivity
app.get('/api/debug/test-llm', async (req, res) => {
    try {
        console.log('Testing LLM connectivity...');
        
        const testPrompt = "Hello, please respond with 'LLM is working' and nothing else.";
        const response = await bedrockClient.generateResponse([{ role: 'user', content: testPrompt }], []);
        
        console.log('LLM Test Response:', response);
        
        res.json({
            success: true,
            message: 'LLM is working',
            response: response.content,
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        console.error('LLM Test Failed:', error);
        res.status(500).json({
            success: false,
            error: error.message,
            timestamp: new Date().toISOString()
        });
    }
});

// Socket.IO connection handling
io.on('connection', (socket) => {
  logger.info('Client connected');

  socket.on('message', async (data) => {
    try {
      const response = await messageHandler.processMessage(data.message);
      socket.emit('response', { message: response });
    } catch (error) {
      logger.error('Error handling message:', error);
      socket.emit('error', { message: 'An error occurred while processing your request' });
    }
  });

  socket.on('clear-history', async () => {
    try {
      messageHandler.clearHistory();
      socket.emit('history-cleared');
    } catch (error) {
      logger.error('Error clearing history:', error);
      socket.emit('error', { message: 'Failed to clear history' });
    }
  });

  socket.on('disconnect', () => {
    logger.info('Client disconnected');
  });
});

// Start server
server.listen(Number(PORT), () => {
  logger.info(`Server running on port ${PORT}`);
  logger.info(`Access the chatbot at: http://localhost:${PORT}`);
  logger.info(`Test S3 configuration at: http://localhost:${PORT}/api/test-s3`);
});

export default app;
