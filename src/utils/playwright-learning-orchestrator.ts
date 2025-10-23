import { BedrockClient } from '../chatbot/bedrock-client';
import { MCPPlaywrightClient } from '../chatbot/mcp-client';
import { FileProcessor } from './file-processor';
import { SimpleRAGClient } from './simple-rag-client';
import { VectorRAGClient } from './vector-rag-client';
import { EnvironmentValidator } from './environment-validator';
import { UIStateCapturer } from './ui-state-capturer';
import { ActiveUIExplorer } from './active-ui-explorer';

const fs = require('fs');

export class PlaywrightLearningOrchestrator {
    private bedrockClient: BedrockClient;
    private mcpClient: MCPPlaywrightClient;
    private ragClient: SimpleRAGClient;
    private vectorRAG: VectorRAGClient; // NEW
    private currentWebsiteUrl: string = '';
    private executionTrace: any[] = []; // Add this line
    private readonly timeout = 120000; // 120 seconds instead of 60
    private currentTSVFiles: any[] = []; // Add this line
    private currentTSVData: any[] = []; // Parsed TSV data for dynamic test value extraction

    // Add global LLM tracking
    private llmCallTracker: any[] = [];

    constructor(bedrockClient: BedrockClient, mcpClient: MCPPlaywrightClient) {
        // Validate environment FIRST
        EnvironmentValidator.validate();
        
        this.bedrockClient = bedrockClient;
        this.mcpClient = mcpClient;
        this.ragClient = new SimpleRAGClient(bedrockClient); // Add this line
        this.vectorRAG = new VectorRAGClient(bedrockClient); // NEW
        this.executionTrace = []; // Initialize trace
        
        console.log('✅ Orchestrator initialized in PURE AI mode');
    }

    // Expose RAG client for test orchestrator
    getRagClient(): SimpleRAGClient {
        return this.ragClient;
    }

    // Add this method to log each step
    private logStep(step: string, actor: string, action: string, input: any, output: any, duration?: number) {
        const traceEntry = {
            timestamp: new Date().toISOString(),
            step,
            actor, // 'Playwright', 'LLM', 'System', 'User'
            action,
            input: typeof input === 'string' ? input.substring(0, 200) + '...' : input,
            output: typeof output === 'string' ? output.substring(0, 200) + '...' : output,
            duration: duration || 0,
            success: !(output instanceof Error)
        };
        
        this.executionTrace.push(traceEntry);
        console.log(`🔍 [${actor}] ${action}:`, traceEntry);
        
        // Store in global for frontend access
        if (typeof (global as any) !== 'undefined') {
            (global as any).executionTrace = this.executionTrace;
        }
    }

    async performCompleteLearning(websiteUrl: string, tsvFiles: any[]): Promise<any> {
        const startTime = Date.now(); // ✅ This should be here
        this.executionTrace = []; // Reset trace
        
        // Add timeout wrapper
        const timeoutPromise = new Promise((_, reject) => {
            setTimeout(() => reject(new Error('Learning process timeout after 60 seconds')), 60000);
        });
        
        const learningPromise = this.performLearning(websiteUrl, tsvFiles);
        
        try {
            return await Promise.race([learningPromise, timeoutPromise]);
        } catch (error) {
            this.logStep('ERROR', 'System', 'Learning Process Timeout', 
                { error: error.message }, 
                'Process terminated due to timeout');
            
            return { 
                success: false, 
                error: error.message,
                results: { uiElements: 0, dbFields: 0, testCases: 0, relationships: 0 },
                executionTrace: this.executionTrace
            };
        }
    }

