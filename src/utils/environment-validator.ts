export class EnvironmentValidator {
    private static REQUIRED_VARS = [
        'AWS_REGION',
        'AWS_ACCESS_KEY_ID',
        'AWS_SECRET_ACCESS_KEY',
        'S3_BUCKET_NAME',
        'BEDROCK_MODEL_ID',
        'BEDROCK_EMBEDDING_MODEL_ID'
    ];

    static validate(): void {
        console.log('🔍 Validating environment configuration...');
        
        const missing: string[] = [];
        
        for (const varName of this.REQUIRED_VARS) {
            if (!process.env[varName]) {
                missing.push(varName);
            }
        }
        
        if (missing.length > 0) {
            const error = `
❌ FATAL: Missing required environment variables:
${missing.map(v => `  - ${v}`).join('\n')}

Please add these to your .env file.
The system cannot operate without proper AWS credentials and configuration.
NO FALLBACK AVAILABLE - this is a pure AI system.`;
            
            console.error(error);
            throw new Error('Environment validation failed: ' + missing.join(', '));
        }
        
        console.log('✅ Environment validation passed\n');
    }
}
