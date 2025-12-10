import { S3Client, PutObjectCommand, GetObjectCommand, ListObjectsV2Command } from '@aws-sdk/client-s3';
import { BedrockClient } from '../chatbot/bedrock-client';

export class VectorRAGClient {
    private s3Client: S3Client;
    private bedrockClient: BedrockClient;
    private vectorStore: Map<string, any> = new Map();
    private tsvMetadata: any = {};
    
    constructor(bedrockClient: BedrockClient) {
        // Initialize S3 client
        this.s3Client = new S3Client({
            region: process.env.AWS_REGION,
            credentials: {
                accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
                secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!
            }
        });
        this.bedrockClient = bedrockClient;
        
        // Don't clear vector store - it should persist across requests
        // Only clear if explicitly needed (e.g., new learning session)
        // this.vectorStore.clear();
        // this.tsvMetadata = {};
        
        console.log('✅ VectorRAGClient initialized with S3 and Bedrock');
        console.log(`📊 Vector store size: ${this.vectorStore.size} (preserved from previous session)`);
    }
    
    async indexTSVData(tsvFiles: any[]): Promise<void> {
        if (!tsvFiles || tsvFiles.length === 0) {
            throw new Error('No TSV files provided for indexing. Cannot proceed with pure RAG system.');
        }
        
        console.log('\n' + '='.repeat(80));
        console.log('🔍 RAG: STARTING VECTOR EMBEDDING CREATION (Pure AI Mode)');
        console.log('='.repeat(80));
        
        console.log('🔍 DEBUG: indexTSVData called with', tsvFiles.length, 'files');
        console.log('🔍 DEBUG: First file name:', tsvFiles[0]?.name);
        console.log('🔍 DEBUG: First file content length:', tsvFiles[0]?.content?.length);
        
        for (const file of tsvFiles) {
            console.log(`\n📊 Processing File: ${file.name}`);
            const records = this.parseTSV(file.content);
            
            if (records.length === 0) {
                throw new Error(`File ${file.name} has no records. Cannot create embeddings.`);
            }
            
            console.log(`  ├─ Total Records: ${records.length}`);
            
            // Store metadata
            const headers = Object.keys(records[0] || {});
            const uniqueValuesMap: any = {};
            const valueCountsMap: any = {};
            
            headers.forEach(header => {
                const values = [...new Set(records.map(r => r[header]).filter(v => v))];
                uniqueValuesMap[header] = values.slice(0, 100);
                
                // Build value counts map: {value: count}
                const counts: any = {};
                records.forEach(record => {
                    const value = record[header];
                    if (value !== null && value !== undefined && value !== '') {
                        const valueStr = String(value);
                        counts[valueStr] = (counts[valueStr] || 0) + 1;
                    }
                });
                valueCountsMap[header] = counts;
            });
            
            this.tsvMetadata[file.name] = {
                headers: headers,
                recordCount: records.length,
                fieldTypes: this.detectFieldTypes(records),
                uniqueValues: uniqueValuesMap,
                valueCounts: valueCountsMap,
                sampleRecords: records.slice(0, 10)
            };
            
            console.log(`  ├─ Headers: ${this.tsvMetadata[file.name].headers.join(', ')}`);
            
            // Create embeddings (NO SIMULATION - real Bedrock calls)
            const chunks = this.chunkRecords(records, parseInt(process.env.RAG_CHUNK_SIZE || '50'));
            console.log(`\n  🔢 Creating ${chunks.length} embeddings via Bedrock Titan...`);
            
            for (let i = 0; i < chunks.length; i++) {
                const chunkText = this.recordsToText(chunks[i]);
                
                console.log(`  ├─ Chunk ${i + 1}/${chunks.length}: ${chunkText.length} chars`);
                
                // REAL embedding creation - will throw error if fails
                const embedding = await this.createEmbedding(chunkText);
                
                this.vectorStore.set(embedding.id, {
                    fileName: file.name,
                    records: chunks[i],
                    embedding: embedding.vector,
                    text: chunkText,
                    metadata: {
                        type: 'tsv_record',
                        fileName: file.name,
                        chunkIndex: i,
                        totalChunks: chunks.length
                    }
                });
                
                console.log(`  │  ✅ Embedding ID: ${embedding.id}, Dimensions: ${embedding.vector.length}`);
            }
        }
        
        // Save to S3 (REQUIRED - will throw error if fails)
        await this.saveVectorStore();
        
        console.log('\n' + '='.repeat(80));
        console.log('✅ RAG: VECTOR STORE COMPLETE');
        console.log(`  ├─ Total Embeddings: ${this.vectorStore.size}`);
        console.log(`  ├─ TSV Metadata Files: ${this.tsvMetadata.size}`);
        console.log(`  └─ S3 Bucket: ${process.env.S3_BUCKET_NAME}`);
        console.log('='.repeat(80) + '\n');

        // Verify the vector store is not empty
        if (this.vectorStore.size === 0) {
            throw new Error('Vector store is empty after indexing. RAG system cannot proceed with no data.');
        }
    }
    
