export interface DataPatterns {
    categorical: CategoricalField[];
    numerical: NumericalField[];
    identifiers: IdentifierField[];
    searchable: SearchableField[];
    temporal: TemporalField[];
    sortable: SortableField[];
  }
  
export interface UIPatterns {
  filters: FilterElement[];
  search: SearchElement[];
  tables: TableElement[];
  sortable: SortableElement[];
  pagination: PaginationElement[];
  buttons: ButtonElement[];
  forms: FormElement[];
}
  
  export interface CategoricalField {
    name: string;
    values: string[];
    uniqueCount: number;
    totalCount: number;
    relationships?: string[];
    businessRules?: string[];
  }
  
  export interface NumericalField {
    name: string;
    min: number;
    max: number;
    average: number;
    relationships?: string[];
    businessRules?: string[];
  }
  
  export interface IdentifierField {
    name: string;
    uniqueness: number; // percentage of unique values
    relationships?: string[];
    businessRules?: string[];
  }
  
  export interface SearchableField {
    name: string;
    sampleValues: string[];
    avgLength: number;
    relationships?: string[];
    businessRules?: string[];
  }
  
  export interface TemporalField {
    name: string;
    format: string;
    sampleValues: string[];
    relationships?: string[];
    businessRules?: string[];
  }
  
  export interface SortableField {
    name: string;
    type: 'string' | 'number' | 'date';
    sampleValues: string[];
    relationships?: string[];
    businessRules?: string[];
  }
  
  export interface FilterElement {
    selector: string;
    type: 'dropdown' | 'checkbox' | 'slider' | 'radio';
    options?: string[];
  }
  
  export interface SearchElement {
    selector: string;
    type: 'text' | 'search';
    placeholder?: string;
  }
  
  export interface TableElement {
    selector: string;
    columns: string[];
    rowCount: number;
  }
  
  export interface SortableElement {
    selector: string;
    type: 'header' | 'button';
    sortableFields: string[];
  }
  
export interface PaginationElement {
  selector: string;
  type: 'pagination' | 'load_more' | 'infinite_scroll';
}

export interface ButtonElement {
  selector: string;
  type: 'button' | 'submit' | 'link' | 'icon';
  text?: string;
  ariaLabel?: string;
}

export interface FormElement {
  selector: string;
  inputs: string[];
  submitButton?: string;
}
  
  export class UniversalPatternDetector {
    
    // Universal Data Pattern Discovery
    discoverDataPatterns(data: any[]): DataPatterns {
      // Parse TSV files into data records first
      const parsedData: any[] = [];
      data.forEach(tsvFile => {
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
            parsedData.push(...rows);
          }
        }
      });

      if (parsedData.length === 0) {
        return {
          categorical: [],
          numerical: [],
          identifiers: [],
          searchable: [],
          temporal: [],
          sortable: []
        };
      }

      // Extract all unique field names from parsed data
      const allFields = new Set<string>();
      parsedData.forEach(record => {
        Object.keys(record).forEach(field => allFields.add(field));
      });
      const fields = Array.from(allFields);
      
      return {
        categorical: this.detectCategoricalFields(parsedData, fields),
        numerical: this.detectNumericalFields(parsedData, fields),
        identifiers: this.detectIdentifierFields(parsedData, fields),
        searchable: this.detectSearchableFields(parsedData, fields),
        temporal: this.detectTemporalFields(parsedData, fields),
        sortable: this.detectSortableFields(parsedData, fields)
      };
    }
  
    // Universal UI Pattern Discovery