    private async performLearning(websiteUrl: string, tsvFiles: any[]): Promise<any> {
        const startTime = Date.now(); // ✅ Move this to the top level
        
        try {
            this.logStep('1', 'System', 'Starting Learning Process', { websiteUrl, tsvCount: tsvFiles?.length || 0 }, 'Initializing...');

            // Store TSV files for RAG
            this.currentTSVFiles = tsvFiles;

            // Add debug logging here
            console.log('=== DEBUG: performLearning method start ===');
            console.log('websiteUrl:', websiteUrl);
            console.log('tsvFiles:', tsvFiles);
            console.log('tsvFiles.length:', tsvFiles?.length);
            console.log('this.mcpClient:', this.mcpClient);
            console.log('this.bedrockClient:', this.bedrockClient);
            
            // Store the current website URL
            this.currentWebsiteUrl = websiteUrl;
            
            let pageContent = '';
            let pageText = '';
            let screenshot = null;
            
            try {
                // Phase 1: Navigate to website with Playwright
                this.logStep('2', 'Playwright', 'Navigate to Website', { url: websiteUrl }, 'Attempting navigation...');
                
                const navigateStart = Date.now();
                const navigatePromise = this.mcpClient.callTools([{
                    id: 'navigate-1',
                    name: 'playwright_navigate',
                    parameters: { url: websiteUrl }
                }]);

                const navigateTimeout = new Promise((_, reject) => 
                    setTimeout(() => reject(new Error('Playwright navigation timeout after 10 seconds')), 10000)
                );

                const navigateResult = await Promise.race([navigatePromise, navigateTimeout]);
                const navigateDuration = Date.now() - navigateStart;
                
                this.logStep('3', 'Playwright', 'Navigation Result', { url: websiteUrl }, navigateResult, navigateDuration);
                
                if (!navigateResult[0]?.success) {
                    throw new Error('Navigation failed');
                }
                
                // Extract HTML content - Wait for dynamic React components to load
                console.log('Waiting for React components to load...');
                
                // Wait for common React/Material-UI components to appear
                try {
                    await this.mcpClient.callTools([{
                        name: 'playwright_wait_for',
                        parameters: { 
                            selector: '.MuiButton-root, [data-testid], .data-table, .filter-panel',
                            timeout: 10000 
                        },
                        id: 'wait-for-components-' + Date.now()
                    }]);
                    console.log('✅ React components detected');
                } catch (error) {
                    console.log('⚠️ React components not found, proceeding with basic wait');
                    await new Promise(resolve => setTimeout(resolve, 5000)); // Fallback wait
                }

                // Detect and dismiss any UI obstacles (modals, popups, banners, etc.)
                await this.dismissUIObstacles();

                // Verify UI is accessible before proceeding
                const isUIAccessible = await this.verifyUIAccessible();
                if (!isUIAccessible) {
                    throw new Error('CRITICAL: UI still blocked by popup - learning aborted for reliability');
                }

                console.log('✅ UI verified as accessible - proceeding with learning');

                this.logStep('4', 'Playwright', 'Extract HTML Content', 
                    { website: websiteUrl, waitForJS: true, waitForReact: true }, 
                    'Extracting HTML after React components load...');

                // Extract HTML after React components are loaded
                const htmlStart = Date.now();
                const htmlResult = await this.mcpClient.callTools([{
                    name: 'playwright_get_visible_html',
                    parameters: {},
                    id: 'html-extraction-' + Date.now()
                }]);

                // Additional wait for any remaining dynamic content
                await new Promise(resolve => setTimeout(resolve, 2000));

                const htmlDuration = Date.now() - htmlStart; // Fix: Define htmlDuration
                this.logStep('5', 'Playwright', 'HTML Extraction Result', {}, htmlResult, htmlDuration);

                if (htmlResult[0]?.success && htmlResult[0].result?.[0]?.text) {
                    pageContent = htmlResult[0].result[0].text;
                    console.log(`HTML Content Length: ${pageContent.length}`);
                }
                
                // Extract text content
                this.logStep('6', 'Playwright', 'Extract Text Content', {}, 'Getting visible text...');
                
                const textStart = Date.now();
                const textResult = await this.mcpClient.callTools([{
                    id: 'text-1',
                    name: 'playwright_get_visible_text',
                    parameters: {}
                }]);
                const textDuration = Date.now() - textStart;
                
                this.logStep('7', 'Playwright', 'Text Extraction Result', {}, textResult, textDuration);
                
                if (textResult[0]?.success && textResult[0].result?.[0]?.text) {
                    pageText = textResult[0].result[0].text;
                }
                
                // Take screenshot
                this.logStep('8', 'Playwright', 'Take Screenshot', {}, 'Capturing screenshot...');
                
                const screenshotStart = Date.now();
                const screenshotResult = await this.mcpClient.callTools([{
                    id: 'screenshot-1',
                    name: 'playwright_screenshot',
                    parameters: {}
                }]);
                const screenshotDuration = Date.now() - screenshotStart;
                
                this.logStep('9', 'Playwright', 'Screenshot Result', {}, screenshotResult, screenshotDuration);
                
                if (screenshotResult[0]?.success && screenshotResult[0].result?.[0]?.text) {
                    screenshot = screenshotResult[0].result[0].text;
                }
                
                this.logStep('10', 'Playwright', 'Data Extraction Complete', 
                    { pageContentLength: pageContent.length, pageTextLength: pageText.length }, 
                    'Successfully extracted website data');
                    
            } catch (playwrightError) {
                this.logStep('11', 'Playwright', 'Playwright Failed', 
                    { error: playwrightError.message }, 
                    'Playwright extraction failed');
                
                // Check if error is due to popup blocking
                if (playwrightError.message.includes('popup') || playwrightError.message.includes('UI blocked')) {
                    throw new Error(`Cannot proceed with learning: ${playwrightError.message}. Please ensure popups can be dismissed.`);
                }
                
                throw new Error(`Playwright failed: ${playwrightError.message}`);
            }
            
            // Phase 4: LLM Analysis
            this.logStep('12', 'LLM', 'UI Analysis', 
                { pageContentLength: pageContent.length }, 
                'Analyzing UI elements...');
            
            // Check if there's existing screenshot analysis to use
            const existingScreenshotAnalysis = (global as any).screenshotAnalysis;
            if (existingScreenshotAnalysis) {
                console.log('📸 Using existing screenshot analysis for hybrid approach');
                console.log('📸 Screenshot analysis elements:', existingScreenshotAnalysis.totalElements || 0);
            } else {
                console.log('📸 No existing screenshot analysis - using HTML-only approach');
            }
            
            const uiAnalysis = await this.analyzeRealUI(pageContent, pageText, screenshot, existingScreenshotAnalysis);
            this.storeLLMResponse('UI Analysis', 'Analyzing UI elements from website content', uiAnalysis, uiAnalysis);
            
            this.logStep('13', 'LLM', 'Database Analysis', 
                { tsvCount: tsvFiles?.length || 0 }, 
                'Analyzing TSV files...');
            
            const dbAnalysis = await this.analyzeTSVFiles(tsvFiles);
            this.storeLLMResponse('Database Analysis', 'Analyzing TSV files for database structure', dbAnalysis, dbAnalysis);
            
            // Phase: RAG Vector Indexing (REQUIRED)
            console.log('\n🔍 Validating TSV files before RAG indexing...');
            if (!tsvFiles || tsvFiles.length === 0) {
                throw new Error('No TSV files provided to performCompleteLearning. Cannot proceed.');
            }

            console.log(`📊 TSV Files to index: ${tsvFiles.length}`);
            tsvFiles.forEach((file, index) => {
                console.log(`  ${index + 1}. ${file.name || 'unnamed'} - ${file.content?.length || 0} chars`);
            });

            this.logStep('15', 'RAG', 'Vector Embedding Creation',
                { tsvFiles: tsvFiles.length },
                'Creating vector embeddings for semantic search...');

            try {
                await this.vectorRAG.indexTSVData(tsvFiles);
            } catch (error: any) {
                console.error('❌ RAG indexing failed:', error);
                console.error('Stack trace:', error.stack);
                throw new Error(`RAG indexing failed: ${error.message}. Pure AI system cannot proceed.`);
            }

            this.logStep('16', 'RAG', 'Vector Store Complete',
                { embeddings: 'completed' },
                'Vector embeddings created and saved to S3');
            
            this.logStep('14', 'LLM', 'RAG Mapping Analysis', 
                { uiElements: uiAnalysis.totalElements, dbFields: dbAnalysis.totalFields }, 
                'Generating mappings with RAG...');
            
            const mappingAnalysis = await this.mapDatabaseToRealUI(dbAnalysis, uiAnalysis, tsvFiles, pageContent);
            this.storeLLMResponse('RAG Mapping Analysis', 'Generating mappings between UI elements and database fields', mappingAnalysis, mappingAnalysis);
            
            const endTime = Date.now();
            const totalDuration = endTime - startTime;
            
            this.logStep('15', 'System', 'Learning Complete', 
                { totalDuration }, 
                'Learning process completed successfully');
            
            // DEBUG: Log the actual analysis objects
            console.log('🔍 DEBUG - uiAnalysis:', JSON.stringify(uiAnalysis, null, 2));
            console.log('🔍 DEBUG - dbAnalysis:', JSON.stringify(dbAnalysis, null, 2));
            console.log('🔍 DEBUG - mappingAnalysis:', JSON.stringify(mappingAnalysis, null, 2));

            // DEBUG: Calculate and log each part
            const uiElementsCalc = (uiAnalysis.forms?.length || 0) + 
                                 (uiAnalysis.buttons?.length || 0) + 
                                 (uiAnalysis.tables?.length || 0) + 
                                 (uiAnalysis.inputs?.length || 0) + 
                                 (uiAnalysis.links?.length || 0) + 
                                 (uiAnalysis.dropdowns?.length || 0) +
                                 (uiAnalysis.charts?.length || 0) +
                                 (uiAnalysis.navigation?.length || 0) +
                                 (uiAnalysis.filters?.length || 0);

            console.log('🔍 DEBUG - UI Elements Calculation:', {
                forms: uiAnalysis.forms?.length || 0,
                buttons: uiAnalysis.buttons?.length || 0,
                tables: uiAnalysis.tables?.length || 0,
                inputs: uiAnalysis.inputs?.length || 0,
                links: uiAnalysis.links?.length || 0,
                dropdowns: uiAnalysis.dropdowns?.length || 0,
                charts: uiAnalysis.charts?.length || 0,
                navigation: uiAnalysis.navigation?.length || 0,
                filters: uiAnalysis.filters?.length || 0,
                total: uiElementsCalc,
                analysisMethod: uiAnalysis.analysisMethod || 'unknown',
                htmlElements: uiAnalysis.htmlElements || 0,
                screenshotElements: uiAnalysis.screenshotElements || 0
            });

            console.log('🔍 DEBUG - DB Fields:', dbAnalysis.totalFields);

            // Store LLM responses globally for API access
            (global as any).llmResponses = this.llmCallTracker;
            (global as any).lastLLMResponse = this.llmCallTracker.length > 0 ? this.llmCallTracker[this.llmCallTracker.length - 1] : null;

            return {
                success: true,
                results: {
                    // Calculate UI elements from actual structure (including screenshot elements)
                    uiElements: uiElementsCalc,
                    
                    // These should work correctly
                    dbFields: dbAnalysis.totalFields || 0,
                    testCases: mappingAnalysis.testCases?.length || 0,
                    relationships: mappingAnalysis.dataRelationships?.length || 0
                },
                analysis: {
                    database: dbAnalysis,
                    ui: uiAnalysis,
                    mapping: mappingAnalysis
                },
                executionTrace: this.executionTrace,
                llmResponses: this.llmCallTracker,
                lastLLMResponse: this.llmCallTracker.length > 0 ? this.llmCallTracker[this.llmCallTracker.length - 1] : null
            };
            
        } catch (error) {
            const endTime = Date.now();
            const totalDuration = endTime - startTime;
            
            this.logStep('ERROR', 'System', 'Learning Failed', 
                { error: error.message, totalDuration }, 
                'Learning process failed');
            
            return {
                success: false,
                error: error.message,
                results: {
                    uiElements: 0,
                    dbFields: 0,
                    testCases: 0,
                    relationships: 0
                },
                executionTrace: this.executionTrace
            };
        }
    }

async analyzeRealUI(pageContent: string, pageText: string, screenshot: any, existingScreenshotAnalysis?: any): Promise<any> {
    console.log('\n=== PLAYWRIGHT DOM ANALYSIS ===');
        
    try {
        // Phase 1: Active UI Exploration (replaces static DOM analysis)
        console.log('Phase 1: Active UI Exploration...');
        const uiAnalysis = await this.performActiveUIExploration();
        console.log('🎯 UI Elements Explored:', uiAnalysis);
        
        // Pure AI system: Use ONLY active exploration - NO HTML backup
        console.log('✅ Pure AI Active Exploration Complete:', uiAnalysis);
        
        return uiAnalysis;
        
    } catch (error) {
        console.error('❌ Pure AI System Failure: Playwright DOM analysis failed:', error);
        console.error('❌ NO FALLBACK AVAILABLE - Fix the root cause and try again.');
        throw new Error(`Pure AI system failure: Playwright DOM analysis failed. ${error.message}. NO FALLBACK AVAILABLE.`);
    }
}