    async searchRelevantData(query: string, topK?: number): Promise<any[]> {
        if (this.vectorStore.size === 0) {
            throw new Error('Vector store is empty. Run indexTSVData() first. NO FALLBACK AVAILABLE.');
        }
        
        const k = topK || parseInt(process.env.RAG_TOP_K_RESULTS || '10');
        const minSimilarity = parseFloat(process.env.RAG_MIN_SIMILARITY || '0.15');
        
        console.log(`\n🔍 RAG: SEMANTIC SEARCH (Pure AI Mode)`);
        console.log(`  ├─ Query: "${query}"`);
        console.log(`  ├─ Top K: ${k}`);
        console.log(`  └─ Min Similarity: ${minSimilarity}`);
        
        // Create query embedding (REAL - no simulation)
        const queryEmbedding = await this.createEmbedding(query);
        
        // Calculate similarities
        const results = [];
        for (const [id, chunk] of this.vectorStore.entries()) {
            const similarity = this.cosineSimilarity(queryEmbedding.vector, chunk.embedding);
            if (similarity >= minSimilarity) {
                results.push({ ...chunk, similarity, id });
            }
        }
        
        // Graceful degradation: return empty array instead of throwing
        if (results.length === 0) {
            console.log(`  ⚠️  No results found above threshold ${minSimilarity}. Returning empty array.`);
            return [];
        }
        
        results.sort((a, b) => b.similarity - a.similarity);
        const topResults = results.slice(0, k);
        
        console.log(`  ✅ Found ${topResults.length} relevant chunks\n`);
        
        // Return chunks directly (they contain text, metadata, and embedding)
        // For TSV records, the metadata contains the record data
        // Add null checks and filter out invalid results
        return topResults
            .map(r => {
                // Validate chunk structure before accessing properties
                if (!r || typeof r !== 'object') return null;
                
                return {
                    text: r.text || '',
                    metadata: r.metadata || {},
                    similarity: r.similarity || 0,
                    id: r.id || '',
                    // For backward compatibility, include records if they exist in metadata
                    records: r.metadata?.records || (r.metadata?.type === 'tsv_record' ? [r.metadata] : []) || [],
                    fileName: r.metadata?.fileName || r.fileName || ''
                };
            })
            .filter(r => r !== null && (r.text || Object.keys(r.metadata).length > 0 || r.records.length > 0));
    }
    