discoverUIPatterns(html: string): UIPatterns {
  return {
    filters: this.detectFilterElements(html),
    search: this.detectSearchElements(html),
    tables: this.detectTableElements(html),
    sortable: this.detectSortableElements(html),
    pagination: this.detectPaginationElements(html),
    buttons: this.detectButtonElements(html),
    forms: this.detectFormElements(html)
  };
}
  
    // Detect categorical fields (fields with repeated values)
    private detectCategoricalFields(data: any[], fields: string[]): CategoricalField[] {
      const categorical: CategoricalField[] = [];
  
      fields.forEach(field => {
        const values = data.map(record => String(record[field] || '')).filter(v => v);
        const uniqueValues = [...new Set(values)];
        const uniqueCount = uniqueValues.length;
        const totalCount = values.length;
  
        // STRICT VALIDATION: Categorical if: has repeated values AND not too many unique values AND sufficient data
        if (uniqueCount > 1 && uniqueCount < totalCount * 0.8 && uniqueCount < 50 && values.length >= 3) {
          categorical.push({
            name: field,
            values: uniqueValues,
            uniqueCount,
            totalCount
          });
        } else if (values.length < 3) {
          console.warn(`⚠️ Skipping categorical field ${field}: Insufficient sample values (${values.length} < 3)`);
        }
      });
  
      // 🔧 ADD: Apply relationship detection
      return this.applyRelationshipDetection(data, fields, categorical);
    }
  
    // Detect numerical fields
    private detectNumericalFields(data: any[], fields: string[]): NumericalField[] {
      const numerical: NumericalField[] = [];
  
      fields.forEach(field => {
        const values = data.map(record => {
          const val = record[field];
          return typeof val === 'number' ? val : parseFloat(String(val));
        }).filter(v => !isNaN(v));
  
        // STRICT VALIDATION: Only include if we have sufficient numerical data
        if (values.length >= 3) {
          numerical.push({
            name: field,
            min: Math.min(...values),
            max: Math.max(...values),
            average: values.reduce((a, b) => a + b, 0) / values.length
          });
        } else if (values.length > 0) {
          console.warn(`⚠️ Skipping numerical field ${field}: Insufficient sample values (${values.length} < 3)`);
        }
      });
  
      // 🔧 ADD: Apply relationship detection
      return this.applyRelationshipDetection(data, fields, numerical);
    }
  
    // Detect identifier fields (highly unique values)
    private detectIdentifierFields(data: any[], fields: string[]): IdentifierField[] {
      const identifiers: IdentifierField[] = [];
  
      fields.forEach(field => {
        const values = data.map(record => String(record[field] || '')).filter(v => v);
        const uniqueValues = [...new Set(values)];
        const uniqueness = uniqueValues.length / values.length;
  
        // Identifier if: high uniqueness (>90%) AND reasonable length
        if (uniqueness > 0.9 && values.length > 0) {
          identifiers.push({
            name: field,
            uniqueness
          });
        }
      });
  
      // 🔧 ADD: Apply relationship detection
      return this.applyRelationshipDetection(data, fields, identifiers);
    }
  
    // Detect searchable fields (text fields)
    private detectSearchableFields(data: any[], fields: string[]): SearchableField[] {
      const searchable: SearchableField[] = [];
  
      fields.forEach(field => {
        const values = data.map(record => String(record[field] || '')).filter(v => v);
        const avgLength = values.reduce((sum, val) => sum + val.length, 0) / values.length;
  
        // STRICT VALIDATION: Only include if we have actual sample values
        if (avgLength > 2 && avgLength < 200 && values.length >= 3) {
          searchable.push({
            name: field,
            sampleValues: values.slice(0, 5),
            avgLength
          });
        } else if (values.length < 3) {
          console.warn(`⚠️ Skipping searchable field ${field}: Insufficient sample values (${values.length} < 3)`);
        }
      });
  
      // 🔧 ADD: Apply relationship detection
      return this.applyRelationshipDetection(data, fields, searchable);
    }
  
    // Detect temporal fields (date/time)
    private detectTemporalFields(data: any[], fields: string[]): TemporalField[] {
      const temporal: TemporalField[] = [];

      fields.forEach(field => {
        const values = data.map(record => String(record[field] || '')).filter(v => v);
        
        // Check for date patterns
        const datePatterns = [
          /^\d{4}-\d{2}-\d{2}$/, // YYYY-MM-DD
          /^\d{2}\/\d{2}\/\d{4}$/, // MM/DD/YYYY
          /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/, // ISO datetime
        ];

        const isDateField = values.some(val => 
          datePatterns.some(pattern => pattern.test(val))
        );

        if (isDateField) {
          temporal.push({
            name: field,
            format: this.detectDateFormat(values[0]),
            sampleValues: values.slice(0, 3)
          });
        }
      });

      // 🔧 ADD: Apply relationship detection
      return this.applyRelationshipDetection(data, fields, temporal);
    }

    // Detect sortable fields (fields suitable for sorting)
    private detectSortableFields(data: any[], fields: string[]): SortableField[] {
      const sortable: SortableField[] = [];

      fields.forEach(field => {
        const values = data.map(record => String(record[field] || '')).filter(v => v);
        
        // STRICT VALIDATION: Only process if we have sufficient data
        if (values.length < 3) {
          console.warn(`⚠️ Skipping sortable field ${field}: Insufficient sample values (${values.length} < 3)`);
          return;
        }

        // Check if field is numeric
        const numericValues = values.map(v => parseFloat(v)).filter(v => !isNaN(v));
        if (numericValues.length > values.length * 0.8) {
          sortable.push({
            name: field,
            type: 'number',
            sampleValues: values.slice(0, 3)
          });
          return;
        }

        // Check if field is date
        const datePatterns = [
          /^\d{4}-\d{2}-\d{2}$/, // YYYY-MM-DD
          /^\d{2}\/\d{2}\/\d{4}$/, // MM/DD/YYYY
          /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/, // ISO datetime
        ];

        const isDateField = values.some(val => 
          datePatterns.some(pattern => pattern.test(val))
        );

        if (isDateField) {
          sortable.push({
            name: field,
            type: 'date',
            sampleValues: values.slice(0, 3)
          });
          return;
        }

        // Default to string for text fields
        sortable.push({
          name: field,
          type: 'string',
          sampleValues: values.slice(0, 3)
        });
      });

      // 🔧 ADD: Apply relationship detection
      return this.applyRelationshipDetection(data, fields, sortable);
    }
  
    // Detect filter elements in HTML (Enhanced for React/Material-UI)
    private detectFilterElements(html: string): FilterElement[] {
      const filters: FilterElement[] = [];
  
      // 1. Traditional HTML elements
      this.detectTraditionalFilters(html, filters);
      
      // 2. React/Material-UI components
      this.detectReactFilters(html, filters);
      
      // 3. Custom filter patterns
      this.detectCustomFilters(html, filters);

      return filters;
    }

    // Detect traditional HTML filter elements
    private detectTraditionalFilters(html: string, filters: FilterElement[]): void {
      // Dropdowns
      const dropdownRegex = /<select[^>]*name=["']([^"']+)["'][^>]*>/gi;
      let match;
      while ((match = dropdownRegex.exec(html)) !== null) {
        filters.push({
          selector: `select[name="${match[1]}"]`,
          type: 'dropdown'
        });
      }
  
      // Checkboxes
      const checkboxRegex = /<input[^>]*type=["']checkbox["'][^>]*name=["']([^"']+)["'][^>]*>/gi;
      while ((match = checkboxRegex.exec(html)) !== null) {
        filters.push({
          selector: `input[name="${match[1]}"]`,
          type: 'checkbox'
        });
      }
  
      // Radio buttons
      const radioRegex = /<input[^>]*type=["']radio["'][^>]*name=["']([^"']+)["'][^>]*>/gi;
      while ((match = radioRegex.exec(html)) !== null) {
        filters.push({
          selector: `input[name="${match[1]}"]`,
          type: 'radio'
        });
      }
    }

    // Detect React/Material-UI filter elements
    private detectReactFilters(html: string, filters: FilterElement[]): void {
      // Material-UI Select components
      const muiSelectRegex = /class=["'][^"']*MuiSelect[^"']*["'][^>]*>/gi;
      let match;
      while ((match = muiSelectRegex.exec(html)) !== null) {
        // Extract data attributes or aria labels
        const ariaLabelMatch = match[0].match(/aria-label=["']([^"']+)["']/i);
        const dataTestIdMatch = match[0].match(/data-testid=["']([^"']+)["']/i);
        
        if (ariaLabelMatch) {
          filters.push({
            selector: `[aria-label="${ariaLabelMatch[1]}"]`,
            type: 'dropdown'
          });
        } else if (dataTestIdMatch) {
          filters.push({
            selector: `[data-testid="${dataTestIdMatch[1]}"]`,
            type: 'dropdown'
          });
        }
      }

      // Material-UI Checkbox components
      const muiCheckboxRegex = /class=["'][^"']*MuiCheckbox[^"']*["'][^>]*>/gi;
      while ((match = muiCheckboxRegex.exec(html)) !== null) {
        const ariaLabelMatch = match[0].match(/aria-label=["']([^"']+)["']/i);
        if (ariaLabelMatch) {
          filters.push({
            selector: `[aria-label="${ariaLabelMatch[1]}"]`,
            type: 'checkbox'
          });
        }
      }

      // Material-UI Radio components
      const muiRadioRegex = /class=["'][^"']*MuiRadio[^"']*["'][^>]*>/gi;
      while ((match = muiRadioRegex.exec(html)) !== null) {
        const ariaLabelMatch = match[0].match(/aria-label=["']([^"']+)["']/i);
        if (ariaLabelMatch) {
          filters.push({
            selector: `[aria-label="${ariaLabelMatch[1]}"]`,
            type: 'radio'
          });
        }
      }

      // Generic React components with filter-related classes
      const filterClassRegex = /class=["'][^"']*(?:filter|dropdown|select|checkbox|radio)[^"']*["'][^>]*>/gi;
      while ((match = filterClassRegex.exec(html)) !== null) {
        const classMatch = match[0].match(/class=["']([^"']+)["']/i);
        if (classMatch) {
          const classes = classMatch[1].split(' ');
          const filterClass = classes.find(cls => 
            cls.toLowerCase().includes('filter') || 
            cls.toLowerCase().includes('dropdown') ||
            cls.toLowerCase().includes('select') ||
            cls.toLowerCase().includes('checkbox') ||
            cls.toLowerCase().includes('radio')
          );
          
          if (filterClass) {
            filters.push({
              selector: `.${filterClass}`,
              type: this.determineFilterType(filterClass)
            });
          }
        }
      }

      // Enhanced Material-UI CSS class detection for filters
      const muiClassRegex = /class=["'][^"']*mui-[^"']*["'][^>]*>/gi;
      while ((match = muiClassRegex.exec(html)) !== null) {
        const classMatch = match[0].match(/class=["']([^"']+)["']/i);
        if (classMatch && classMatch[1].includes('mui-')) {
          const muiClasses = classMatch[1].split(' ').filter(cls => 
            cls.startsWith('mui-') && (
              cls.includes('select') || 
              cls.includes('checkbox') || 
              cls.includes('filter') ||
              cls.includes('dropdown') ||
              cls.includes('radio')
            )
          );
          
          if (muiClasses.length > 0) {
            filters.push({
              selector: `.${muiClasses[0]}`,
              type: 'dropdown'
            });
          }
        }
      }
    }

    // Detect custom filter patterns
    private detectCustomFilters(html: string, filters: FilterElement[]): void {
      // Look for filter-related text patterns
      const filterTextPatterns = [
        'Filter By',
        'Filter by',
        'Select',
        'Choose',
        'Options',
        'Categories'
      ];

      filterTextPatterns.forEach(pattern => {
        const regex = new RegExp(`[^>]*${pattern}[^<]*<[^>]*>`, 'gi');
        let match;
        while ((match = regex.exec(html)) !== null) {
          // Look for nearby input elements
          const nearbyInputMatch = match[0].match(/<input[^>]*>/i);
          if (nearbyInputMatch) {
            const typeMatch = nearbyInputMatch[0].match(/type=["']([^"']+)["']/i);
            const nameMatch = nearbyInputMatch[0].match(/name=["']([^"']+)["']/i);
            
            if (typeMatch && nameMatch) {
              filters.push({
                selector: `input[name="${nameMatch[1]}"]`,
                type: typeMatch[1] as any
              });
            }
          }
        }
      });

      // Look for data attributes indicating filters
      const dataFilterRegex = /data-[^=]*filter[^=]*=["'][^"']*["'][^>]*>/gi;
      let match;
      while ((match = dataFilterRegex.exec(html)) !== null) {
        const dataAttrMatch = match[0].match(/data-([^=]*filter[^=]*)=["']([^"']*)["']/i);
        if (dataAttrMatch) {
          filters.push({
            selector: `[data-${dataAttrMatch[1]}="${dataAttrMatch[2]}"]`,
            type: 'dropdown'
          });
        }
      }
    }

    // Determine filter type based on class name
    private determineFilterType(className: string): 'dropdown' | 'checkbox' | 'slider' | 'radio' {
      const lowerClass = className.toLowerCase();
      if (lowerClass.includes('checkbox')) return 'checkbox';
      if (lowerClass.includes('radio')) return 'radio';
      if (lowerClass.includes('slider')) return 'slider';
      return 'dropdown';
    }
  
    // Detect search elements
    // Detect search elements (Enhanced for React)
    private detectSearchElements(html: string): SearchElement[] {
      const search: SearchElement[] = [];
  
      // 1. Traditional search inputs
      this.detectTraditionalSearch(html, search);
      
      // 2. React/Material-UI search components
      this.detectReactSearch(html, search);
      
      // 3. Custom search patterns
      this.detectCustomSearch(html, search);

      return search;
    }

    // Detect traditional search inputs
    private detectTraditionalSearch(html: string, search: SearchElement[]): void {
      const searchRegex = /<input[^>]*(?:type=["']search["']|placeholder=["'][^"']*search[^"']*["'])[^>]*>/gi;
      let match;
      while ((match = searchRegex.exec(html)) !== null) {
        const placeholderMatch = match[0].match(/placeholder=["']([^"']+)["']/);
        const selector = 'input[type="search"]';
        
        // STRICT VALIDATION: Only add if selector is valid
        if (selector && selector.trim() !== '') {
          search.push({
            selector: selector,
            type: 'search',
            placeholder: placeholderMatch ? placeholderMatch[1] : undefined
          });
        }
      }
  
      // Text inputs that might be search
      const textRegex = /<input[^>]*type=["']text["'][^>]*>/gi;
      while ((match = textRegex.exec(html)) !== null) {
        const placeholderMatch = match[0].match(/placeholder=["']([^"']+)["']/);
        if (placeholderMatch && placeholderMatch[1].toLowerCase().includes('search')) {
          const selector = 'input[type="text"]';
          
          // STRICT VALIDATION: Only add if selector is valid
          if (selector && selector.trim() !== '') {
            search.push({
              selector: selector,
              type: 'text',
              placeholder: placeholderMatch[1]
            });
          }
        }
      }
    }

    // Detect React/Material-UI search components
    private detectReactSearch(html: string, search: SearchElement[]): void {
      // Material-UI TextField with search
      const muiSearchRegex = /class=["'][^"']*MuiTextField[^"']*["'][^>]*>/gi;
      let match;
      while ((match = muiSearchRegex.exec(html)) !== null) {
        const placeholderMatch = match[0].match(/placeholder=["']([^"']+)["']/i);
        const ariaLabelMatch = match[0].match(/aria-label=["']([^"']+)["']/i);
        
        if (placeholderMatch || ariaLabelMatch) {
          const selector = `[aria-label="${ariaLabelMatch?.[1] || placeholderMatch?.[1]}"]`;
          
          // STRICT VALIDATION: Only add if selector is valid
          if (selector && selector !== 'undefined' && selector.trim() !== '') {
            search.push({
              selector: selector,
              type: 'text',
              placeholder: placeholderMatch?.[1]
            });
          }
        }
      }

      // Generic search components
      const searchClassRegex = /class=["'][^"']*(?:search|filter|query)[^"']*["'][^>]*>/gi;
      while ((match = searchClassRegex.exec(html)) !== null) {
        const classMatch = match[0].match(/class=["']([^"']+)["']/i);
        if (classMatch) {
          const searchClass = classMatch[1].split(' ').find(cls => 
            cls.toLowerCase().includes('search') || 
            cls.toLowerCase().includes('filter') ||
            cls.toLowerCase().includes('query')
          );
          
          if (searchClass) {
            const selector = `.${searchClass}`;
            
            // STRICT VALIDATION: Only add if selector is valid
            if (selector && selector !== 'undefined' && selector.trim() !== '') {
              search.push({
                selector: selector,
                type: 'text'
              });
            }
          }
        }
      }
    }

    // Detect custom search patterns
    private detectCustomSearch(html: string, search: SearchElement[]): void {
      // Look for search-related text
      const searchTextPatterns = [
        'Search',
        'Find',
        'Query',
        'Look for',
        'Filter'
      ];

      searchTextPatterns.forEach(pattern => {
        const regex = new RegExp(`[^>]*${pattern}[^<]*<[^>]*>`, 'gi');
        let match;
        while ((match = regex.exec(html)) !== null) {
          // Look for nearby input elements
          const nearbyInputMatch = match[0].match(/<input[^>]*>/i);
          if (nearbyInputMatch) {
            const typeMatch = nearbyInputMatch[0].match(/type=["']([^"']+)["']/i);
            const placeholderMatch = nearbyInputMatch[0].match(/placeholder=["']([^"']+)["']/i);
            
            search.push({
              selector: `input[placeholder*="${pattern}"]`,
              type: typeMatch?.[1] as any || 'text',
              placeholder: placeholderMatch?.[1]
            });
          }
        }
      });
    }
  
    // Detect table elements
    // Detect table elements (Enhanced for React/Data Tables)
    private detectTableElements(html: string): TableElement[] {
      const tables: TableElement[] = [];
  
      // 1. Traditional HTML tables
      this.detectTraditionalTables(html, tables);
      
      // 2. React/Data table components
      this.detectReactTables(html, tables);
      
      // 3. Custom table patterns
      this.detectCustomTables(html, tables);

      return tables;
    }

    // Detect traditional HTML tables
    private detectTraditionalTables(html: string, tables: TableElement[]): void {
      const tableRegex = /<table[^>]*>[\s\S]*?<\/table>/gi;
      let match;
      while ((match = tableRegex.exec(html)) !== null) {
        const tableHtml = match[0];
        const columns = this.extractTableColumns(tableHtml);
        const rowCount = this.countTableRows(tableHtml);
        
        if (columns.length > 0) {
          tables.push({
            selector: 'table',
            columns,
            rowCount
          });
        }
      }
    }

// Detect React/Data table components
private detectReactTables(html: string, tables: TableElement[]): void {
  // Enhanced Material-UI Table components detection
  const muiTableRegex = /class=["'][^"']*MuiTable[^"']*["'][^>]*>/gi;
  let match;
  while ((match = muiTableRegex.exec(html)) !== null) {
    // Look for table headers
    const headerMatch = match[0].match(/aria-label=["']([^"']+)["']/i);
    if (headerMatch) {
      tables.push({
        selector: `[aria-label="${headerMatch[1]}"]`,
        columns: this.extractReactTableColumns(match[0]),
        rowCount: this.extractReactTableRowCount(match[0])
      });
    }
  }

  // Enhanced Material-UI CSS class detection
  const muiClassRegex = /class=["'][^"']*mui-[^"']*["'][^>]*>/gi;
  while ((match = muiClassRegex.exec(html)) !== null) {
    const classMatch = match[0].match(/class=["']([^"']+)["']/i);
    if (classMatch && classMatch[1].includes('mui-')) {
      const muiClasses = classMatch[1].split(' ').filter(cls => 
        cls.startsWith('mui-') && (
          cls.includes('table') || 
          cls.includes('grid') || 
          cls.includes('data')
        )
      );
      
      if (muiClasses.length > 0) {
        tables.push({
          selector: `.${muiClasses[0]}`,
          columns: this.extractReactTableColumns(match[0]),
          rowCount: this.extractReactTableRowCount(match[0])
        });
      }
    }
  }

  // Generic data table patterns
  const dataTableRegex = /class=["'][^"']*(?:table|grid|datatable)[^"']*["'][^>]*>/gi;
  while ((match = dataTableRegex.exec(html)) !== null) {
    const classMatch = match[0].match(/class=["']([^"']+)["']/i);
    if (classMatch) {
      const tableClass = classMatch[1].split(' ').find(cls => 
        cls.toLowerCase().includes('table') || 
        cls.toLowerCase().includes('grid') ||
        cls.toLowerCase().includes('datatable')
      );
      
      if (tableClass) {
        tables.push({
          selector: `.${tableClass}`,
          columns: this.extractReactTableColumns(match[0]),
          rowCount: this.extractReactTableRowCount(match[0])
        });
      }
    }
  }
}

    // Detect custom table patterns
    private detectCustomTables(html: string, tables: TableElement[]): void {
      // Look for table-like structures with headers
      const headerPatterns = [
        'Case ID',
        'Study Code',
        'Patient ID',
        'Name',
        'Date',
        'Status',
        'Type',
        'Category'
      ];

      headerPatterns.forEach(pattern => {
        const regex = new RegExp(`[^>]*${pattern}[^<]*`, 'gi');
        let match;
        while ((match = regex.exec(html)) !== null) {
          // Look for nearby table structure
          const tableContext = this.findTableContext(match[0], html);
          if (tableContext) {
            tables.push({
              selector: `.data-table-${pattern.toLowerCase().replace(/\s+/g, '-')}`,
              columns: [pattern],
              rowCount: this.countRowsInContext(tableContext)
            });
          }
        }
      });
    }

    // Extract columns from traditional HTML table
    private extractTableColumns(tableHtml: string): string[] {
      const columns: string[] = [];
      const headerRegex = /<th[^>]*>([^<]+)<\/th>/gi;
      let match;
      while ((match = headerRegex.exec(tableHtml)) !== null) {
        columns.push(match[1].trim());
      }
      return columns;
    }

    // Extract columns from React table
    private extractReactTableColumns(tableHtml: string): string[] {
      const columns: string[] = [];
      
      // Look for column headers in various formats
      const headerPatterns = [
        /aria-label=["']([^"']+)["']/gi,
        /data-column=["']([^"']+)["']/gi,
        />([A-Za-z\s]+)<\/th>/gi,
        />([A-Za-z\s]+)<\/td>/gi
      ];

      headerPatterns.forEach(pattern => {
        let match;
        while ((match = pattern.exec(tableHtml)) !== null) {
          const columnName = match[1].trim();
          if (columnName && !columns.includes(columnName)) {
            columns.push(columnName);
          }
        }
      });

      return columns;
    }

    // Count rows in traditional table
    private countTableRows(tableHtml: string): number {
      const rowRegex = /<tr[^>]*>/gi;
      const matches = tableHtml.match(rowRegex);
      return matches ? matches.length : 0;
    }

    // Extract row count from React table
    private extractReactTableRowCount(tableHtml: string): number {
      // Look for row count indicators
      const rowCountPatterns = [
        /(\d+)\s+of\s+(\d+)/gi,
        /(\d+)\s+rows/gi,
        /total[:\s]*(\d+)/gi
      ];

      for (const pattern of rowCountPatterns) {
        const match = pattern.exec(tableHtml);
        if (match) {
          return parseInt(match[1] || match[2]) || 0;
        }
      }

      return 0;
    }

    // Find table context around a match
    private findTableContext(match: string, html: string): string | null {
      const matchIndex = html.indexOf(match);
      const contextStart = Math.max(0, matchIndex - 1000);
      const contextEnd = Math.min(html.length, matchIndex + 1000);
      return html.substring(contextStart, contextEnd);
    }

    // Count rows in context
    private countRowsInContext(context: string): number {
      const rowPatterns = [
        /<tr[^>]*>/gi,
        /class=["'][^"']*row[^"']*["']/gi,
        /data-row/gi
      ];

      let maxRows = 0;
      rowPatterns.forEach(pattern => {
        const matches = context.match(pattern);
        if (matches && matches.length > maxRows) {
          maxRows = matches.length;
        }
      });

      return maxRows;
    }
  
    // Detect sortable elements
    private detectSortableElements(html: string): SortableElement[] {
      const sortable: SortableElement[] = [];
  
      // Table headers with sort indicators
      const sortHeaderRegex = /<th[^>]*class=["'][^"']*sort[^"']*["'][^>]*>(.*?)<\/th>/gi;
      let match;
      while ((match = sortHeaderRegex.exec(html)) !== null) {
        sortable.push({
          selector: 'th.sortable',
          type: 'header',
          sortableFields: [match[1].trim()]
        });
      }
  
      return sortable;
    }
  
    // Detect pagination elements
    private detectPaginationElements(html: string): PaginationElement[] {
      const pagination: PaginationElement[] = [];
  
      // Pagination controls
      if (html.includes('pagination') || html.includes('page')) {
        pagination.push({
          selector: '.pagination',
          type: 'pagination'
        });
      }
  
      // Load more buttons
      if (html.includes('load more') || html.includes('load-more')) {
        pagination.push({
          selector: '.load-more',
          type: 'load_more'
        });
      }
  
return pagination;
}

// Detect button elements
private detectButtonElements(html: string): ButtonElement[] {
  const buttons: ButtonElement[] = [];
  
  console.log('🔍 DEBUG - Starting button detection...');
  console.log('🔍 DEBUG - HTML length:', html.length);
  console.log('🔍 DEBUG - HTML contains MuiButton:', html.includes('MuiButton'));
  console.log('🔍 DEBUG - HTML contains mui-:', html.includes('mui-'));
  console.log('🔍 DEBUG - HTML contains button:', html.includes('<button'));
  
  // 1. Traditional HTML buttons
  this.detectTraditionalButtons(html, buttons);
  
  // 2. React/Material-UI buttons
  this.detectReactButtons(html, buttons);
  
  // 3. Custom button patterns
  this.detectCustomButtons(html, buttons);
  
  console.log('🔍 DEBUG - Total buttons detected:', buttons.length);
  console.log('🔍 DEBUG - Buttons:', buttons);
  
  return buttons;
}

private detectTraditionalButtons(html: string, buttons: ButtonElement[]): void {
  // Standard HTML button elements
  const buttonRegex = /<button[^>]*>/gi;
  let match;
  while ((match = buttonRegex.exec(html)) !== null) {
    const textMatch = match[0].match(/>([^<]+)</);
    const typeMatch = match[0].match(/type=["']([^"']+)["']/);
    const classMatch = match[0].match(/class=["']([^"']+)["']/);
    
    buttons.push({
      selector: classMatch ? `.${classMatch[1].split(' ')[0]}` : 'button',
      type: (typeMatch ? typeMatch[1] : 'button') as 'button' | 'submit',
      text: textMatch ? textMatch[1].trim() : undefined
    });
  }
  
  // Input buttons
  const inputButtonRegex = /<input[^>]*type=["'](?:button|submit)["'][^>]*>/gi;
  while ((match = inputButtonRegex.exec(html)) !== null) {
    const valueMatch = match[0].match(/value=["']([^"']+)["']/);
    const classMatch = match[0].match(/class=["']([^"']+)["']/);
    
    buttons.push({
      selector: classMatch ? `.${classMatch[1].split(' ')[0]}` : 'input[type="button"]',
      type: 'button',
      text: valueMatch ? valueMatch[1] : undefined
    });
  }
}

private detectReactButtons(html: string, buttons: ButtonElement[]): void {
  console.log('🔍 DEBUG - detectReactButtons called');
  
  // Material-UI Button components
  const muiButtonRegex = /class=["'][^"']*MuiButton[^"']*["'][^>]*>/gi;
  let match;
  let muiButtonCount = 0;
  while ((match = muiButtonRegex.exec(html)) !== null) {
    muiButtonCount++;
    const textMatch = match[0].match(/>([^<]+)</);
    const ariaMatch = match[0].match(/aria-label=["']([^"']+)["']/);
    
    buttons.push({
      selector: '.MuiButton-root',
      type: 'button',
      text: textMatch ? textMatch[1].trim() : undefined,
      ariaLabel: ariaMatch ? ariaMatch[1] : undefined
    });
  }
  console.log('🔍 DEBUG - MuiButton matches found:', muiButtonCount);
  
  // Material-UI IconButton components
  const muiIconButtonRegex = /class=["'][^"']*MuiIconButton[^"']*["'][^>]*>/gi;
  while ((match = muiIconButtonRegex.exec(html)) !== null) {
    const ariaMatch = match[0].match(/aria-label=["']([^"']+)["']/);
    
    buttons.push({
      selector: '.MuiIconButton-root',
      type: 'icon',
      ariaLabel: ariaMatch ? ariaMatch[1] : undefined
    });
  }
  
  // Generic button-like elements with click handlers
  const clickableRegex = /(?:onclick|onClick|role=["']button["'])[^>]*>/gi;
  while ((match = clickableRegex.exec(html)) !== null) {
    const classMatch = match[0].match(/class=["']([^"']+)["']/);
    if (classMatch) {
      buttons.push({
        selector: `.${classMatch[1].split(' ')[0]}`,
        type: 'button'
      });
    }
  }
  
  // Enhanced Material-UI detection with CSS class patterns
  const muiClassRegex = /class=["'][^"']*mui-[^"']*["'][^>]*>/gi;
  let muiClassCount = 0;
  while ((match = muiClassRegex.exec(html)) !== null) {
    muiClassCount++;
    const classMatch = match[0].match(/class=["']([^"']+)["']/);
    if (classMatch && classMatch[1].includes('mui-')) {
      const muiClasses = classMatch[1].split(' ').filter(cls => cls.startsWith('mui-'));
      if (muiClasses.length > 0) {
        buttons.push({
          selector: `.${muiClasses[0]}`,
          type: 'button'
        });
      }
    }
  }
  console.log('🔍 DEBUG - MUI class elements found:', muiClassCount);
  
  // Enhanced detection for Material-UI CSS-in-JS patterns
  const muiJssRegex = /class=["'][^"']*mui-jss-[^"']*["'][^>]*>/gi;
  let muiJssCount = 0;
  while ((match = muiJssRegex.exec(html)) !== null) {
    muiJssCount++;
    const classMatch = match[0].match(/class=["']([^"']+)["']/);
    if (classMatch && classMatch[1].includes('mui-jss-')) {
      const muiJssClasses = classMatch[1].split(' ').filter(cls => cls.startsWith('mui-jss-'));
      if (muiJssClasses.length > 0) {
        buttons.push({
          selector: `.${muiJssClasses[0]}`,
          type: 'button'
        });
      }
    }
  }
  console.log('🔍 DEBUG - MUI JSS elements found:', muiJssCount);
}

private detectCustomButtons(html: string, buttons: ButtonElement[]): void {
  // Custom button patterns
  const customPatterns = [
    { pattern: /class=["'][^"']*btn[^"']*["'][^>]*>/gi, selector: '.btn' },
    { pattern: /class=["'][^"']*button[^"']*["'][^>]*>/gi, selector: '.button' },
    { pattern: /class=["'][^"']*action[^"']*["'][^>]*>/gi, selector: '.action' },
    { pattern: /class=["'][^"']*clickable[^"']*["'][^>]*>/gi, selector: '.clickable' }
  ];
  
  customPatterns.forEach(({ pattern, selector }) => {
    let match;
    while ((match = pattern.exec(html)) !== null) {
      const textMatch = match[0].match(/>([^<]+)</);
      buttons.push({
        selector,
        type: 'button',
        text: textMatch ? textMatch[1].trim() : undefined
      });
    }
  });
}

// Detect form elements
private detectFormElements(html: string): FormElement[] {
  const forms: FormElement[] = [];
  
  // Traditional HTML forms
  const formRegex = /<form[^>]*>/gi;
  let match;
  while ((match = formRegex.exec(html)) !== null) {
    const classMatch = match[0].match(/class=["']([^"']+)["']/);
    const formSelector = classMatch ? `.${classMatch[1].split(' ')[0]}` : 'form';
    
    // Find inputs within this form
    const inputs: string[] = [];
    const inputRegex = /<input[^>]*>/gi;
    let inputMatch;
    while ((inputMatch = inputRegex.exec(html)) !== null) {
      const inputClassMatch = inputMatch[0].match(/class=["']([^"']+)["']/);
      if (inputClassMatch) {
        inputs.push(`.${inputClassMatch[1].split(' ')[0]}`);
      }
    }
    
    forms.push({
      selector: formSelector,
      inputs,
      submitButton: 'input[type="submit"], button[type="submit"]'
    });
  }
  
  // React/Material-UI forms
  const muiFormRegex = /class=["'][^"']*MuiForm[^"']*["'][^>]*>/gi;
  while ((match = muiFormRegex.exec(html)) !== null) {
    forms.push({
      selector: '.MuiForm-root',
      inputs: ['.MuiTextField-root', '.MuiInputBase-root'],
      submitButton: '.MuiButton-root[type="submit"]'
    });
  }
  
  return forms;
}
  
    // Helper: Detect date format
    private detectDateFormat(dateString: string): string {
      if (/^\d{4}-\d{2}-\d{2}$/.test(dateString)) return 'YYYY-MM-DD';
      if (/^\d{2}\/\d{2}\/\d{4}$/.test(dateString)) return 'MM/DD/YYYY';
      if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(dateString)) return 'ISO';
      return 'unknown';
    }

    // 🔧 ADD: Relationship Detection Methods
    
    // Detect foreign key relationships
    private detectForeignKeyRelationships(data: any[], fields: string[]): string[] {
      const relationships: string[] = [];
      
      // Look for ID patterns (patient_id, study_id, user_id, etc.)
      const idFields = fields.filter(field => 
        field.toLowerCase().includes('_id') || 
        field.toLowerCase().endsWith('id')
      );
      
      // Look for reference patterns (patient_ref, study_ref, etc.)
      const refFields = fields.filter(field => 
        field.toLowerCase().includes('_ref') || 
        field.toLowerCase().endsWith('ref')
      );
      
      // Create foreign key relationships
      idFields.forEach(idField => {
        const baseField = idField.replace(/_id$|id$/i, '');
        const relatedFields = fields.filter(field => 
          field !== idField && 
          (field.toLowerCase().includes(baseField) || 
           field.toLowerCase().startsWith(baseField + '_'))
        );
        
        relatedFields.forEach(relatedField => {
          relationships.push(`${idField} -> ${relatedField} (foreign_key)`);
        });
      });
      
      return relationships;
    }
    
    // Detect hierarchical relationships
    private detectHierarchicalRelationships(data: any[], fields: string[]): string[] {
      const relationships: string[] = [];
      
      // Look for category/subcategory patterns
      const categoryFields = fields.filter(field => 
        field.toLowerCase().includes('category') ||
        field.toLowerCase().includes('type') ||
        field.toLowerCase().includes('class')
      );
      
      const subcategoryFields = fields.filter(field => 
        field.toLowerCase().includes('sub') ||
        field.toLowerCase().includes('subcategory') ||
        field.toLowerCase().includes('subtype')
      );
      
      // Create hierarchical relationships
      categoryFields.forEach(categoryField => {
        subcategoryFields.forEach(subField => {
          relationships.push(`${categoryField} -> ${subField} (hierarchy)`);
        });
      });
      
      return relationships;
    }
    
    // Detect dependency relationships
    private detectDependencyRelationships(data: any[], fields: string[]): string[] {
      const relationships: string[] = [];
      
      // Look for status/state dependencies
      const statusFields = fields.filter(field => 
        field.toLowerCase().includes('status') ||
        field.toLowerCase().includes('state') ||
        field.toLowerCase().includes('phase')
      );
      
      const dependentFields = fields.filter(field => 
        !field.toLowerCase().includes('status') &&
        !field.toLowerCase().includes('state') &&
        !field.toLowerCase().includes('phase')
      );
      
      // Create dependency relationships
      statusFields.forEach(statusField => {
        dependentFields.forEach(depField => {
          relationships.push(`${statusField} -> ${depField} (dependency)`);
        });
      });
      
      return relationships;
    }
    
    // Detect business rules from data patterns
    private detectBusinessRules(data: any[], fields: string[]): string[] {
      const businessRules: string[] = [];
      
      // Rule: Required fields (non-null fields)
      fields.forEach(field => {
        const nonNullCount = data.filter(record => 
          record[field] !== null && record[field] !== undefined && record[field] !== ''
        ).length;
        
        if (nonNullCount === data.length) {
          businessRules.push(`${field} is required (non-null)`);
        }
      });
      
      // Rule: Unique constraints (identifier fields)
      fields.forEach(field => {
        const uniqueValues = new Set(data.map(record => record[field]));
        if (uniqueValues.size === data.length) {
          businessRules.push(`${field} must be unique`);
        }
      });
      
      // Rule: Range constraints (numerical fields)
      fields.forEach(field => {
        const values = data.map(record => parseFloat(record[field])).filter(v => !isNaN(v));
        if (values.length > 0) {
          const min = Math.min(...values);
          const max = Math.max(...values);
          if (min >= 0 && max <= 100) {
            businessRules.push(`${field} must be between 0 and 100`);
          } else if (min >= 0) {
            businessRules.push(`${field} must be non-negative`);
          }
        }
      });
      
      return businessRules;
    }
    
    // Apply relationship detection to all field types
    private applyRelationshipDetection(data: any[], fields: string[], fieldObjects: any[]): any[] {
      const relationships = [
        ...this.detectForeignKeyRelationships(data, fields),
        ...this.detectHierarchicalRelationships(data, fields),
        ...this.detectDependencyRelationships(data, fields)
      ];
      
      const businessRules = this.detectBusinessRules(data, fields);
      
      return fieldObjects.map(field => ({
        ...field,
        relationships: relationships.filter(rel => 
          rel.includes(field.name) || rel.includes(`-> ${field.name}`)
        ),
        businessRules: businessRules.filter(rule => 
          rule.includes(field.name)
        )
      }));
    }
  }