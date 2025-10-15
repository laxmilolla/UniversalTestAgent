const { BedrockClient } = require('./src/chatbot/bedrock-client');
const { MCPPlaywrightClient } = require('./src/chatbot/mcp-client');
const { PlaywrightLearningOrchestrator } = require('./src/utils/playwright-learning-orchestrator');

async function testLearningAnalysis() {
    console.log('🧪 Testing Learning Analysis Components...\n');
    
    // Initialize clients
    const bedrockClient = new BedrockClient();
    const mcpClient = new MCPPlaywrightClient();
    const orchestrator = new PlaywrightLearningOrchestrator(bedrockClient, mcpClient);
    
    // Test data
    const websiteUrl = 'https://caninecommons.cancer.gov/#/explore';
    const tsvFiles = [
        {
            name: 'OSA04_case.tsv',
            content: 'type\tcase_id\tpatient_id\ncase\tOSA04-A\tA\ncase\tOSA04-B\tB'
        },
        {
            name: 'OSA04_demographic.tsv', 
            content: 'type\tcase_id\tbreed\tage\ndemographic\tOSA04-A\tGolden Retriever\t10'
        }
    ];
    
    console.log('1️⃣ Testing UI Analysis...');
    try {
        const uiResult = await orchestrator.analyzeRealUI(
            '<html><body><form><input type="text" name="search"><button>Search</button></form><table><tr><th>ID</th><th>Name</th></tr></table></body></html>',
            'Search form with text input and button. Data table with ID and Name columns.',
            null
        );
        console.log('✅ UI Analysis Result:', JSON.stringify(uiResult, null, 2));
        console.log('UI Elements Count:', 
            (uiResult.forms || []).length + 
            (uiResult.buttons || []).length + 
            (uiResult.tables || []).length + 
            (uiResult.inputs || []).length + 
            (uiResult.links || []).length + 
            (uiResult.dropdowns || []).length
        );
    } catch (error) {
        console.error('❌ UI Analysis Failed:', error.message);
    }
    
    console.log('\n2️⃣ Testing Database Analysis...');
    try {
        const dbResult = await orchestrator.analyzeTSVFiles(tsvFiles);
        console.log('✅ Database Analysis Result:', JSON.stringify(dbResult, null, 2));
        console.log('DB Fields Count:', dbResult.totalFields || (dbResult.fieldNames || []).length);
    } catch (error) {
        console.error('❌ Database Analysis Failed:', error.message);
    }
    
    console.log('\n3️⃣ Testing Mapping Analysis...');
    try {
        const uiAnalysis = { forms: [], buttons: [], tables: [], inputs: [], links: [], dropdowns: [] };
        const dbAnalysis = { totalFields: 0, fieldNames: [], fieldTypes: {}, relationships: [], businessRules: [] };
        const mappingResult = await orchestrator.mapDatabaseToRealUI(dbAnalysis, uiAnalysis);
        console.log('✅ Mapping Analysis Result:', JSON.stringify(mappingResult, null, 2));
        console.log('Test Cases Count:', mappingResult.testCases?.length || 0);
        console.log('Relationships Count:', mappingResult.dataRelationships?.length || 0);
    } catch (error) {
        console.error('❌ Mapping Analysis Failed:', error.message);
    }
    
    console.log('\n4️⃣ Testing Complete Learning Process...');
    try {
        const completeResult = await orchestrator.performCompleteLearning(websiteUrl, tsvFiles);
        console.log('✅ Complete Learning Result:', JSON.stringify(completeResult, null, 2));
        console.log('Final Counts:');
        console.log('- UI Elements:', completeResult.results?.uiElements || 0);
        console.log('- DB Fields:', completeResult.results?.dbFields || 0);
        console.log('- Test Cases:', completeResult.results?.testCases || 0);
        console.log('- Relationships:', completeResult.results?.relationships || 0);
    } catch (error) {
        console.error('❌ Complete Learning Failed:', error.message);
    }
    
    console.log('\n�� Test Complete!');
}

// Run the test
testLearningAnalysis().catch(console.error);
