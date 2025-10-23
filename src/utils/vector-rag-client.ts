import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
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
        
        console.log('✅ VectorRAGClient initialized with S3 and Bedrock');
    }
    
    async indexTSVData(tsvFiles: any[]): Promise<void> {
        if (!tsvFiles || tsvFiles.length === 0) {
            throw new Error('No TSV files provided for indexing. Cannot proceed with pure RAG system.');
        }
        
        console.log('\n' + '='.repeat(80));
        console.log('🔍 RAG: STARTING VECTOR EMBEDDING CREATION (Pure AI Mode)');
        console.log('='.repeat(80));
        
        for (const file of tsvFiles) {
            console.log(`\n📊 Processing File: ${file.name}`);
            const records = this.parseTSV(file.content);
            
            if (records.length === 0) {
                throw new Error(`File ${file.name} has no records. Cannot create embeddings.`);
            }
            
            console.log(`  ├─ Total Records: ${records.length}`);
            
            // Store metadata
            this.tsvMetadata[file.name] = {
                headers: Object.keys(records[0] || {}),
                recordCount: records.length,
                fieldTypes: this.detectFieldTypes(records),
                uniqueValues: this.extractUniqueValues(records),
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
                    text: chunkText
                });
                
                console.log(`  │  ✅ Embedding ID: ${embedding.id}, Dimensions: ${embedding.vector.length}`);
            }
        }
        
        // Save to S3 (REQUIRED - will throw error if fails)
        await this.saveVectorStore();
        
        console.log('\n' + '='.repeat(80));
        console.log('✅ RAG: VECTOR STORE COMPLETE');
        console.log(`  ├─ Total Embeddings: ${this.vectorStore.size}`);
        console.log(`  └─ S3 Bucket: ${process.env.S3_BUCKET_NAME}`);
        console.log('='.repeat(80) + '\n');
    }
    
    async searchRelevantData(query: string, topK?: number): Promise<any[]> {
        if (this.vectorStore.size === 0) {
            throw new Error('Vector store is empty. Run indexTSVData() first. NO FALLBACK AVAILABLE.');
        }
        
        const k = topK || parseInt(process.env.RAG_TOP_K_RESULTS || '10');
        const minSimilarity = parseFloat(process.env.RAG_MIN_SIMILARITY || '0.7');
        
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
        
        if (results.length === 0) {
            throw new Error(`No relevant data found for query "${query}". Minimum similarity threshold ${minSimilarity} not met. Cannot proceed without data.`);
        }
        
        results.sort((a, b) => b.similarity - a.similarity);
        const topResults = results.slice(0, k);
        
        console.log(`  ✅ Found ${topResults.length} relevant chunks\n`);
        
        return topResults.flatMap(r => r.records);
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
            if (metadata.headers.includes(fieldName)) {
                return {
                    fileName,
                    fieldName,
                    type: metadata.fieldTypes[fieldName],
                    uniqueValues: metadata.uniqueValues[fieldName],
                    sampleRecords: metadata.sampleRecords
                };
            }
        }
        throw new Error(`Field "${fieldName}" not found in any TSV file. Cannot generate test data.`);
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
    
    private extractUniqueValues(records: any[]): any {
        const uniqueValues: any = {};
        const headers = Object.keys(records[0]);
        headers.forEach(header => {
            const values = [...new Set(records.map(r => r[header]).filter(v => v))];
            uniqueValues[header] = values.slice(0, 100);
        });
        return uniqueValues;
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
}