    private async createEmbedding(text: string): Promise<any> {
        const truncatedText = text.substring(0, 8000); // Titan limit
        
        if (text.length > 8000) {
            console.log(`     ⚠️  Text truncated: ${text.length} → 8000 chars`);
        }
        
        try {
            const response = await this.bedrockClient.invokeModel({
                modelId: process.env.BEDROCK_EMBEDDING_MODEL_ID!,
                contentType: 'application/json',
                accept: 'application/json',
                body: JSON.stringify({ inputText: truncatedText })
            });
            
            if (!response.embedding || !Array.isArray(response.embedding)) {
                throw new Error('Invalid embedding response from Bedrock');
            }
            
            return {
                id: `emb-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
                vector: response.embedding
            };
        } catch (error: any) {
            throw new Error(`Failed to create embedding: ${error.message}. Pure RAG system cannot proceed without embeddings.`);
        }
    }

    private async createAndStoreEmbedding(text: string, metadata: any): Promise<void> {
        const embedding = await this.createEmbedding(text);
        
        this.vectorStore.set(embedding.id, {
            text: text,
            embedding: embedding.vector,
            metadata: metadata
        });
        
        console.log(`✅ Stored embedding: ${embedding.id} (${metadata.type})`);
    }
    
    private async saveVectorStore(): Promise<void> {
        const data = {
            metadata: this.tsvMetadata,
            vectors: Array.from(this.vectorStore.entries()),
            timestamp: new Date().toISOString(),
            stats: {
                totalFiles: Object.keys(this.tsvMetadata).length,
                totalEmbeddings: this.vectorStore.size,
                totalRecords: Object.values(this.tsvMetadata).reduce((sum: number, m: any) => sum + m.recordCount, 0)
            }
        };
        
        const key = `vector-store-${Date.now()}.json`;
        console.log(`\n💾 Saving to S3: ${key}`);
        
        try {
            await this.s3Client.send(new PutObjectCommand({
                Bucket: process.env.S3_BUCKET_NAME!,
                Key: key,
                Body: JSON.stringify(data),
                ContentType: 'application/json'
            }));
            console.log(`  ✅ Saved successfully`);
        } catch (error: any) {
            throw new Error(`Failed to save vector store to S3: ${error.message}. Data not persisted.`);
        }
    }
    
    getTSVMetadata(): any {
        if (Object.keys(this.tsvMetadata).length === 0) {
            throw new Error('No TSV metadata available. Run indexTSVData() first.');
        }
        return this.tsvMetadata;
    }
    
    async getFieldData(fieldName: string): Promise<any> {
        for (const [fileName, metadata] of Object.entries(this.tsvMetadata)) {
            const meta = metadata as any;
            if (meta.headers.includes(fieldName)) {
                return {
                    fileName,
                    fieldName,
                    type: meta.fieldTypes[fieldName],
                    uniqueValues: meta.uniqueValues[fieldName],
                    sampleRecords: meta.sampleRecords
                };
            }
        }
        throw new Error(`Field "${fieldName}" not found in any TSV file. Cannot generate test data.`);
    }

    async getValueCount(fieldName: string, value: string): Promise<number> {
        // Normalize field name: remove table prefix (e.g., "case.case_id" -> "case_id")
        const normalizedFieldName = fieldName.includes('.') ? fieldName.split('.').pop() || fieldName : fieldName;
        const valueStr = String(value).trim();
        
        // Search all TSV files for the field
        for (const [fileName, metadata] of Object.entries(this.tsvMetadata)) {
            const meta = metadata as any;
            
            // Try exact match first
            let matchedField = null;
            if (meta.headers.includes(fieldName) && meta.valueCounts && meta.valueCounts[fieldName]) {
                matchedField = fieldName;
            } else if (meta.headers.includes(normalizedFieldName) && meta.valueCounts && meta.valueCounts[normalizedFieldName]) {
                // Try normalized name (without table prefix)
                matchedField = normalizedFieldName;
            } else {
                // Try case-insensitive and partial matches
                for (const header of meta.headers) {
                    const headerLower = header.toLowerCase();
                    const fieldLower = fieldName.toLowerCase();
                    const normalizedLower = normalizedFieldName.toLowerCase();
                    
                    if (headerLower === fieldLower || 
                        headerLower === normalizedLower ||
                        headerLower.includes(normalizedLower) ||
                        normalizedLower.includes(headerLower)) {
                        if (meta.valueCounts && meta.valueCounts[header]) {
                            matchedField = header;
                            break;
                        }
                    }
                }
            }
            
            if (matchedField && meta.valueCounts[matchedField]) {
                const counts = meta.valueCounts[matchedField];
                
                // Try exact value match first
                if (counts[valueStr] !== undefined) {
                    console.log(`📊 Found count for ${fieldName}='${value}' (matched field: ${matchedField}): ${counts[valueStr]} records in ${fileName}`);
                    return counts[valueStr];
                }
                
                // Try case-insensitive match
                for (const [countValue, count] of Object.entries(counts)) {
                    if (String(countValue).toLowerCase() === valueStr.toLowerCase()) {
                        console.log(`📊 Found count for ${fieldName}='${value}' (matched field: ${matchedField}, value: ${countValue}): ${count} records in ${fileName}`);
                        return count as number;
                    }
                }
            }
        }
        // Log available headers for debugging
        const availableHeaders: string[] = [];
        for (const [fileName, metadata] of Object.entries(this.tsvMetadata)) {
            const meta = metadata as any;
            if (meta.headers) {
                availableHeaders.push(...meta.headers);
            }
        }
        const uniqueHeaders = [...new Set(availableHeaders)];
        console.warn(`⚠️ No count found for ${fieldName}='${value}'. Available TSV headers: ${uniqueHeaders.join(', ')}. Returning 0.`);
        return 0;
    }

    // NEW METHODS FOR UI DATA INDEXING

    async indexUIExplorationData(explorationResults: any[]): Promise<void> {
        console.log(`📱 Indexing ${explorationResults.length} UI exploration results into RAG...`);
        
        for (const result of explorationResults) {
            try {
                // Create embeddings for UI element descriptions
                const elementDescription = `${result.elementType} labeled "${result.label}" with selector "${result.selector}". Available options: ${result.allOptions?.join(', ') || 'none'}.`;
                
                await this.createAndStoreEmbedding(elementDescription, {
                    type: 'ui_element',
                    elementType: result.elementType,
                    label: result.label,
                    selector: result.selector,
                    allOptions: result.allOptions || [],
                    sampledTests: result.sampledTests || []
                });

                // Create embeddings for each observed behavior
                if (result.sampledTests) {
                    for (const test of result.sampledTests) {
                        const behaviorDescription = `When selecting "${test.option}" in ${result.label} dropdown, result count changed from ${test.changes?.resultCount?.before || 'unknown'} to ${test.changes?.resultCount?.after || 'unknown'}.`;
                        
                        await this.createAndStoreEmbedding(behaviorDescription, {
                            type: 'ui_behavior',
                            elementLabel: result.label,
                            selectedOption: test.option,
                            resultCountChange: test.changes?.resultCount,
                            cascadingChanges: test.changes?.cascadingChanges || {},
                            urlChange: test.changes?.urlChange
                        });
                    }
                }

                // Create embeddings for cascading effects
                if (result.sampledTests) {
                    for (const test of result.sampledTests) {
                        if (test.changes?.cascadingChanges) {
                            for (const [affectedElement, change] of Object.entries(test.changes.cascadingChanges)) {
                                const cascadingDescription = `Selecting "${test.option}" in ${result.label} dropdown causes cascading change to ${affectedElement}: ${JSON.stringify(change)}.`;
                                
                                await this.createAndStoreEmbedding(cascadingDescription, {
                                    type: 'cascading_effect',
                                    sourceElement: result.label,
                                    sourceOption: test.option,
                                    affectedElement: affectedElement,
                                    change: change
                                });
                            }
                        }
                    }
                }

            } catch (error: any) {
                console.error(`❌ Failed to index UI exploration result for ${result.label}:`, error);
                throw new Error(`RAG UI indexing failed for ${result.label}. NO FALLBACK AVAILABLE.`);
            }
        }
        
        await this.saveVectorStore();
        console.log(`✅ UI exploration data indexed successfully`);
    }

    async queryTSVKnowledge(question: string): Promise<any[]> {
        console.log(`🔍 Querying RAG for TSV knowledge: "${question}"`);
        
        try {
            const results = await this.searchRelevantData(question, 10);
            
            // DEBUG: Log what we found
            console.log(`🔍 DEBUG: Found ${results.length} total results`);
            results.forEach((result, index) => {
                console.log(`🔍 DEBUG: Result ${index}:`, {
                    hasMetadata: !!result.metadata,
                    metadataType: result.metadata?.type,
                    fileName: result.fileName,
                    hasRecords: !!result.records,
                    recordsType: typeof result.records,
                    allKeys: Object.keys(result)
                });
            });
            
            // Filter for TSV-related results
            // Handle both new entries with metadata and old entries without metadata
            const tsvResults = results.filter(result => {
                // Null/undefined check
                if (!result || typeof result !== 'object') return false;
                
                // New entries with proper metadata
                if (result.metadata?.type === 'tsv_field' || 
                    result.metadata?.type === 'relationship' ||
                    result.metadata?.type === 'tsv_record') {
                    return true;
                }
                // Old entries without metadata - treat as TSV records if they have records property
                if (!result.metadata && result.records && Array.isArray(result.records)) {
                    return true;
                }
                // Handle flat TSV records (actual structure found in logs)
                if (!result.metadata && !result.records && result['type']) {
                    return true;
                }
                return false;
            });
            
            console.log(`✅ Found ${tsvResults.length} relevant TSV knowledge items`);
            return tsvResults;
            
        } catch (error: any) {
            console.error(`❌ Failed to query TSV knowledge:`, error);
            throw new Error(`RAG TSV query failed. NO FALLBACK AVAILABLE.`);
        }
    }

    async queryUIKnowledge(question: string): Promise<any[]> {
        console.log(`🔍 Querying RAG for UI knowledge: "${question}"`);
        
        try {
            // Check if vector store has UI data before querying
            const hasUIData = Array.from(this.vectorStore.values()).some(chunk => 
                chunk.metadata?.type === 'ui_element' || 
                chunk.metadata?.type === 'ui_behavior' ||
                chunk.metadata?.type === 'cascading_effect'
            );
            
            if (!hasUIData) {
                console.warn(`⚠️  No UI data found in vector store. UI indexing may not have completed yet. Returning empty array.`);
                return [];
            }
            
            const results = await this.searchRelevantData(question, 10);
            
            // DEBUG: Log what we found
            console.log(`🔍 DEBUG: Found ${results.length} total results for UI query`);
            results.forEach((result, index) => {
                console.log(`🔍 DEBUG: UI Result ${index}:`, {
                    hasMetadata: !!result.metadata,
                    metadataType: result.metadata?.type,
                    elementType: result.metadata?.elementType,
                    label: result.metadata?.label,
                    selector: result.metadata?.selector,
                    allKeys: Object.keys(result)
                });
            });
            
            // Filter for UI-related results
            const uiResults = results.filter(result => {
                // Null/undefined check
                if (!result || typeof result !== 'object') return false;
                
                return result.metadata?.type === 'ui_element' || 
                       result.metadata?.type === 'ui_behavior' ||
                       result.metadata?.type === 'cascading_effect';
            });
            
            console.log(`✅ Found ${uiResults.length} relevant UI knowledge items`);
            return uiResults;
            
        } catch (error: any) {
            console.warn(`⚠️  Failed to query UI knowledge: ${error.message}. Returning empty array to allow mapping to proceed.`);
            return []; // Return empty array instead of throwing - allows mapping to proceed with TSV data only
        }
    }

    async queryMappings(question: string): Promise<any[]> {
        console.log(`🔍 Querying RAG for mappings: "${question}"`);
        console.log(`📊 Vector store size: ${this.vectorStore.size}`);
        
        try {
            // Directly iterate through vector store to find all mappings
            // This is more reliable than semantic search which might miss mappings
            // if they're not in the top K results
            const mappingResults: any[] = [];
            let totalChunks = 0;
            let chunksWithMetadata = 0;
            let chunksWithMappingType = 0;
            
            for (const [id, chunk] of this.vectorStore.entries()) {
                totalChunks++;
                // Check if this chunk is a mapping
                if (chunk && typeof chunk === 'object') {
                    if (chunk.metadata) {
                        chunksWithMetadata++;
                        if (chunk.metadata.type === 'ui_tsv_mapping') {
                            chunksWithMappingType++;
                            mappingResults.push({
                                id: id,
                                text: chunk.text || '',
                                metadata: chunk.metadata || {},
                                similarity: 1.0, // Direct match, so perfect similarity
                                fileName: chunk.metadata?.tsvFile || ''
                            });
                        }
                    }
                }
            }
            
            console.log(`📊 Vector store analysis: ${totalChunks} total chunks, ${chunksWithMetadata} with metadata, ${chunksWithMappingType} with type 'ui_tsv_mapping'`);
            console.log(`✅ Found ${mappingResults.length} mappings in vector store (direct filter)`);
            
            // If we found mappings, return them
            if (mappingResults.length > 0) {
                return mappingResults;
            }
            
            // Fallback: Try semantic search as backup (in case mappings are stored differently)
            console.log(`⚠️ No mappings found via direct filter, trying semantic search as fallback...`);
            const semanticResults = await this.searchRelevantData(question, 50); // Increase topK for fallback
            
            const filteredResults = semanticResults.filter(result => {
                if (!result || typeof result !== 'object') return false;
                return result.metadata?.type === 'ui_tsv_mapping';
            });
            
            console.log(`✅ Found ${filteredResults.length} mappings via semantic search fallback`);
            return filteredResults;
            
        } catch (error: any) {
            console.error(`❌ Failed to query mappings:`, error);
            throw new Error(`RAG mapping query failed. NO FALLBACK AVAILABLE.`);
        }
    }

    async storeMappingResult(mapping: any): Promise<void> {
        console.log(`💾 Storing mapping result: ${mapping.uiLabel} → ${mapping.tsvField}`);
        
        try {
            const mappingDescription = `UI element "${mapping.uiLabel}" (${mapping.uiSelector}) maps to TSV field "${mapping.tsvField}" in file "${mapping.tsvFile}" with confidence ${mapping.confidence}. ${mapping.reasoning || ''}`;
            
            await this.createAndStoreEmbedding(mappingDescription, {
                type: 'ui_tsv_mapping',
                uiLabel: mapping.uiLabel,
                uiSelector: mapping.uiSelector,
                tsvField: mapping.tsvField,
                tsvFile: mapping.tsvFile,
                confidence: mapping.confidence,
                reasoning: mapping.reasoning,
                dataMismatch: mapping.dataMismatch
            });
            
            console.log(`✅ Mapping stored successfully`);
            
        } catch (error: any) {
            console.error(`❌ Failed to store mapping:`, error);
            throw new Error(`RAG mapping storage failed. NO FALLBACK AVAILABLE.`);
        }
    }
    
    // Helper methods
    private parseTSV(content: string): any[] {
        const lines = content.split('\n').filter(line => line.trim());
        if (lines.length < 2) return [];
        
        const headers = lines[0].split('\t').map(h => h.trim());
        return lines.slice(1).map(line => {
            const values = line.split('\t');
            const record: any = {};
            headers.forEach((header, index) => {
                record[header] = values[index]?.trim() || '';
            });
            return record;
        });
    }
    
    private detectFieldTypes(records: any[]): any {
        const types: any = {};
        const headers = Object.keys(records[0]);
        headers.forEach(header => {
            const values = records.map(r => r[header]).filter(v => v);
            const numericCount = values.filter(v => !isNaN(Number(v))).length;
            types[header] = numericCount / values.length > 0.8 ? 'number' : 'string';
        });
        return types;
    }
    
    private detectRelationships(records: any[], headers: string[]): any[] {
        const relationships: any[] = [];
        
        // Simple relationship detection based on common patterns
        for (let i = 0; i < headers.length; i++) {
            for (let j = i + 1; j < headers.length; j++) {
                const field1 = headers[i];
                const field2 = headers[j];
                
                // Check for foreign key relationships (field1_id -> field1)
                if (field1.endsWith('_id') && field2 === field1.replace('_id', '')) {
                    relationships.push({
                        from: field1,
                        to: field2,
                        type: 'foreign_key'
                    });
                }
                
                // Check for dependency relationships
                if (field1.includes('_id') && !field2.includes('_id')) {
                    relationships.push({
                        from: field1,
                        to: field2,
                        type: 'dependency'
                    });
                }
                
                // Check for hierarchy relationships
                if (field1.includes('type') && field2.includes('subtype')) {
                    relationships.push({
                        from: field1,
                        to: field2,
                        type: 'hierarchy'
                    });
                }
            }
        }
        
        return relationships;
    }
    
    private recordsToText(records: any[]): string {
        return records.map(r => 
            Object.entries(r).map(([k, v]) => `${k}: ${v}`).join(', ')
        ).join('\n');
    }
    
    private chunkRecords(records: any[], chunkSize: number): any[][] {
        const chunks = [];
        for (let i = 0; i < records.length; i += chunkSize) {
            chunks.push(records.slice(i, i + chunkSize));
        }
        return chunks;
    }
    
    private cosineSimilarity(vec1: number[], vec2: number[]): number {
        const dotProduct = vec1.reduce((sum, a, i) => sum + a * vec2[i], 0);
        const mag1 = Math.sqrt(vec1.reduce((sum, a) => sum + a * a, 0));
        const mag2 = Math.sqrt(vec2.reduce((sum, a) => sum + a * a, 0));
        return dotProduct / (mag1 * mag2);
    }

    // ===== NEW METHOD FOR DYNAMIC TEST DATA EXTRACTION =====

    async extractSampleValues(fieldType: string): Promise<string[]> {
        console.log(`🔍 Extracting sample values for field type: ${fieldType}`);
        
        try {
            // Query RAG for field values of specific types
            const query = `What are the ${fieldType} field values in the TSV data?`;
            const tsvKnowledge = await this.queryTSVKnowledge(query);
            
            if (!tsvKnowledge || tsvKnowledge.length === 0) {
                throw new Error(`No ${fieldType} data available in RAG for sample extraction. NO FALLBACK AVAILABLE.`);
            }
            
            // Extract diverse sample values
            const sampleValues = new Set<string>();
            
            for (const knowledge of tsvKnowledge) {
                if (knowledge.metadata?.type === 'tsv_record' && knowledge.records) {
                    knowledge.records.forEach((record: any) => {
                        Object.entries(record).forEach(([field, value]) => {
                            if (typeof value === 'string' && value.length > 0 && value.length < 50) {
                                // Filter by field type if specified
                                if (fieldType === 'categorical' || fieldType === 'string') {
                                    // Skip IDs, codes, and very long values
                                    if (!value.match(/^[A-Z0-9_-]+$/) && !value.includes('http')) {
                                        sampleValues.add(value.trim());
                                    }
                                }
                            }
                        });
                    });
                }
            }
            
            // Convert to array and take diverse samples
            const values = Array.from(sampleValues).slice(0, 10);
            
            if (values.length === 0) {
                throw new Error(`No suitable ${fieldType} values found in TSV data. NO FALLBACK AVAILABLE.`);
            }
            
            console.log(`✅ Extracted ${values.length} ${fieldType} sample values: ${values.slice(0, 3).join(', ')}${values.length > 3 ? '...' : ''}`);
            return values;
            
        } catch (error: any) {
            console.error(`❌ Failed to extract ${fieldType} sample values:`, error);
            throw new Error(`${fieldType} sample extraction failed: ${error.message}. NO FALLBACK AVAILABLE.`);
        }
    }
}
