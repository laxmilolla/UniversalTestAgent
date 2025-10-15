const fs = require('fs');

// Read the file
let content = fs.readFileSync('src/utils/playwright-learning-orchestrator.ts', 'utf8');

// Find the broken section and replace it with the correct method
const correctMethod = `    private parseJSONResponse(response: string): any {
        try {
            // Find the first { and last } to extract JSON from embedded text
            const startIndex = response.indexOf("{");
            const endIndex = response.lastIndexOf("}");
            
            if (startIndex !== -1 && endIndex !== -1 && endIndex > startIndex) {
                const jsonString = response.substring(startIndex, endIndex + 1);
                console.log('Extracted JSON:', jsonString.substring(0, 200) + '...');
                return JSON.parse(jsonString);
            }
            
            throw new Error('No JSON found in response');
        } catch (error) {
            console.error('Failed to parse LLM response:', error);
            console.log('Response content:', response.substring(0, 500));
            return {
                totalElements: 0,
                interactiveElements: [],
                dataComponents: [],
                navigationElements: [],
                formFields: [],
                tableColumns: [],
                interactionPatterns: [],
                dataFlows: []
            };
        }
    }`;

// Replace the corrupted section
content = content.replace(
    /    } to extract JSON from embedded text[\s\S]*?    }/,
    correctMethod
);

// Write back
fs.writeFileSync('src/utils/playwright-learning-orchestrator.ts', content);
console.log('✅ Fixed corrupted parseJSONResponse method');
