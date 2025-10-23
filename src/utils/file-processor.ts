export class FileProcessor {
    static parseTSV(content: string): any[] {
        const lines = content.split('\n').filter(line => line.trim());
        if (lines.length < 2) return [];
        
        const headers = lines[0].split('\t');
        const rows = lines.slice(1).map(line => {
            const values = line.split('\t');
            const row: any = {};
            headers.forEach((header, index) => {
                row[header.trim()] = values[index]?.trim() || '';
            });
            return row;
        });
        
        return rows;
    }
    
    static analyzeTSVFiles(files: any[]): any {
        let totalFields = 0;
        let totalRecords = 0;
        const fieldTypes: { [key: string]: string[] } = {};
        const relationships: string[] = [];
        
        files.forEach(file => {
            if (file.content) {
                const data = this.parseTSV(file.content);
                totalRecords += data.length;
                
                if (data.length > 0) {
                    const fields = Object.keys(data[0]);
                    totalFields += fields.length;
                    
                    // Analyze field types
                    fields.forEach(field => {
                        if (!fieldTypes[field]) fieldTypes[field] = [];
                        const sampleValue = data[0][field];
                        const type = this.detectFieldType(sampleValue);
                        if (!fieldTypes[field].includes(type)) {
                            fieldTypes[field].push(type);
                        }
                    });
                    
                    // Look for relationships (fields with similar names)
                    fields.forEach(field => {
                        // Detect ID fields by pattern, not specific names
                        if (field.toLowerCase().includes('_id') || 
                            field.toLowerCase().endsWith('id') ||
                            field.toLowerCase().startsWith('id_')) {
                            relationships.push(field);
                        }
                    });
                }
            }
        });
        
        return {
            totalFields,
            totalRecords,
            fieldTypes,
            relationships: [...new Set(relationships)],
            filesAnalyzed: files.length
        };
    }
    
    static detectFieldType(value: string): string {
        if (!value) return 'empty';
        if (/^\d+$/.test(value)) return 'integer';
        if (/^\d+\.\d+$/.test(value)) return 'decimal';
        if (/^\d{4}-\d{2}-\d{2}/.test(value)) return 'date';
        if (value.toLowerCase() === 'yes' || value.toLowerCase() === 'no') return 'boolean';
        if (value.length > 50) return 'text';
        return 'string';
    }
}