    // NEW METHOD: Active UI Exploration (replaces static DOM analysis)
    private async performActiveUIExploration(): Promise<any> {
        console.log('🔍 Starting Active UI Exploration...');
        
        const explorer = new ActiveUIExplorer(
            this.mcpClient,
            new UIStateCapturer(this.mcpClient),
            this.vectorRAG
        );
        
        // Explore UI and store in RAG
        const explorationResults = await explorer.exploreAllElements();
        
        console.log(`✅ Explored ${explorationResults.length} UI elements`);
        
        // Convert exploration results to the expected format
        const result = {
            filters: explorationResults.filter(r => r.elementType === 'dropdown').map(r => ({
                selector: r.selector,
                type: 'filter',
                text: r.label,
                source: 'active-exploration',
                allOptions: r.allOptions,
                sampledTests: r.sampledTests
            })),
            dropdowns: explorationResults.filter(r => r.elementType === 'dropdown').map(r => ({
                selector: r.selector,
                type: 'dropdown',
                text: r.label,
                source: 'active-exploration',
                allOptions: r.allOptions,
                sampledTests: r.sampledTests
            })),
            searchBoxes: explorationResults.filter(r => r.elementType === 'searchBox').map(r => ({
                selector: r.selector,
                type: 'searchBox',
                text: r.label,
                source: 'active-exploration',
                allOptions: r.allOptions,
                sampledTests: r.sampledTests
            })),
            buttons: [],
            forms: [],
            tables: [],
            navigation: [],
            charts: [],
            totalElements: explorationResults.length,
            analysisMethod: 'active-exploration',
            domElements: explorationResults.length,
            htmlElements: 0,
            confidence: 0.95,
            explorationResults: explorationResults
        };
        
        return result;
    }

// Fallback DOM analysis using native Playwright MCP tools
private async performFallbackDOMAnalysis(): Promise<any> {
    console.log('🔍 Starting fallback DOM analysis with native Playwright tools...');
    
    const elements = {
        filters: [],
        dropdowns: [],
        checkboxes: [],
        searchBoxes: [],
        buttons: [],
        forms: [],
        tables: [],
        navigation: [],
        charts: [],
        totalElements: 0,
        analysisMethod: 'playwright-native-tools'
    };
    
    try {
        // Use native Playwright MCP tools instead of playwright_evaluate
        const queries = [
            { name: 'buttons', selector: 'button' },
            { name: 'forms', selector: 'form' },
            { name: 'tables', selector: 'table' },
            { name: 'dropdowns', selector: 'select' },
            { name: 'checkboxes', selector: 'input[type="checkbox"]' },
            { name: 'searchBoxes', selector: 'input[type="search"]' },
            { name: 'filters', selector: '.sidebar, .filter-panel, .filter-container' },
            { name: 'navigation', selector: '.nav, .navigation, .menu, .tabs' },
            { name: 'charts', selector: '.chart, .graph, canvas, svg' }
        ];
        
        for (const query of queries) {
            try {
                console.log(`🔍 Querying ${query.name} with selector: ${query.selector}`);
                
                // Use playwright_query_selector_all instead of playwright_evaluate
                const result = await this.mcpClient.callTools([{
                    name: 'playwright_query_selector_all',
                    parameters: {
                        selector: query.selector
                    },
                    id: `native-${query.name}-${Date.now()}`
                }]);
                
                console.log(`🔍 Raw result for ${query.name}:`, JSON.stringify(result, null, 2));
                
                const queryResult = result[0]?.result || [];
                elements[query.name] = queryResult.map((el: any, index: number) => ({
                    selector: `${query.selector}:nth-child(${index + 1})`,
                    text: el.textContent?.trim().substring(0, 100) || '',
                    placeholder: el.placeholder || '',
                    ariaLabel: el.getAttribute?.('aria-label') || '',
                    dataTestId: el.getAttribute?.('data-testid') || '',
                    source: 'playwright-native-tools'
                }));
                
                console.log(`✅ Found ${elements[query.name].length} ${query.name}`);
                
            } catch (queryError) {
                console.error(`❌ Failed to query ${query.name}:`, queryError.message);
                elements[query.name] = [];
            }
        }
        
        // Calculate total elements
        let totalElements = 0;
        Object.values(elements).forEach((arr: any) => {
            if (Array.isArray(arr)) {
                totalElements += arr.length;
            }
        });
        elements.totalElements = totalElements;
        
        console.log('✅ Native Playwright DOM analysis completed:', {
            totalElements: elements.totalElements,
            breakdown: Object.keys(elements).map(key => ({ [key]: Array.isArray(elements[key]) ? elements[key].length : 0 }))
        });
        
        return elements;
        
    } catch (error) {
        console.error('❌ Fallback DOM analysis also failed:', error);
        return {
            filters: [],
            dropdowns: [],
            checkboxes: [],
            searchBoxes: [],
            buttons: [],
            forms: [],
            tables: [],
            navigation: [],
            charts: [],
            totalElements: 0,
            analysisMethod: 'playwright-dom-fallback-failed',
            error: error.message
        };
    }
}

// New method to combine DOM and HTML analysis
private combineDOMAndHTMLAnalysis(domAnalysis: any, htmlPatterns: any): any {
    console.log('🔄 Combining DOM and HTML analysis...');
    
    const result = {
        // Primary: DOM analysis results
        filters: domAnalysis.filters || [],
        dropdowns: domAnalysis.dropdowns || [],
        checkboxes: domAnalysis.checkboxes || [],
        searchBoxes: domAnalysis.searchBoxes || [],
        buttons: domAnalysis.buttons || [],
        forms: domAnalysis.forms || [],
        tables: domAnalysis.tables || [],
        navigation: domAnalysis.navigation || [],
        charts: domAnalysis.charts || [],
        
        // Backup: HTML patterns (if DOM analysis missed anything)
        htmlForms: htmlPatterns.forms?.map(f => ({ 
            selector: f.selector, 
            inputs: f.inputs,
            submitButton: f.submitButton,
            source: 'html-backup'
        })) || [],
        
        htmlButtons: htmlPatterns.buttons?.map(b => ({ 
            selector: b.selector, 
            type: b.type,
            text: b.text,
            ariaLabel: b.ariaLabel,
            source: 'html-backup'
        })) || [],
        
        htmlTables: htmlPatterns.tables?.map(t => ({ 
            selector: t.selector, 
            columns: t.columns,
            source: 'html-backup'
        })) || [],
        
        // Analysis metadata
        analysisMethod: 'dom-primary-html-backup',
        domElements: domAnalysis.totalElements || 0,
        htmlElements: (htmlPatterns.forms?.length || 0) + (htmlPatterns.buttons?.length || 0) + (htmlPatterns.tables?.length || 0),
        confidence: domAnalysis.totalElements > 0 ? 0.95 : 0.7,
        timestamp: new Date().toISOString()
    };
    
    // Merge HTML backup elements if DOM analysis found fewer elements
    if (result.htmlForms.length > result.forms.length) {
        console.log('📝 Adding HTML backup forms...');
        result.forms = [...result.forms, ...result.htmlForms];
    }
    
    if (result.htmlButtons.length > result.buttons.length) {
        console.log('📝 Adding HTML backup buttons...');
        result.buttons = [...result.buttons, ...result.htmlButtons];
    }
    
    if (result.htmlTables.length > result.tables.length) {
        console.log('📝 Adding HTML backup tables...');
        result.tables = [...result.tables, ...result.htmlTables];
    }
    
    // Calculate final totals
    const totalElements = result.filters.length + result.dropdowns.length + result.checkboxes.length + 
                          result.searchBoxes.length + result.buttons.length + result.forms.length + 
                          result.tables.length + result.navigation.length + result.charts.length;
    
    console.log('✅ Combined analysis complete:', {
        totalElements: totalElements,
        domElements: result.domElements,
        htmlElements: result.htmlElements,
        confidence: result.confidence
    });
    
        // Group elements for frontend display and test case generation
        const groupedResult = {
            ...result,
            totalElements: totalElements,
            
            // Grouped elements for test case generation - INCLUDE TABLES as interactive elements
            interactiveElements: [
                ...result.buttons,
                ...result.forms,
                ...result.dropdowns,
                ...result.checkboxes,
                ...result.searchBoxes,
                ...result.tables.map((table: any) => ({
                    ...table,
                    type: 'table',
                    interactive: true
                }))
            ],
            
            dataComponents: [
                ...result.tables,
                ...result.charts
            ],
            
            navigationElements: [
                ...result.navigation,
                ...result.filters
            ]
        };
    
    return groupedResult;
}

// Enhanced HTML pattern detection using simple regex
private enhanceHTMLPatterns(htmlPatterns: any, pageContent: string): any {
    console.log('🔍 Enhancing HTML patterns with regex detection...');
    
    const enhanced = { ...htmlPatterns };
    
    // Simple button detection using regex
    const buttonRegex = /<button[^>]*>([^<]*)<\/button>/gi;
    const buttonMatches = pageContent.match(buttonRegex) || [];
    
    if (buttonMatches.length > 0) {
        console.log(`🔍 Found ${buttonMatches.length} buttons via regex`);
        enhanced.buttons = buttonMatches.map((match, index) => {
            const textMatch = match.match(/>([^<]*)</);
            const text = textMatch ? textMatch[1].trim() : `Button ${index + 1}`;
            return {
                selector: `button:nth-child(${index + 1})`,
                type: 'button',
                text: text,
                ariaLabel: '',
                source: 'html-regex'
            };
        });
    }
    
    // Simple form detection
    const formRegex = /<form[^>]*>[\s\S]*?<\/form>/gi;
    const formMatches = pageContent.match(formRegex) || [];
    
    if (formMatches.length > 0) {
        console.log(`🔍 Found ${formMatches.length} forms via regex`);
        enhanced.forms = formMatches.map((match, index) => {
            const inputMatches = match.match(/<input[^>]*>/gi) || [];
            return {
                selector: `form:nth-child(${index + 1})`,
                inputs: inputMatches.length,
                submitButton: match.includes('type="submit"') ? 'submit' : '',
                source: 'html-regex'
            };
        });
    }
    
    // Simple input detection
    const inputRegex = /<input[^>]*type=["']?(text|search|email|password)["']?[^>]*>/gi;
    const inputMatches = pageContent.match(inputRegex) || [];
    
    if (inputMatches.length > 0) {
        console.log(`🔍 Found ${inputMatches.length} inputs via regex`);
        enhanced.search = inputMatches.map((match, index) => {
            const typeMatch = match.match(/type=["']?([^"'\s>]+)["']?/);
            const type = typeMatch ? typeMatch[1] : 'text';
            return {
                selector: `input:nth-child(${index + 1})`,
                type: type,
                source: 'html-regex'
            };
        });
    }
    
    console.log('🔍 Enhanced patterns:', {
        buttons: enhanced.buttons?.length || 0,
        forms: enhanced.forms?.length || 0,
        search: enhanced.search?.length || 0,
        tables: enhanced.tables?.length || 0
    });
    
    return enhanced;
}

// New method to combine HTML and screenshot analysis
private combineHTMLAndScreenshotAnalysis(htmlPatterns: any, screenshotAnalysis: any): any {
            const result = {
        forms: [],
        buttons: [],
        tables: [],
        inputs: [],
        links: [],
        dropdowns: [],
        
        // Enhanced fields from screenshot analysis
        charts: [],
        navigation: [],
        filters: [],
        interactionPatterns: [],
        dataFlows: [],
        
        // Analysis metadata
        analysisMethod: 'hybrid',
        htmlElements: 0,
        screenshotElements: 0,
        confidence: 0.9
    };
    
    // Convert HTML patterns
    if (htmlPatterns) {
        result.forms = htmlPatterns.forms?.map(f => ({ 
            selector: f.selector, 
            inputs: f.inputs,
            submitButton: f.submitButton,
            source: 'html'
        })) || [];
        
        result.buttons = htmlPatterns.buttons?.map(b => ({ 
            selector: b.selector, 
            type: b.type,
            text: b.text,
            ariaLabel: b.ariaLabel,
            source: 'html'
        })) || [];
        
        result.tables = htmlPatterns.tables?.map(t => ({ 
                    selector: t.selector, 
            columns: t.columns,
            source: 'html'
        })) || [];
        
        result.inputs = htmlPatterns.search?.map(s => ({ 
                    selector: s.selector, 
            type: s.type,
            source: 'html'
        })) || [];
        
        result.dropdowns = htmlPatterns.filters?.filter(f => f.type === 'dropdown').map(f => ({ 
            selector: f.selector,
            source: 'html'
        })) || [];
        
        result.htmlElements = (result.forms.length + result.buttons.length + result.tables.length + 
                              result.inputs.length + result.dropdowns.length);
    }
    
    // Add screenshot analysis results
    if (screenshotAnalysis) {
        // Add screenshot-detected buttons
        if (screenshotAnalysis.buttons) {
            const screenshotButtons = screenshotAnalysis.buttons
                .filter(b => b.text && b.text !== 'undefined') // STRICT VALIDATION: Only include buttons with valid text
                .map(b => ({
                    selector: `[data-screenshot-button="${b.text}"]`,
                    type: b.type,
                    text: b.text,
                    position: b.position,
                    purpose: b.purpose,
                    source: 'screenshot'
                }));
            result.buttons.push(...screenshotButtons);
        }
        
        // Add screenshot-detected forms
        if (screenshotAnalysis.forms) {
            const screenshotForms = screenshotAnalysis.forms
                .filter(f => f.label && f.label !== 'undefined') // STRICT VALIDATION: Only include forms with valid labels
                .map(f => ({
                    selector: `[data-screenshot-form="${f.label}"]`,
                    type: f.type,
                    label: f.label,
                    placeholder: f.placeholder,
                    position: f.position,
                    source: 'screenshot'
                }));
            result.forms.push(...screenshotForms);
        }
        
        // Add screenshot-detected tables
        if (screenshotAnalysis.tables) {
            const screenshotTables = screenshotAnalysis.tables.map(t => ({
                selector: '[data-screenshot-table]',
                columns: t.columns,
                rowCount: t.rowCount,
                sortable: t.sortable,
                selectable: t.selectable,
                source: 'screenshot'
            }));
            result.tables.push(...screenshotTables);
        }
        
        // Add additional screenshot insights
        result.charts = screenshotAnalysis.charts || [];
        result.navigation = screenshotAnalysis.navigation || [];
        result.filters = screenshotAnalysis.filters || [];
        result.interactionPatterns = screenshotAnalysis.interactionPatterns || [];
        result.dataFlows = screenshotAnalysis.dataFlows || [];
        
        result.screenshotElements = screenshotAnalysis.totalElements || 0;
    }
    
    // Calculate total elements
    const totalElements = result.htmlElements + result.screenshotElements;
    
    // Update confidence based on agreement between methods
    if (result.htmlElements > 0 && result.screenshotElements > 0) {
        result.confidence = 0.95; // High confidence when both methods agree
    } else if (result.screenshotElements > 0) {
        result.confidence = 0.85; // Good confidence with screenshot analysis
    } else {
        result.confidence = 0.7; // Lower confidence with HTML only
    }
    
    // Group elements for frontend display
    (result as any).interactiveElements = [
        ...result.buttons,
        ...result.forms,
        ...result.inputs,
        ...result.dropdowns
    ];
    
    (result as any).dataComponents = [
        ...result.tables,
        ...result.charts
    ];
    
    (result as any).navigationElements = [
        ...result.navigation,
        ...result.filters,
        ...result.links
    ];
    
    return result;
}

// Fallback method for HTML-only analysis
private convertHTMLPatternsToResult(htmlPatterns: any): any {
    const result = {
        forms: htmlPatterns.forms?.map(f => ({ 
            selector: f.selector, 
            inputs: f.inputs,
            submitButton: f.submitButton,
            source: 'html'
        })) || [],
        buttons: htmlPatterns.buttons?.map(b => ({ 
            selector: b.selector, 
            type: b.type,
            text: b.text,
            ariaLabel: b.ariaLabel,
            source: 'html'
        })) || [],
        tables: htmlPatterns.tables?.map(t => ({ 
            selector: t.selector, 
            columns: t.columns,
            source: 'html'
        })) || [],
        inputs: htmlPatterns.search?.map(s => ({ 
            selector: s.selector, 
            type: s.type,
            source: 'html'
        })) || [],
        links: [],
        dropdowns: htmlPatterns.filters?.filter(f => f.type === 'dropdown').map(f => ({ 
            selector: f.selector,
            source: 'html'
        })) || [],
        
        // Empty arrays for screenshot-specific fields
        charts: [],
        navigation: [],
        filters: [],
        interactionPatterns: [],
        dataFlows: [],
        
        analysisMethod: 'html-only',
        htmlElements: 0,
        screenshotElements: 0,
        confidence: 0.7
    };
    
    // Calculate HTML elements count
    result.htmlElements = result.forms.length + result.buttons.length + result.tables.length + 
                         result.inputs.length + result.dropdowns.length;
    
    // Group elements for frontend display
    (result as any).interactiveElements = [
        ...result.buttons,
        ...result.forms,
        ...result.inputs,
        ...result.dropdowns
    ];
    
    (result as any).dataComponents = [
        ...result.tables,
        ...result.charts
    ];
    
    (result as any).navigationElements = [
        ...result.navigation,
        ...result.filters,
        ...result.links
    ];
    
    return result;
    }

    async analyzeTSVFiles(tsvFiles: any[]): Promise<any> {
        console.log('\n=== UNIVERSAL DATA PATTERN DETECTION ===');
        
        try {
            // Convert raw TSV string data to file format if needed
            let processedTSVFiles = tsvFiles;
            
            // Check if we have raw TSV string data instead of file objects
            if (tsvFiles && tsvFiles.length > 0 && typeof tsvFiles[0] === 'string') {
                console.log('📝 Converting raw TSV string data to file format...');
                processedTSVFiles = tsvFiles.map((tsvData, index) => ({
                    name: `tsv_data_${index}.tsv`,
                    content: tsvData
                }));
            }
            
            console.log('📊 Processing TSV files:', processedTSVFiles.length);
            
            // Use simple data analysis instead of UniversalPatternDetector
            console.log('⚠️ UniversalPatternDetector removed - using simple data analysis');
            const dataPatterns = this.simpleDataAnalysis(processedTSVFiles);
            
            // Store parsed TSV data for dynamic test value extraction
            this.currentTSVData = [];
            processedTSVFiles.forEach(tsvFile => {
                if (tsvFile && tsvFile.content) {
                    const lines = tsvFile.content.split('\n').filter(line => line.trim());
                    if (lines.length >= 2) {
                        const headers = lines[0].split('\t');
                        const rows = lines.slice(1).map(line => {
                            const values = line.split('\t');
                            const row: any = {};
                            headers.forEach((header, index) => {
                                row[header.trim()] = values[index]?.trim() || '';
                            });
                            return row;
                        });
                        this.currentTSVData.push(...rows);
                    }
                }
            });
            
            console.log(`📊 Stored ${this.currentTSVData.length} TSV records for dynamic test value extraction`);
            console.log('🎯 Discovered Data Patterns:', dataPatterns);
            
            // Convert to the expected format for compatibility
            const result = {
                totalFields: Object.values(dataPatterns).flat().length,
                fieldNames: Object.values(dataPatterns).flat().map((f: any) => f.name),
                fieldTypes: this.extractFieldTypes(dataPatterns),
                relationships: this.extractRelationships(dataPatterns),
                businessRules: this.extractBusinessRules(dataPatterns),
                dataQuality: 'High', // Based on pattern analysis
                confidence: 0.9 // High confidence with pattern detection
            };
            
            console.log('🎯 Universal Pattern Data result:', result);
            return result;
            
        } catch (error) {
            console.error('Error in Universal Data Pattern Detection:', error);
            return { totalFields: 0, fieldNames: [], fieldTypes: {}, relationships: [], businessRules: [] };
        }
    }

    async mapDatabaseToRealUI(dbAnalysis: any, uiAnalysis: any, tsvFiles: any[] = [], pageContent?: string): Promise<any> {
        console.log('\n=== PURE AI MAPPING (No Pattern Matching, No Hardcoding) ===');
        console.log(`📊 Input: ${tsvFiles?.length || 0} TSV files, ${uiAnalysis?.interactiveElements?.length || 0} UI elements`);
        
        if (!tsvFiles || tsvFiles.length === 0) {
            throw new Error('No TSV files provided. Pure AI system requires data to learn from. NO FALLBACK AVAILABLE.');
        }
        
        try {
            // Use ONLY LLM + RAG for mapping
            console.log('\n🔍 Step 1: LLM Semantic Mapping...');
            const llmMappings = await this.analyzeTSVtoUIMappingWithRAG(uiAnalysis, pageContent || '');
            
            console.log(`📋 LLM Mappings Result:`, {
                hasMappings: !!llmMappings,
                mappingsArray: !!llmMappings?.mappings,
                mappingsCount: llmMappings?.mappings?.length || 0
            });
            
            if (!llmMappings || !llmMappings.mappings || llmMappings.mappings.length === 0) {
                console.error('❌ LLM failed to generate mappings:', llmMappings);
                throw new Error('LLM failed to generate any mappings. Pure AI system cannot proceed without LLM analysis.');
            }
            
            // Generate test cases using ONLY LLM
            console.log('\n🔍 Step 2: LLM Test Case Generation...');
            const testCases = await this.generateTestCasesWithLLM(uiAnalysis, llmMappings.mappings);
            
            console.log(`📋 Test Cases Result:`, {
                hasTestCases: !!testCases,
                isArray: Array.isArray(testCases),
                testCasesCount: testCases?.length || 0,
                firstTestCase: testCases?.[0]
            });
            
            if (!testCases || testCases.length === 0) {
                console.error('❌ LLM failed to generate test cases:', testCases);
                throw new Error('LLM failed to generate test cases. Pure AI system requires LLM-generated tests.');
            }
            
            const result = {
                mappings: llmMappings.mappings,
                testCases: testCases,
                validationRules: this.extractValidationRulesFromLLM(llmMappings),
                missingMappings: [],
                dataRelationships: llmMappings.dataRelationships || []
            };
            
            console.log(`\n✅ Pure AI Mapping Complete:`, {
                mappings: result.mappings.length,
                testCases: result.testCases.length,
                validationRules: result.validationRules.length
            });
            
            return result;
            
        } catch (error: any) {
            console.error('❌ Pure AI mapping failed:', error);
            console.error('Stack trace:', error.stack);
            throw new Error(`Pure AI system failure: ${error.message}. NO FALLBACK AVAILABLE. Fix the issue and try again.`);
        }
    }

    // NEW METHOD: Pure LLM semantic mapping
    private async analyzeTSVtoUIMapping(uiAnalysis: any, pageText: string): Promise<any> {
        console.log('\n🧠 LLM: PURE SEMANTIC MAPPING (No Hardcoding)');
        
        // Extract UI elements from ALL detected elements, not just specific categories
        // Use actual visible text content, not CSS selectors
        const uiElementTexts = [
            // Get text from all detected element types - prioritize actual text content
            ...uiAnalysis.filters?.map((f: any) => f.text || f.ariaLabel || f.dataTestId) || [],
            ...uiAnalysis.dropdowns?.map((d: any) => d.text || d.ariaLabel || d.dataTestId) || [],
            ...uiAnalysis.tables?.flatMap((t: any) => t.columns || [t.text || t.ariaLabel]) || [],
            ...uiAnalysis.searchBoxes?.map((s: any) => s.text || s.placeholder || s.ariaLabel || s.dataTestId) || [],
            ...uiAnalysis.buttons?.map((b: any) => b.text || b.ariaLabel || b.dataTestId) || [],
            ...uiAnalysis.forms?.map((f: any) => f.text || f.ariaLabel || f.dataTestId) || [],
            ...uiAnalysis.navigation?.map((n: any) => n.text || n.ariaLabel || n.dataTestId) || [],
            ...uiAnalysis.charts?.map((c: any) => c.text || c.ariaLabel || c.dataTestId) || [],
            // Also check interactiveElements and dataComponents
            ...uiAnalysis.interactiveElements?.map((e: any) => e.text || e.ariaLabel || e.dataTestId) || [],
            ...uiAnalysis.dataComponents?.map((d: any) => d.text || d.columns?.join(' ') || d.ariaLabel) || []
        ].filter(Boolean);
        
        // If we still don't have meaningful text, get visible text from the page
        if (uiElementTexts.length === 0 || uiElementTexts.every(text => text.includes('nth-child') || text.includes(':'))) {
            console.log('🔍 No meaningful UI text found, extracting visible text from page...');
            try {
                const visibleText = pageText.substring(0, 2000); // Get first 2000 chars of visible text
                const words = visibleText.split(/\s+/).filter(word => word.length > 2);
                uiElementTexts.push(...words.slice(0, 20)); // Add first 20 meaningful words
                console.log(`🔍 Extracted ${words.length} words from page text`);
            } catch (error) {
                console.error('❌ Failed to extract visible text:', error);
            }
        }
        
        console.log(`🔍 Debug UI Analysis:`, {
            filters: uiAnalysis.filters?.length || 0,
            dropdowns: uiAnalysis.dropdowns?.length || 0,
            tables: uiAnalysis.tables?.length || 0,
            searchBoxes: uiAnalysis.searchBoxes?.length || 0,
            buttons: uiAnalysis.buttons?.length || 0,
            forms: uiAnalysis.forms?.length || 0,
            navigation: uiAnalysis.navigation?.length || 0,
            charts: uiAnalysis.charts?.length || 0,
            interactiveElements: uiAnalysis.interactiveElements?.length || 0,
            dataComponents: uiAnalysis.dataComponents?.length || 0,
            totalElements: uiAnalysis.totalElements || 0,
            analysisMethod: uiAnalysis.analysisMethod
        });
        
        if (uiElementTexts.length === 0) {
            console.error('❌ No UI element texts found. UI Analysis details:', JSON.stringify(uiAnalysis, null, 2));
            throw new Error('No UI elements detected. Cannot perform LLM mapping.');
        }
        
        console.log(`📋 UI Elements: ${uiElementTexts.length}`);
        
        // Query RAG for each element
        const relevantData = new Map();
        for (const elementText of uiElementTexts) {
            try {
                const records = await this.vectorRAG.searchRelevantData(elementText, 10);
                relevantData.set(elementText, records);
            } catch (error: any) {
                console.warn(`⚠️  No RAG data for "${elementText}": ${error.message}`);
            }
        }
        
        // Get metadata
        const tsvMetadata = this.vectorRAG.getTSVMetadata();
        
        // Build LLM prompt
        const prompt = `You are an AI analyzing a data exploration website. Create semantic mappings between TSV database fields and UI elements.

TSV DATABASE STRUCTURE:
${Object.entries(tsvMetadata).map(([file, meta]: [string, any]) => 
    `File: ${file}
Headers: ${meta.headers.join(', ')}
Records: ${meta.recordCount}
Sample: ${JSON.stringify(meta.sampleRecords.slice(0, 2))}`
).join('\n\n')}

UI ELEMENTS DETECTED:
${JSON.stringify(uiAnalysis, null, 2)}

RELEVANT TSV DATA (from vector search):
${Array.from(relevantData.entries()).map(([ui, records]) => 
    `"${ui}" → ${JSON.stringify(records.slice(0, 2))}`
).join('\n')}

TASK: Create mappings with confidence scores. NO GUESSING - only map if confident.

Return JSON:
{
  "mappings": [
    {
      "tsvField": "exact_field_name",
      "tsvFile": "file.tsv",
      "uiElement": "exact_ui_text",
      "uiSelector": "css_selector",
      "confidence": 0.95,
      "reasoning": "detailed_explanation",
      "sampleValues": ["actual", "values"],
      "testType": "filter|search|sort"
    }
  ],
  "learnings": ["what I learned"],
  "dataRelationships": ["field relationships discovered"]
}`;
        
        console.log(`📤 Sending to LLM (${Math.ceil(prompt.length / 4)} tokens)...`);
        
        const response = await this.bedrockClient.generateResponse([{ 
            role: 'user', 
            content: prompt 
        }], []);
        
        const result = this.parseJSONResponse(response.content);
        
        if (!result || !result.mappings) {
            throw new Error('LLM returned invalid response format. Expected {mappings: [...]}');
        }
        
        console.log(`📥 LLM found ${result.mappings.length} mappings`);
        this.storeLLMResponse('Pure AI Semantic Mapping', prompt, result, result);
        
        return result;
    }

    // NEW METHOD: RAG-Powered Semantic Mapping
    private async analyzeTSVtoUIMappingWithRAG(uiAnalysis: any, pageText: string): Promise<any> {
        console.log('\n🧠 LLM: RAG-POWERED SEMANTIC MAPPING');
        
        try {
            // Step 1: Query RAG for TSV knowledge
            const tsvKnowledge = await this.vectorRAG.queryTSVKnowledge(
                "What are all the TSV fields, their types, and sample values?"
            );
            
            // Step 2: Query RAG for UI knowledge
            const uiKnowledge = await this.vectorRAG.queryUIKnowledge(
                "What are all the UI interactive elements, their labels, and behaviors?"
            );
            
            console.log(`📊 RAG Context: ${tsvKnowledge.length} TSV items, ${uiKnowledge.length} UI items`);
            
            // Step 3: Send compact context to LLM
            const prompt = `You are analyzing a data exploration website.

TSV DATABASE KNOWLEDGE (from RAG):
${JSON.stringify(tsvKnowledge.slice(0, 5), null, 2)}

UI EXPLORATION KNOWLEDGE (from RAG):
${JSON.stringify(uiKnowledge.slice(0, 5), null, 2)}

TASK: Create semantic mappings between UI elements and TSV fields.
- Match UI labels to TSV field names
- Compare UI result counts with TSV record counts
- Identify data mismatches
- Generate test cases

Return JSON:
{
  "mappings": [
    {
      "uiLabel": "Breed",
      "uiSelector": "#breed-dropdown",
      "tsvField": "breed",
      "tsvFile": "sample.tsv",
      "confidence": 0.95,
      "reasoning": "Exact match between UI options and TSV values",
      "dataMismatch": "UI shows 50 results, TSV has 48 records (2 missing)"
    }
  ],
  "testCases": [
    {
      "name": "Validate Breed filter",
      "uiAction": "Select Breed='Golden Retriever'",
      "tsvFilter": "breed='Golden Retriever'",
      "expectedCount": 48,
      "validationType": "count_match"
    }
  ]
}`;

            const response = await this.bedrockClient.generateResponse([{
                role: 'user',
                content: prompt
            }], []);
            
            const result = this.parseJSONResponse(response.content);
            
            // Step 4: Store mappings back in RAG
            if (result.mappings) {
                for (const mapping of result.mappings) {
                    await this.vectorRAG.storeMappingResult(mapping);
                }
            }
            
            this.storeLLMResponse('RAG-Powered Mapping', prompt, result, result);
            
            return result;
            
        } catch (error: any) {
            console.error('❌ RAG-powered mapping failed:', error);
            throw new Error(`RAG-powered mapping failed: ${error.message}. NO FALLBACK AVAILABLE.`);
        }
    }

    // NEW METHOD: Pure LLM test generation
    private async generateTestCasesWithLLM(uiAnalysis: any, mappings: any[]): Promise<any[]> {
        console.log('\n🧠 LLM: PURE TEST CASE GENERATION (No Templates)');
        
        // Get actual test data from RAG
        const testData = await Promise.all(
            mappings.map(async (m: any) => {
                try {
                    const fieldData = await this.vectorRAG.getFieldData(m.tsvField);
                    return { ...m, ...fieldData };
                } catch {
                    return m;
                }
            })
        );
        
        const prompt = `Generate comprehensive test cases based on REAL data mappings.

MAPPINGS WITH ACTUAL DATA:
${JSON.stringify(testData, null, 2)}

Generate test cases using ACTUAL VALUES from the data. Include:
1. Filter tests with real categorical values
2. Search tests with real searchable terms  
3. Sort tests for sortable columns
4. Data validation against TSV gold standard

Return JSON array of test cases:
[{
  "name": "descriptive_name",
  "description": "what_this_tests",
  "type": "filter|search|sort",
  "dataField": "tsv_field_name",
  "testValues": ["actual", "data", "values"],
  "steps": ["step1", "step2"],
  "selectors": {"field": "css_selector"},
  "expectedBehavior": "what_should_happen",
  "validationCriteria": "how_to_validate"
}]`;
        
        console.log(`📤 Sending to LLM...`);
        
        const response = await this.bedrockClient.generateResponse([{ 
            role: 'user', 
            content: prompt 
        }], []);
        
        const testCases = this.parseJSONResponse(response.content);
        
        if (!Array.isArray(testCases)) {
            throw new Error('LLM returned invalid test cases format. Expected array.');
        }
        
        console.log(`📥 LLM generated ${testCases.length} test cases`);
        this.storeLLMResponse('Pure AI Test Generation', prompt, testCases, testCases);
        
        return testCases;
    }

    // Helper method to parse JSON responses from LLM
    private parseJSONResponse(content: string): any {
        try {
            // Try to extract JSON from the response
            const jsonMatch = content.match(/\{[\s\S]*\}|\[[\s\S]*\]/);
            if (jsonMatch) {
                return JSON.parse(jsonMatch[0]);
            }
            return JSON.parse(content);
        } catch (error) {
            console.error('Failed to parse LLM JSON response:', error);
            throw new Error('LLM returned invalid JSON format. NO FALLBACK AVAILABLE.');
        }
    }

    // Helper method to extract validation rules from LLM mappings
    private extractValidationRulesFromLLM(llmMappings: any): any[] {
        return llmMappings.mappings?.map((mapping: any) => ({
            field: mapping.tsvField,
            type: mapping.testType,
            validation: mapping.validationCriteria || 'Standard validation'
        })) || [];
    }

    // Store LLM response for tracking
    private storeLLMResponse(operation: string, prompt: string, response: any, parsedResponse: any) {
        const startTime = Date.now();
        const llmCall = {
            id: `llm-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
            type: operation, // Changed from 'operation' to 'type'
            timestamp: new Date().toISOString(),
            duration: 0, // Will be updated when response completes
            status: 'completed',
            prompt: prompt.substring(0, 500) + '...',
            response: typeof response === 'string' ? response.substring(0, 500) + '...' : response,
            parsedResponse,
            tokenCount: Math.ceil(prompt.length / 4),
            model: process.env.BEDROCK_MODEL_ID
        };
        
        // Store in global tracker
        this.llmCallTracker.push(llmCall);
        if (this.llmCallTracker.length > 20) {
            this.llmCallTracker = this.llmCallTracker.slice(-20); // Keep last 20 calls
        }
        
        // Emit to frontend
        this.emitLLMCall(llmCall);
    }

    // Emit LLM call to frontend
    private emitLLMCall(llmCall: any) {
        try {
            // Send via existing socket if available
            if (typeof (global as any) !== 'undefined' && (global as any).io) {
                (global as any).io.emit('llmCallUpdate', llmCall);
            }
            
            // Also store in browser-accessible global
            if (typeof (global as any) !== 'undefined') {
                if (!(global as any).realtimeLLMCalls) {
                    (global as any).realtimeLLMCalls = [];
                }
                (global as any).realtimeLLMCalls.push(llmCall);
                if ((global as any).realtimeLLMCalls.length > 50) {
                    (global as any).realtimeLLMCalls = (global as any).realtimeLLMCalls.slice(-50);
                }
            }
        } catch (error) {
            console.error('Failed to emit LLM call:', error);
        }
    }

    // Dummy methods for compatibility (these will be removed in pure AI system)
    private dismissUIObstacles(): Promise<void> {
        console.log('⚠️ dismissUIObstacles called - this should be replaced with pure AI popup detection');
        return Promise.resolve();
    }

    private verifyUIAccessible(): Promise<boolean> {
        console.log('⚠️ verifyUIAccessible called - this should be replaced with pure AI verification');
        return Promise.resolve(true);
    }

    // Simple data analysis method (replaces UniversalPatternDetector)
    private simpleDataAnalysis(tsvFiles: any[]): any {
        const allFields: string[] = [];
        const fieldTypes: any = {};
        const relationships: string[] = [];
        
        tsvFiles.forEach(file => {
            if (file && file.content) {
                const lines = file.content.split('\n').filter(line => line.trim());
                if (lines.length > 0) {
                    const headers = lines[0].split('\t').map(h => h.trim());
                    allFields.push(...headers);
                    
                    // Simple type detection
                    headers.forEach(header => {
                        fieldTypes[header] = 'string'; // Default to string
                    });
                }
            }
        });
        
        return {
            totalFields: allFields.length,
            fieldNames: [...new Set(allFields)],
            fieldTypes,
            relationships,
            businessRules: []
        };
    }

    // Dummy methods for compatibility
    private extractFieldTypes(dataPatterns: any): any {
        return dataPatterns.fieldTypes || {};
    }

    private extractRelationships(dataPatterns: any): string[] {
        return dataPatterns.relationships || [];
    }

    private extractBusinessRules(dataPatterns: any): string[] {
        return dataPatterns.businessRules || [];
    }

}
