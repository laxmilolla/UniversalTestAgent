class ChatbotUI {
    constructor() {
        this.socket = io();
        this.messageInput = document.getElementById('messageInput');
        this.sendButton = document.getElementById('sendButton');
        this.clearButton = document.getElementById('clearButton');
        this.toolsButton = document.getElementById('toolsButton');
        this.chatMessages = document.getElementById('chatMessages');
        this.toolsModal = document.getElementById('toolsModal');
        this.toolsList = document.getElementById('toolsList');
        
        this.setupEventListeners();
        this.setupSocketListeners();
    }

    setupEventListeners() {
        this.sendButton.addEventListener('click', () => this.sendMessage());
        this.messageInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') this.sendMessage();
        });
        
        this.clearButton.addEventListener('click', () => this.clearHistory());
        this.toolsButton.addEventListener('click', () => this.showTools());
        
        // Modal close
        document.querySelector('.close').addEventListener('click', () => {
            this.toolsModal.style.display = 'none';
        });
        
        window.addEventListener('click', (e) => {
            if (e.target === this.toolsModal) {
                this.toolsModal.style.display = 'none';
            }
        });
    }

    setupSocketListeners() {
        this.socket.on('response', (data) => {
            this.displayMessage(data.message);
            this.sendButton.disabled = false;
            this.sendButton.textContent = 'Send';
        });

        this.socket.on('error', (data) => {
            this.displayError(data.message);
            this.sendButton.disabled = false;
            this.sendButton.textContent = 'Send';
        });

        this.socket.on('history', (history) => {
            this.displayHistory(history);
        });

        this.socket.on('history-cleared', () => {
            this.chatMessages.innerHTML = '';
            this.addSystemMessage('History cleared. How can I help you?');
        });
    }

    sendMessage() {
        const message = this.messageInput.value.trim();
        if (!message) return;

        this.displayMessage({
            role: 'user',
            content: message,
            timestamp: new Date()
        });

        this.messageInput.value = '';
        this.sendButton.disabled = true;
        this.sendButton.innerHTML = '<div class="loading"></div>';

        this.socket.emit('message', { message });
    }

    displayMessage(message) {
        const messageDiv = document.createElement('div');
        messageDiv.className = `message ${message.role}`;
        
        const contentDiv = document.createElement('div');
        contentDiv.className = 'message-content';
        
        // Display tool calls if present
        if (message.toolCalls && message.toolCalls.length > 0) {
            const toolCallsHtml = message.toolCalls.map(tool => 
                `<div class="tool-call">
                    <strong>🔧 ${tool.name}</strong><br>
                    <small>${JSON.stringify(tool.parameters, null, 2)}</small>
                </div>`
            ).join('');
            contentDiv.innerHTML = `<p>${message.content}</p>${toolCallsHtml}`;
        } else {
            contentDiv.innerHTML = `<p>${this.formatMessage(message.content)}</p>`;
        }
        
        // Display tool results if present
        if (message.toolResults && message.toolResults.length > 0) {
            const toolResultsHtml = message.toolResults.map(result => {
                let resultHtml = `<div class="tool-result">
                    <strong>${result.success ? '✅' : '❌'} Tool Result</strong><br>`;
                
                // Check if result contains S3 URL or screenshot info
                if (result.result && Array.isArray(result.result)) {
                    result.result.forEach(item => {
                        if (item.type === 'text') {
                            // Check if text contains screenshot or file info
                            if (item.text.includes('Screenshot saved to:') || item.text.includes('screenshot')) {
                                const filePath = this.extractFilePath(item.text);
                                if (filePath) {
                                    resultHtml += `<div class="s3-upload-section">
                                        <button class="s3-upload-btn" onclick="uploadToS3('${filePath}')">
                                            📤 Upload to S3
                                        </button>
                                        <div class="s3-url" id="s3-url-${Date.now()}" style="display: none;"></div>
                                    </div>`;
                                }
                            }
                            resultHtml += `<pre>${item.text}</pre>`;
                        }
                    });
                } else {
                    resultHtml += `<pre>${JSON.stringify(result.result, null, 2)}</pre>`;
                }
                
                resultHtml += `</div>`;
                return resultHtml;
            }).join('');
            contentDiv.innerHTML += toolResultsHtml;
        }
        
        messageDiv.appendChild(contentDiv);
        this.chatMessages.appendChild(messageDiv);
        this.scrollToBottom();
    }

    extractFilePath(text) {
        // Extract file path from text like "Screenshot saved to: ../Downloads/current_page-2025-09-16T15-04-26-331Z.png"
        const match = text.match(/Screenshot saved to:\s*(.+)/);
        return match ? match[1] : null;
    }

    displayError(message) {
        const messageDiv = document.createElement('div');
        messageDiv.className = 'message assistant';
        
        const contentDiv = document.createElement('div');
        contentDiv.className = 'message-content';
        contentDiv.innerHTML = `<p style="color: #dc3545;">❌ ${message}</p>`;
        
        messageDiv.appendChild(contentDiv);
        this.chatMessages.appendChild(messageDiv);
        this.scrollToBottom();
    }

    addSystemMessage(content) {
        const messageDiv = document.createElement('div');
        messageDiv.className = 'message system';
        
        const contentDiv = document.createElement('div');
        contentDiv.className = 'message-content';
        contentDiv.innerHTML = `<p>${content}</p>`;
        
        messageDiv.appendChild(contentDiv);
        this.chatMessages.appendChild(messageDiv);
        this.scrollToBottom();
    }

    displayHistory(history) {
        this.chatMessages.innerHTML = '';
        history.forEach(message => this.displayMessage(message));
    }

    clearHistory() {
        this.socket.emit('clear-history');
    }

    async showTools() {
        try {
            const response = await fetch('/api/tools');
            const data = await response.json();
            
            this.toolsList.innerHTML = data.tools.map(tool => 
                `<div class="tool-item">
                    <div class="tool-name">${tool.name}</div>
                    <div class="tool-description">${tool.description}</div>
                </div>`
            ).join('');
            
            this.toolsModal.style.display = 'block';
        } catch (error) {
            console.error('Failed to load tools:', error);
        }
    }

    formatMessage(content) {
        // Simple formatting for better readability
        return content
            .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
            .replace(/\*(.*?)\*/g, '<em>$1</em>')
            .replace(/\n/g, '<br>');
    }

    scrollToBottom() {
        this.chatMessages.scrollTop = this.chatMessages.scrollHeight;
    }
}

// Global function for S3 upload
async function uploadToS3(filePath) {
    try {
        const button = event.target;
        const originalText = button.textContent;
        button.textContent = '⏳ Uploading...';
        button.disabled = true;

        const response = await fetch('/api/upload-screenshot', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ filePath })
        });

        const result = await response.json();

        if (result.success) {
            button.textContent = '✅ Uploaded!';
            button.style.backgroundColor = '#28a745';
            
            // Show S3 URL
            const urlDiv = button.nextElementSibling;
            urlDiv.innerHTML = `
                <div class="s3-url-content">
                    <strong>🌐 S3 URL:</strong><br>
                    <a href="${result.url}" target="_blank" class="s3-link">${result.url}</a>
                    <button onclick="copyToClipboard('${result.url}')" class="copy-btn">📋 Copy</button>
                </div>
            `;
            urlDiv.style.display = 'block';
        } else {
            button.textContent = '❌ Failed';
            button.style.backgroundColor = '#dc3545';
            console.error('Upload failed:', result.error);
        }
    } catch (error) {
        console.error('Upload error:', error);
        event.target.textContent = '❌ Error';
        event.target.style.backgroundColor = '#dc3545';
    }
}

// Global function to copy to clipboard
async function copyToClipboard(text) {
    try {
        await navigator.clipboard.writeText(text);
        event.target.textContent = '✅ Copied!';
        setTimeout(() => {
            event.target.textContent = '📋 Copy';
        }, 2000);
    } catch (error) {
        console.error('Failed to copy:', error);
    }
}

// Initialize the chatbot UI when the page loads
document.addEventListener('DOMContentLoaded', () => {
    new ChatbotUI();
});
// ... existing code ...

// ========================================
// UNIVERSAL WEB TESTING AGENT - LEARNING PHASE FUNCTIONALITY
// ========================================

class LearningPhaseUI {
    constructor() {
        this.uploadedFiles = {
            tsv: [],
            screenshot: [],
            schema: []
        };
        this.learningInProgress = false;
        
        // Wait for DOM to be ready
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', () => {
                this.initializeElements();
                this.setupEventListeners();
            });
        } else {
            this.initializeElements();
            this.setupEventListeners();
        }
    }

    initializeElements() {
        // Phase navigation
        this.tabButtons = document.querySelectorAll('.tab-btn');
        this.phaseContents = document.querySelectorAll('.phase-content');
        
        // File uploads - Add null checks
        this.tsvInput = document.getElementById('tsv-files');
        this.screenshotInput = document.getElementById('screenshot-files');
        this.schemaInput = document.getElementById('schema-files');
        
        // Previews - Add null checks
        this.tsvPreview = document.getElementById('tsv-preview');
        this.screenshotPreview = document.getElementById('screenshot-preview');
        this.schemaPreview = document.getElementById('schema-preview');
        
        // Learning controls - Add null checks
        this.learnBtn = document.getElementById('learn-system-btn');
        this.learningStatus = document.getElementById('learning-status');
        this.learningResults = document.getElementById('learning-results');
        
        // Results display - Add null checks
        this.uiElementsCount = document.getElementById('ui-elements-count');
        this.dbFieldsCount = document.getElementById('db-fields-count');
        this.testCasesCount = document.getElementById('test-cases-count');
        this.relationshipsCount = document.getElementById('relationships-count');
        
        // Check if all required elements exist
        if (!this.tsvInput || !this.screenshotInput || !this.schemaInput) {
            console.warn('Some file input elements not found');
        }
        if (!this.learnBtn || !this.learningStatus || !this.learningResults) {
            console.warn('Some learning control elements not found');
        }
    }

    setupEventListeners() {
        // Phase tab switching
        this.tabButtons.forEach(btn => {
            btn.addEventListener('click', (e) => this.switchPhase(e.target.dataset.phase));
        });

        // File upload handling - Add null checks
        if (this.tsvInput) {
            this.tsvInput.addEventListener('change', (e) => this.handleFileUpload(e, 'tsv'));
        }
        if (this.screenshotInput) {
            this.screenshotInput.addEventListener('change', (e) => this.handleFileUpload(e, 'screenshot'));
        }
        if (this.schemaInput) {
            this.schemaInput.addEventListener('change', (e) => this.handleFileUpload(e, 'schema'));
        }

        // Learning process - Add null check
        if (this.learnBtn) {
            this.learnBtn.addEventListener('click', () => this.startLearningProcess());
        }
    }

    switchPhase(phase) {
        // Update tab buttons
        this.tabButtons.forEach(btn => {
            btn.classList.toggle('active', btn.dataset.phase === phase);
        });

        // Update phase content
        this.phaseContents.forEach(content => {
            content.classList.toggle('active', content.id === `${phase}-phase`);
        });
    }

    async handleFileUpload(event, fileType) {
        const files = Array.from(event.target.files);
        
        for (const file of files) {
            try {
                // Upload file to backend API
                const formData = new FormData();
                formData.append(fileType, file);
                
                const response = await fetch(`/api/learn/upload/${fileType}`, {
                    method: 'POST',
                    body: formData
                });
                
                const result = await response.json();
                
                if (result.success) {
                    const fileObj = {
                        name: file.name,
                        size: this.formatFileSize(file.size),
                        file: file,
                        uploaded: true,
                        serverResponse: result
                    };
                    
                    this.uploadedFiles[fileType].push(fileObj);
                    console.log(`✅ ${file.name} uploaded successfully`);
                } else {
                    console.error(`❌ Failed to upload ${file.name}:`, result.error);
                    // Still add to local preview but mark as failed
                    const fileObj = {
                        name: file.name,
                        size: this.formatFileSize(file.size),
                        file: file,
                        uploaded: false,
                        error: result.error
                    };
                    this.uploadedFiles[fileType].push(fileObj);
                }
            } catch (error) {
                console.error(`❌ Error uploading ${file.name}:`, error);
                // Add to local preview but mark as failed
                const fileObj = {
                    name: file.name,
                    size: this.formatFileSize(file.size),
                    file: file,
                    uploaded: false,
                    error: 'Upload failed'
                };
                this.uploadedFiles[fileType].push(fileObj);
            }
        }

        this.updateFilePreview(fileType);
        this.updateLearnButton();
    }

    updateFilePreview(fileType) {
        const preview = document.getElementById(`${fileType}-preview`);
        const files = this.uploadedFiles[fileType];
        
        // Add null check
        if (!preview) {
            console.warn(`Preview element not found: ${fileType}-preview`);
            return;
        }
        
        if (files.length === 0) {
            preview.innerHTML = '';
            return;
        }

        preview.innerHTML = files.map((file, index) => `
            <div class="file-preview-item ${file.uploaded ? 'uploaded' : 'failed'}">
                <div>
                    <div class="file-name">${file.name}</div>
                    <div class="file-size">${file.size}</div>
                    <div class="upload-status">
                        ${file.uploaded ? '✅ Uploaded to server' : '❌ Failed: ' + (file.error || 'Unknown error')}
                    </div>
                </div>
                <button class="remove-file" onclick="learningUI.removeFile('${fileType}', ${index})">
                    ✕
                </button>
            </div>
        `).join('');
    }

    removeFile(fileType, index) {
        this.uploadedFiles[fileType].splice(index, 1);
        this.updateFilePreview(fileType);
        this.updateLearnButton();
    }

    updateLearnButton() {
        // Only require TSV and screenshot files, make schema optional
        const hasRequiredFiles = this.uploadedFiles.tsv.length > 0 || this.uploadedFiles.screenshot.length > 0;
        this.learnBtn.disabled = !hasRequiredFiles || this.learningInProgress;
    }

    showLearningResults(results, analysis = null) {
        // Use real results from backend
        console.log('🔍 DEBUG - showLearningResults called with:', { results, analysis });
        console.log('🔍 DEBUG - Test cases count:', results.testCases);
        
        this.uiElementsCount.textContent = results.uiElements || 0;
        this.dbFieldsCount.textContent = results.dbFields || 0;
        this.testCasesCount.textContent = results.testCases || 0;
        this.relationshipsCount.textContent = results.relationships || 0;

        // Store learning results globally for Phase 2
        window.learningResults = {
            success: true,
            results: results,
            analysis: analysis
        };
        
        console.log('Learning results stored globally:', window.learningResults);

        // Show detailed analysis if available
        if (analysis) {
            this.showDetailedAnalysis(analysis);
        }

        this.learningResults.style.display = 'block';
    }

    showDetailedAnalysis(analysis) {
        // Add null checks for all analysis properties
        if (!analysis) {
            console.warn('No analysis data provided');
            return;
        }

        // Safely access nested properties with fallbacks
        const dbAnalysis = analysis.database || {};
        const uiAnalysis = analysis.ui || {};
        const mappingAnalysis = analysis.mapping || {};
        
        // Debug logging to see what we're actually getting
        console.log('🔍 DEBUG - showDetailedAnalysis called with:', analysis);
        console.log('🔍 DEBUG - mappingAnalysis:', mappingAnalysis);
        console.log('🔍 DEBUG - mappingAnalysis.mappings:', mappingAnalysis.mappings);
        console.log('🔍 DEBUG - mappingAnalysis.testCases:', mappingAnalysis.testCases);
        console.log('🔍 DEBUG - mappingAnalysis.dataRelationships:', mappingAnalysis.dataRelationships);

        // Create detailed analysis section
        const detailedSection = document.createElement('div');
        detailedSection.className = 'detailed-analysis';
        detailedSection.innerHTML = `
            <h3> Detailed Analysis</h3>
            
            <div class="analysis-tabs">
                <button class="analysis-tab active" data-tab="database">Database Analysis</button>
                <button class="analysis-tab" data-tab="ui">UI Analysis</button>
                <button class="analysis-tab" data-tab="mapping">Mapping Analysis</button>
            </div>
            
            <div class="analysis-content">
                <div class="analysis-panel active" id="database-panel">
                    <h4>📊 Database Fields (${dbAnalysis.totalFields || 0})</h4>
                    <div class="field-list">
                        ${(dbAnalysis.fieldNames || []).map(field => `<span class="field-tag">${field}</span>`).join('')}
                    </div>
                    
                    <h4>🔗 Relationships</h4>
                    <ul>
                        ${(dbAnalysis.relationships || []).map(rel => `<li>${rel}</li>`).join('')}
                    </ul>
                    
                    <h4>📋 Business Rules</h4>
                    <ul>
                        ${(dbAnalysis.businessRules || []).map(rule => `<li>${rule}</li>`).join('')}
                    </ul>
                </div>
                
                <div class="analysis-panel" id="ui-panel">
                    <h4>🖱️ Interactive Elements (${(uiAnalysis.interactiveElements || []).length})</h4>
                    <div class="element-list">
                        ${(uiAnalysis.interactiveElements || []).map(element => `<span class="element-tag">${this.getElementDisplayText(element)}</span>`).join('')}
                    </div>
                    
                    <h4>📊 Data Components (${(uiAnalysis.dataComponents || []).length})</h4>
                    <div class="element-list">
                        ${(uiAnalysis.dataComponents || []).map(component => `<span class="element-tag">${this.getElementDisplayText(component)}</span>`).join('')}
                    </div>
                    
                    <h4>🧭 Navigation Elements (${(uiAnalysis.navigationElements || []).length})</h4>
                    <div class="element-list">
                        ${(uiAnalysis.navigationElements || []).map(nav => `<span class="element-tag">${this.getElementDisplayText(nav)}</span>`).join('')}
                    </div>
                </div>
                
                <div class="analysis-panel" id="mapping-panel">
                    <h4>🔗 Field Mappings (${(mappingAnalysis.mappings || []).length})</h4>
                    <div class="mapping-list">
                        ${(mappingAnalysis.mappings || []).map(mapping => `
                            <div class="mapping-item">
                                <span class="db-field">${mapping.dbField || 'Unknown'}</span>
                                <span class="arrow">→</span>
                                <span class="ui-element">${mapping.uiElement || 'Unknown'}</span>
                                <span class="mapping-type">${mapping.type || 'Unknown'}</span>
                                <span class="confidence">(${mapping.confidence || 'N/A'})</span>
                            </div>
                        `).join('')}
                    </div>
                    
                    <h4>🧪 Test Cases (${(mappingAnalysis.testCases || []).length})</h4>
                    <div class="test-cases">
                        ${(mappingAnalysis.testCases || []).map((testCase, index) => `
                            <div class="test-case">
                                <h5>Test Case ${index + 1}: ${testCase.name || 'Unnamed'}</h5>
                                <p><strong>Description:</strong> ${testCase.description || 'No description'}</p>
                                <p><strong>Category:</strong> ${testCase.category || 'Unknown'}</p>
                                <p><strong>Priority:</strong> ${testCase.priority || 'Unknown'}</p>
                                <p><strong>Type:</strong> ${testCase.type || 'Unknown'}</p>
                                <h6>Steps:</h6>
                                <ol>
                                    ${typeof testCase.steps === 'string' 
                                        ? (testCase.steps.includes(',') 
                                            ? testCase.steps.split(',').map(step => `<li>${step.trim()}</li>`).join('')
                                            : `<li>${testCase.steps}</li>`)
                                        : (Array.isArray(testCase.steps) 
                                            ? testCase.steps.map(step => `<li>${step}</li>`).join('')
                                            : `<li>${testCase.steps || 'No steps provided'}</li>`)}
                                </ol>
                                <p><strong>Selectors:</strong> ${testCase.selectors || 'None'}</p>
                            </div>
                        `).join('')}
                    </div>
                    
                    <h4>📋 Validation Rules (${(mappingAnalysis.validationRules || []).length})</h4>
                    <div class="validation-rules">
                        ${(mappingAnalysis.validationRules || []).map(rule => `
                            <div class="validation-rule">${rule}</div>
                        `).join('')}
                    </div>
                    
                    <h4>🔗 Data Relationships (${(mappingAnalysis.dataRelationships || []).length})</h4>
                    <div class="relationships">
                        ${(mappingAnalysis.dataRelationships || []).map(rel => `
                            <div class="relationship">${rel}</div>
                        `).join('')}
                    </div>
                </div>
            </div>
        `;

        // Add to results section
        this.learningResults.appendChild(detailedSection);
        
        // Add tab switching functionality
        this.setupAnalysisTabs();
    }

    setupAnalysisTabs() {
        // Use setTimeout to ensure DOM elements are rendered
        setTimeout(() => {
            const tabs = document.querySelectorAll('.analysis-tab');
            const panels = document.querySelectorAll('.analysis-panel');
            
            console.log('Setting up analysis tabs:', tabs.length, 'tabs found');
            
            tabs.forEach(tab => {
                tab.addEventListener('click', (e) => {
                    e.preventDefault();
                    console.log('Tab clicked:', tab.dataset.tab);
                    
                    // Remove active class from all tabs and panels
                    tabs.forEach(t => t.classList.remove('active'));
                    panels.forEach(p => p.classList.remove('active'));
                    
                    // Add active class to clicked tab and corresponding panel
                    tab.classList.add('active');
                    const panelId = tab.dataset.tab + '-panel';
                    const targetPanel = document.getElementById(panelId);
                    
                    if (targetPanel) {
                        targetPanel.classList.add('active');
                        console.log('Switched to panel:', panelId);
                    } else {
                        console.error('Panel not found:', panelId);
                    }
                });
            });
        }, 100);
    }

    async startLearningProcess() {
        if (this.learningInProgress) return;

        // Get website URL
        const websiteUrlInput = document.getElementById('website-url');
        const websiteUrl = websiteUrlInput ? websiteUrlInput.value.trim() : '';
        
        if (!websiteUrl) {
            alert('Please enter a website URL to analyze');
            return;
        }

        this.learningInProgress = true;
        this.learnBtn.disabled = true;
        this.learnBtn.innerHTML = '<span class="btn-icon">⏳</span><span class="btn-text">Learning...</span>';
        
        this.learningStatus.style.display = 'block';
        this.learningResults.style.display = 'none';

        try {
            // Call the actual learning API with website URL
            const response = await fetch('/api/learn/start', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    tsvData: await this.getTSVContent(),  // ✅ This reads and sends actual content
                    websiteUrl: websiteUrl
                })
            });
            
            const result = await response.json();
            
            if (result.success) {
                // Show real results from backend with detailed analysis
                console.log('🔍 DEBUG - Learning API response:', result);
                console.log('🔍 DEBUG - Results object:', result.results);
                console.log('🔍 DEBUG - Test cases in results:', result.results.testCases);
                this.showLearningResults(result.results, result.analysis);
                console.log('✅ Learning process completed:', result);
                
                // Update Phase 2 button state
                if (window.testGenerationUI) {
                    window.testGenerationUI.updateGenerateButton();
                }
            } else {
                throw new Error(result.error || 'Learning process failed');
            }
            
        } catch (error) {
            console.error('❌ Learning process failed:', error);
            this.showLearningError(error.message);
        } finally {
            this.learningInProgress = false;
            this.learnBtn.disabled = false;
            this.learnBtn.innerHTML = '<span class="btn-icon">🧠</span><span class="btn-text">Learn The System</span>';
            this.learningStatus.style.display = 'none';
        }
    }

    async simulateLearningProcess() {
        // Simulate different phases of learning
        const phases = [
            { text: 'Analyzing uploaded files...', duration: 2000 },
            { text: 'Discovering UI elements...', duration: 3000 },
            { text: 'Mapping database fields...', duration: 2500 },
            { text: 'Generating test cases...', duration: 2000 },
            { text: 'Finding data relationships...', duration: 1500 }
        ];

        for (const phase of phases) {
            this.updateLearningStatus(phase.text);
            await this.delay(phase.duration);
        }
    }

    updateLearningStatus(text) {
        const statusText = this.learningStatus.querySelector('.status-text');
        if (statusText) {
            statusText.textContent = text;
        }
    }

    showLearningError(message) {
        const errorDiv = document.createElement('div');
        errorDiv.className = 'learning-error';
        errorDiv.innerHTML = `
            <div style="background: #f8d7da; color: #721c24; padding: 15px; border-radius: 8px; margin: 20px 0;">
                <strong>❌ Learning Failed:</strong> ${message}
            </div>
        `;
        
        this.learningResults.innerHTML = '';
        this.learningResults.appendChild(errorDiv);
        this.learningResults.style.display = 'block';
    }

    delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    formatFileSize(bytes) {
        if (bytes === 0) return '0 Bytes';
        const k = 1024;
        const sizes = ['Bytes', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    }

    async getTSVContent() {
        const tsvFiles = [];
        for (const fileObj of this.uploadedFiles.tsv) {
            if (fileObj.file) {
                const content = await this.readFileContent(fileObj.file);
                tsvFiles.push({
                    name: fileObj.name,
                    content: content
                });
            }
        }
        return tsvFiles;
    }

    readFileContent(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = (e) => resolve(e.target.result);
            reader.onerror = (e) => reject(e);
            reader.readAsText(file);
        });
    }

    getElementDisplayText(element) {
        // Extract readable text from element objects
        if (typeof element === 'string') {
            return element;
        }
        
        if (typeof element === 'object' && element !== null) {
            // Try different properties that might contain readable text
            return element.text || 
                   element.label || 
                   element.title || 
                   element.name || 
                   element.selector || 
                   element.type || 
                   element.purpose ||
                   element.ariaLabel ||
                   JSON.stringify(element);
        }
        
        return String(element);
    }
}

// Global reference for learning UI
let learningUI;

// ========================================
// UNIVERSAL WEB TESTING AGENT - PHASE 2: TEST GENERATION FUNCTIONALITY
// ========================================

class TestGenerationUI {
    constructor() {
        this.generatedTests = [];
        this.selectedTests = new Set();
        this.testExecutionInProgress = false;
        
        // Wait for DOM to be ready
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', () => {
                this.initializeElements();
                this.setupEventListeners();
            });
        } else {
            this.initializeElements();
            this.setupEventListeners();
        }
    }

    initializeElements() {
        // Test generation controls
        this.generateBtn = document.getElementById('generate-tests-btn');
        this.generationStatus = document.getElementById('generation-status');
        
        // Test configuration
        this.testPriority = document.getElementById('test-priority');
        this.testCount = document.getElementById('test-count');
        this.dataValidationCheck = document.getElementById('data-validation-tests');
        this.functionalityCheck = document.getElementById('functionality-tests');
        this.uiValidationCheck = document.getElementById('ui-validation-tests');
        this.performanceCheck = document.getElementById('performance-tests');
        
        // Test cases display
        this.testCasesSection = document.getElementById('test-cases-section');
        this.testCasesList = document.getElementById('test-cases-list');
        this.testSearch = document.getElementById('test-search');
        this.testCategoryFilter = document.getElementById('test-category-filter');
        this.testPriorityFilter = document.getElementById('test-priority-filter');
        
        // Test actions
        this.selectAllBtn = document.getElementById('select-all-tests');
        this.deselectAllBtn = document.getElementById('deselect-all-tests');
        this.executeSelectedBtn = document.getElementById('execute-selected-tests');
        this.exportTestsBtn = document.getElementById('export-tests');
        
        // Test results
        this.testResultsSection = document.getElementById('test-results-section');
        this.resultsSummary = document.getElementById('results-summary');
        this.detailedResults = document.getElementById('detailed-results');
        
        // Check if elements exist
        if (!this.generateBtn) {
            console.warn('Test generation elements not found - Phase 2 UI may not be loaded');
        }
    }

    setupEventListeners() {
        // Test generation
        if (this.generateBtn) {
            this.generateBtn.addEventListener('click', () => this.generateTestCases());
        }
        
        // Test configuration changes
        if (this.testPriority) {
            this.testPriority.addEventListener('change', () => this.updateGenerateButton());
        }
        if (this.testCount) {
            this.testCount.addEventListener('change', () => this.updateGenerateButton());
        }
        
        // Test filtering and search
        if (this.testSearch) {
            this.testSearch.addEventListener('input', () => this.filterTestCases());
        }
        if (this.testCategoryFilter) {
            this.testCategoryFilter.addEventListener('change', () => this.filterTestCases());
        }
        if (this.testPriorityFilter) {
            this.testPriorityFilter.addEventListener('change', () => this.filterTestCases());
        }
        
        // Test actions
        if (this.selectAllBtn) {
            this.selectAllBtn.addEventListener('click', () => this.selectAllTests());
        }
        if (this.deselectAllBtn) {
            this.deselectAllBtn.addEventListener('click', () => this.deselectAllTests());
        }
        if (this.executeSelectedBtn) {
            this.executeSelectedBtn.addEventListener('click', () => this.executeSelectedTests());
        }
        if (this.exportTestsBtn) {
            this.exportTestsBtn.addEventListener('click', () => this.exportTests());
        }
    }

    updateGenerateButton() {
        // Enable generate button if we have learning results
        const hasLearningResults = window.learningResults && window.learningResults.success;
        const hasExistingTestCases = hasLearningResults && 
            window.learningResults.analysis?.mapping?.testCases?.length > 0;
        
        console.log('Learning results available:', hasLearningResults, window.learningResults);
        console.log('Existing test cases available:', hasExistingTestCases);
        
        if (this.generateBtn) {
            this.generateBtn.disabled = !hasLearningResults;
            
            // Update button text based on whether test cases exist
            if (hasExistingTestCases) {
                this.generateBtn.innerHTML = '<span class="btn-icon">📋</span><span class="btn-text">Display Test Cases</span>';
            } else {
                this.generateBtn.innerHTML = '<span class="btn-icon">🧪</span><span class="btn-text">Generate Test Cases</span>';
            }
        }
    }

    async generateTestCases() {
        try {
            // Get learning results from Phase 1
            const learningResults = this.getLearningResults();
            
            if (!learningResults) {
                throw new Error('No learning results found. Please complete Phase 1 first.');
            }

            // Check if test cases already exist from Phase 1
            const existingTestCases = learningResults.analysis?.mapping?.testCases || [];
            
            if (existingTestCases.length > 0) {
                console.log(`🔄 Found ${existingTestCases.length} existing test cases from Phase 1`);
                
                // Update UI to show we're loading existing test cases
                this.generateBtn.disabled = true;
                this.generateBtn.innerHTML = '<span class="btn-icon">📋</span><span class="btn-text">Loading Test Cases...</span>';
                this.generationStatus.style.display = 'block';
                this.generationStatus.textContent = `Loading ${existingTestCases.length} existing test cases...`;

                // Convert Phase 1 test cases to Phase 2 format
                const convertedTestCases = this.convertPhase1TestCases(existingTestCases);
                
                // Store test cases globally for debugging
                window.testCases = convertedTestCases;
                
                // Call backend API to save test cases to storage
                try {
                    const response = await fetch('/api/test/generate', {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json'
                        },
                        body: JSON.stringify({
                            learningResults: learningResults,
                            testOptions: this.getTestOptions()
                        })
                    });

                    const result = await response.json();

                    if (result.success) {
                        this.generatedTests = result.testCases;
                        this.displayTestCases();
                        this.showTestCasesSection();
                        this.updateTestStatistics();
                        
                        console.log(`✅ Loaded and saved ${this.generatedTests.length} test cases from Phase 1`);
                        
                        // Update button text to reflect that test cases are now loaded
                        this.generateBtn.innerHTML = '<span class="btn-icon">✅</span><span class="btn-text">Test Cases Loaded</span>';
                        this.generationStatus.textContent = `Successfully loaded ${this.generatedTests.length} test cases from Phase 1`;
                    } else {
                        throw new Error(result.error || 'Failed to load test cases from Phase 1');
                    }
                } catch (error) {
                    console.error('❌ Failed to load test cases from Phase 1:', error);
                    this.showError(error.message);
                } finally {
                    this.generateBtn.disabled = false;
                    this.generateBtn.innerHTML = '<span class="btn-icon">✅</span><span class="btn-text">Test Cases Loaded</span>';
                    this.generationStatus.style.display = 'none';
                }
                
                return;
            }

            // If no existing test cases, generate new ones (fallback)
            console.log('🔄 No existing test cases found, generating new ones...');
            
            // Update UI
            this.generateBtn.disabled = true;
            this.generateBtn.innerHTML = '<span class="btn-icon">⏳</span><span class="btn-text">Generating...</span>';
            this.generationStatus.style.display = 'block';

            // Get test options
            const testOptions = this.getTestOptions();

            // Call backend to generate test cases
            const response = await fetch('/api/test/generate', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ learningResults, testOptions })
            });

            const result = await response.json();

            if (result.success) {
                this.generatedTests = result.testCases;
                // Store test cases globally for debugging
                window.testCases = result.testCases;
                this.displayTestCases();
                this.showTestCasesSection();
                this.updateTestStatistics();
                console.log(`✅ Generated ${result.testCases.length} new test cases`);
            } else {
                throw new Error(result.error || 'Test generation failed');
            }

        } catch (error) {
            console.error('❌ Test generation failed:', error);
            this.showError(error.message);
        } finally {
            this.generateBtn.disabled = false;
            this.generateBtn.innerHTML = '<span class="btn-icon">🧪</span><span class="btn-text">Generate Test Cases</span>';
            this.generationStatus.style.display = 'none';
        }
    }

    getLearningResults() {
        // Get learning results from Phase 1
        return window.learningResults || null;
    }

    getTestOptions() {
        return {
            priority: this.testPriority ? this.testPriority.value : 'medium',
            count: this.testCount ? parseInt(this.testCount.value) : 10,
            categories: {
                dataValidation: this.dataValidationCheck ? this.dataValidationCheck.checked : true,
                functionality: this.functionalityCheck ? this.functionalityCheck.checked : true,
                uiValidation: this.uiValidationCheck ? this.uiValidationCheck.checked : true,
                performance: this.performanceCheck ? this.performanceCheck.checked : false
            }
        };
    }

    convertPhase1TestCases(phase1TestCases) {
        console.log('🔄 Converting Phase 1 test cases to Phase 2 format:', phase1TestCases);
        
        return phase1TestCases.map((testCase, index) => ({
            id: `test-${index + 1}`,
            name: testCase.name || `Test Case ${index + 1}`,
            description: testCase.description || 'No description provided',
            steps: typeof testCase.steps === 'string' 
                ? testCase.steps.split(' ').filter(step => step.length > 0)
                : testCase.steps || [],
            selectors: Array.isArray(testCase.selectors) ? testCase.selectors : [testCase.selectors || '#element'],
            category: testCase.category?.toLowerCase().replace(/\s+/g, '_') || 'general',
            priority: testCase.priority?.toLowerCase() || 'medium',
            type: testCase.type || 'functional',
            status: 'pending',
            // PRESERVE TSV VALIDATION FIELDS:
            dataField: testCase.dataField,
            testValues: testCase.testValues,
            websiteUrl: testCase.websiteUrl,
            expectedResults: testCase.expectedResults || ['Test passes']
        }));
    }

    displayTestCases() {
        if (!this.testCasesList) return;

        if (this.generatedTests.length === 0) {
            this.testCasesList.innerHTML = '<p>No test cases generated yet. Click "Generate Test Cases" to start.</p>';
            return;
        }

        this.testCasesList.innerHTML = this.generatedTests.map(testCase => `
            <div class="test-case-card" data-test-id="${testCase.id}">
                <div class="test-case-header">
                    <div class="test-case-checkbox">
                        <input type="checkbox" id="test-${testCase.id}" ${this.selectedTests.has(testCase.id) ? 'checked' : ''} 
                               data-test-id="${testCase.id}">
                    </div>
                    <div class="test-case-info">
                        <h4>${testCase.name}</h4>
                        <div class="test-case-meta">
                            <span class="category ${testCase.category}">${testCase.category}</span>
                            <span class="priority ${testCase.priority}">${testCase.priority}</span>
                            <span class="status ${testCase.status}">${testCase.status}</span>
                        </div>
                    </div>
                </div>
                <div class="test-case-body">
                    <p class="description">${testCase.description}</p>
                    <div class="test-steps">
                        <h5>Steps:</h5>
                        <ol>
                            ${(testCase.steps || []).map(step => `<li>${step}</li>`).join('')}
                        </ol>
                    </div>
                    <div class="test-data">
                        <h5>TSV Validation Fields:</h5>
                        <div class="tsv-validation-fields">
                            <div class="field-row">
                                <strong>Data Field:</strong> ${testCase.dataField || 'Not specified'}
                            </div>
                            <div class="field-row">
                                <strong>Test Values:</strong> ${Array.isArray(testCase.testValues) ? testCase.testValues.join(', ') : (testCase.testValues || 'Not specified')}
                            </div>
                            <div class="field-row">
                                <strong>Test Type:</strong> ${testCase.type || 'Not specified'}
                            </div>
                            <div class="field-row">
                                <strong>Website URL:</strong> ${testCase.websiteUrl || 'Not specified'}
                            </div>
                            ${testCase.expectedResults ? `
                            <div class="field-row">
                                <strong>Expected Results:</strong>
                                <ul>
                                    ${Array.isArray(testCase.expectedResults) ? 
                                        testCase.expectedResults.map(result => `<li>${result}</li>`).join('') : 
                                        `<li>${testCase.expectedResults}</li>`
                                    }
                                </ul>
                            </div>
                            ` : ''}
                        </div>
                    </div>
                    <div class="test-selectors">
                        <h5>Selectors:</h5>
                        <div class="selector-list">
                            ${(testCase.selectors || []).map(selector => `<code>${selector}</code>`).join('')}
                        </div>
                    </div>
                </div>
            </div>
        `).join('');
        
        // Add event listeners to checkboxes after rendering
        this.attachCheckboxListeners();
    }

    attachCheckboxListeners() {
        const checkboxes = this.testCasesList.querySelectorAll('input[type="checkbox"]');
        checkboxes.forEach(checkbox => {
            checkbox.addEventListener('change', (event) => {
                const testId = event.target.getAttribute('data-test-id');
                this.toggleTestSelection(testId);
            });
        });
    }

    toggleTestSelection(testId) {
        if (this.selectedTests.has(testId)) {
            this.selectedTests.delete(testId);
        } else {
            this.selectedTests.add(testId);
        }
        this.updateExecuteButton();
    }

    selectAllTests() {
        this.generatedTests.forEach(test => this.selectedTests.add(test.id));
        this.displayTestCases();
        this.updateExecuteButton();
    }

    deselectAllTests() {
        this.selectedTests.clear();
        this.displayTestCases();
        this.updateExecuteButton();
    }

    updateExecuteButton() {
        if (this.executeSelectedBtn) {
            this.executeSelectedBtn.disabled = this.selectedTests.size === 0 || this.testExecutionInProgress;
        }
    }

    showTestCasesSection() {
        if (this.testCasesSection) {
            this.testCasesSection.style.display = 'block';
        }
    }

    filterTestCases() {
        if (!this.testCasesList) return;

        const searchTerm = this.testSearch ? this.testSearch.value.toLowerCase() : '';
        const categoryFilter = this.testCategoryFilter ? this.testCategoryFilter.value : '';
        const priorityFilter = this.testPriorityFilter ? this.testPriorityFilter.value : '';

        const filteredTests = this.generatedTests.filter(test => {
            const matchesSearch = !searchTerm || 
                test.name.toLowerCase().includes(searchTerm) ||
                test.description.toLowerCase().includes(searchTerm);
            
            const matchesCategory = !categoryFilter || test.category === categoryFilter;
            const matchesPriority = !priorityFilter || test.priority === priorityFilter;

            return matchesSearch && matchesCategory && matchesPriority;
        });

        // Re-display filtered tests
        const originalTests = this.generatedTests;
        this.generatedTests = filteredTests;
        this.displayTestCases();
        this.generatedTests = originalTests;
    }

    updateTestStatistics() {
        const stats = this.calculateStatistics();
        
        // Update summary cards if they exist
        const totalTestsEl = document.getElementById('total-tests');
        const dataValidationEl = document.getElementById('data-validation-tests');
        const functionalityEl = document.getElementById('functionality-tests');
        const performanceEl = document.getElementById('performance-tests');
        
        if (totalTestsEl) totalTestsEl.textContent = stats.total;
        if (dataValidationEl) dataValidationEl.textContent = stats.dataValidation;
        if (functionalityEl) functionalityEl.textContent = stats.functionality;
        if (performanceEl) performanceEl.textContent = stats.performance;
    }

    calculateStatistics() {
        return {
            total: this.generatedTests.length,
            dataValidation: this.generatedTests.filter(tc => tc.category === 'data_validation').length,
            functionality: this.generatedTests.filter(tc => tc.category === 'functionality').length,
            performance: this.generatedTests.filter(tc => tc.category === 'performance').length
        };
    }

    async executeSelectedTests() {
        if (this.selectedTests.size === 0) {
            alert('Please select at least one test case to execute');
            return;
        }

        try {
            this.testExecutionInProgress = true;
            this.executeSelectedBtn.disabled = true;
            this.executeSelectedBtn.innerHTML = '<span class="btn-icon">⏳</span><span class="btn-text">Executing...</span>';

            const testCaseIds = Array.from(this.selectedTests);
            
            const response = await fetch('/api/test/execute', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ 
                    testCaseIds,
                    options: { 
                        parallel: false,
                        timeout: 30000 
                    }
                })
            });

            const result = await response.json();

            if (result.success) {
                this.displayTestResults(result.results, result.statistics);
                this.showTestResultsSection();
                console.log('✅ Test execution completed');
            } else {
                throw new Error(result.error || 'Test execution failed');
            }

        } catch (error) {
            console.error('❌ Test execution failed:', error);
            this.showError(error.message);
        } finally {
            this.testExecutionInProgress = false;
            this.executeSelectedBtn.disabled = false;
            this.executeSelectedBtn.innerHTML = '<span class="btn-icon">⚡</span><span class="btn-text">Execute Selected Tests</span>';
        }
    }

    displayTestResults(results, statistics) {
        if (!this.resultsSummary || !this.detailedResults) return;

        // Update summary
        this.resultsSummary.innerHTML = `
            <div class="summary-card">
                <h4>Total Tests</h4>
                <div class="summary-value">${statistics.total || 0}</div>
            </div>
            <div class="summary-card">
                <h4>Passed</h4>
                <div class="summary-value passed">${statistics.passed || 0}</div>
            </div>
            <div class="summary-card">
                <h4>Failed</h4>
                <div class="summary-value failed">${statistics.failed || 0}</div>
            </div>
            <div class="summary-card">
                <h4>Duration</h4>
                <div class="summary-value">${statistics.duration || '0s'}</div>
            </div>
        `;

        // Display detailed results
        this.detailedResults.innerHTML = results.map(result => {
            let validationHTML = '';
            if (result.validation) {
                validationHTML = `
                    <div class="validation-details">
                        <h5>🔍 TSV Gold Standard Validation</h5>
                        <div class="validation-summary">
                            <p><strong>Expected Count:</strong> ${result.validation.expectedCount}</p>
                            <p><strong>Actual Count:</strong> ${result.validation.actualCount}</p>
                            <p><strong>Validation Status:</strong> 
                                <span class="${result.validation.passed ? 'validation-passed' : 'validation-failed'}">
                                    ${result.validation.passed ? '✅ Passed' : '❌ Failed'}
                                </span>
                            </p>
                        </div>
                        <div class="validation-message">
                            <strong>Message:</strong> ${result.validation.message}
                        </div>
                        ${result.validation.validationChecks ? `
                            <div class="validation-checks">
                                <h6>Validation Checks:</h6>
                                <ul>
                                    <li class="${result.validation.validationChecks.countMatch?.passed ? 'check-passed' : 'check-failed'}">
                                        Count Match: ${result.validation.validationChecks.countMatch?.message || 'N/A'}
                                    </li>
                                    <li class="${result.validation.validationChecks.fieldValuesMatch?.passed ? 'check-passed' : 'check-failed'}">
                                        Field Values: ${result.validation.validationChecks.fieldValuesMatch?.message || 'N/A'}
                                    </li>
                                    <li class="${result.validation.validationChecks.recordsMatch?.passed ? 'check-passed' : 'check-failed'}">
                                        Record IDs: ${result.validation.validationChecks.recordsMatch?.message || 'N/A'}
                                    </li>
                                </ul>
                            </div>
                        ` : ''}
                    </div>
                `;
            }

            return `
                <div class="test-result-card ${result.status}">
                    <div class="result-header">
                        <h4>${result.testCaseName || 'Unknown Test'}</h4>
                        <span class="result-status ${result.status}">${result.status}</span>
                    </div>
                    <div class="result-details">
                        <p><strong>Duration:</strong> ${result.duration || 0}ms</p>
                        <p><strong>Start Time:</strong> ${new Date(result.startTime).toLocaleString()}</p>
                        ${result.error ? `<p><strong>Error:</strong> ${result.error}</p>` : ''}
                        ${validationHTML}
                        ${result.screenshots && result.screenshots.length > 0 ? `
                            <div class="result-screenshots">
                                <h5>Screenshots:</h5>
                                ${result.screenshots.map(screenshot => 
                                    `<img src="${screenshot}" alt="Test screenshot" class="result-screenshot">`
                                ).join('')}
                            </div>
                        ` : ''}
                    </div>
                </div>
            `;
        }).join('');
    }

    showTestResultsSection() {
        if (this.testResultsSection) {
            this.testResultsSection.style.display = 'block';
        }
    }

    async exportTests() {
        try {
            const response = await fetch('/api/test/export', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ format: 'json' })
            });

            const result = await response.json();

            if (result.success) {
                // Download the test cases as JSON file
                const dataStr = JSON.stringify(result.testCases, null, 2);
                const dataBlob = new Blob([dataStr], { type: 'application/json' });
                const url = URL.createObjectURL(dataBlob);
                
                const link = document.createElement('a');
                link.href = url;
                link.download = `test-cases-${new Date().toISOString().split('T')[0]}.json`;
                link.click();
                
                URL.revokeObjectURL(url);
                console.log('✅ Test cases exported successfully');
            } else {
                throw new Error(result.error || 'Export failed');
            }
        } catch (error) {
            console.error('❌ Export failed:', error);
            this.showError(error.message);
        }
    }

    showError(message) {
        // Show error message to user
        console.error('Error:', message);
        alert(`Error: ${message}`);
    }
}

// Global reference for test generation UI
let testGenerationUI;

// ========================================
// LOG WINDOW FUNCTIONALITY
// ========================================

class LogWindow {
    constructor() {
        this.logs = [];
        this.maxLogs = 1000;
        this.init();
    }

    init() {
        // Override console methods to capture logs
        this.originalConsole = {
            log: console.log,
            error: console.error,
            warn: console.warn,
            info: console.info
        };

        this.overrideConsole();

        // Initialize UI
        this.createLogWindow();
        this.showLogWindow();
    }

    overrideConsole() {
        const self = this;
        
        console.log = function(...args) {
            self.originalConsole.log.apply(console, args);
            self.addLog('log', args);
        };

        console.error = function(...args) {
            self.originalConsole.error.apply(console, args);
            self.addLog('error', args);
        };

        console.warn = function(...args) {
            self.originalConsole.warn.apply(console, args);
            self.addLog('warn', args);
        };

        console.info = function(...args) {
            self.originalConsole.info.apply(console, args);
            self.addLog('info', args);
        };
    }

    addLog(type, args) {
        const timestamp = new Date().toLocaleTimeString();
        const message = args.map(arg => 
            typeof arg === 'object' ? JSON.stringify(arg) : String(arg)
        ).join(' ');

        this.logs.push({
            timestamp,
            type,
            message: message.substring(0, 500) // Limit message length
        });

        if (this.logs.length > this.maxLogs) {
            this.logs = this.logs.slice(-this.maxLogs);
        }

        this.updateLogDisplay();
    }

    createLogWindow() {
        this.logWindow = document.createElement('div');
        this.logWindow.id = 'log-window';
        this.logWindow.innerHTML = `
            <div class="log-header">
                <h5>📝 Console Logs</h5>
                <button class="log-toggle">🚫</button>
                <button class="log-clear">🗑️</button>
            </div>
            <div class="log-content">
                <div class="log-list" id="log-list"></div>
            </div>
        `;
        document.body.appendChild(this.logWindow);
        this.setupLogEvents();
    }

    setupLogEvents() {
        this.logWindow.querySelector('.log-toggle').addEventListener('click', () => {
            this.hideLogWindow();
        });

        this.logWindow.querySelector('.log-clear').addEventListener('click', () => {
            this.logs = [];
            this.updateLogDisplay();
        });
    }

    showLogWindow() {
        this.logWindow.style.display = 'block';
    }

    hideLogWindow() {
        this.logWindow.style.display = 'none';
    }

    updateLogDisplay() {
        const logList = document.getElementById('log-list');
        if (!logList) return;

        logList.innerHTML = this.logs.slice(-50).map(log => `
            <div class="log-entry log-${log.type}">
                <span class="log-time">[${log.timestamp}]</span>
                <span class="log-message">${log.message}</span>
            </div>
        `).join('');

        // Auto-scroll to bottom
        logList.scrollTop = logList.scrollHeight;
    }
}

// ========================================
// LLM BANDWIDTH INSPECTOR
// ========================================

class LLMBandwidthInspector {
    constructor() {
        this.sidebar = null;
        this.isPanelledVisible = false;
        this.llmCalls = [];
        this.init();
    }
    
    init() {
        this.createSidebar();
        this.setupWebSocketListeners();
        this.loadExistingCalls();
        this.startPollingForUpdates();
        console.log('🧠 LLM Bandwidth Inspector initialized');
    }
    
    createSidebar() {
        // Create floating sidebar
        this.sidebar = document.createElement('div');
        this.sidebar.id = 'llm-inspector';
        this.sidebar.innerHTML = `
            <div class="llm-header">
                <h5>🧠 LLM Inspector</h5>
                <button class="llm-toggle">−</button>
            </div>
            <div class="llm-content">
                <div class="llm-stats">
                    <div class="stat-item">
                        <span class="stat-label">Total Calls:</span>
                        <span class="stat-value" id="total-calls">0</span>
                    </div>
                    <div class="stat-item">
                        <span class="stat-label">Success Rate:</span>
                        <span class="stat-value" id="success-rate">100%</span>
                    </div>
                    <div class="stat-item">
                        <span class="stat-label">Avg Duration:</span>
                        <span class="stat-value" id="avg-duration">0ms</span>
                    </div>
                </div>
                <div class="llm-timeline">
                    <h6>🔄 LLM Call Timeline</h6>
                    <div class="timeline-items" id="timeline-items">
                        <div class="timeline-placeholder">Waiting for LLM calls...</div>
                    </div>
                </div>
            </div>
        `;
        
        document.body.appendChild(this.sidebar);
        this.setupEventListeners();
    }
    
    setupEventListeners() {
        // Toggle button
        this.sidebar.querySelector('.llm-toggle').addEventListener('click', () => {
            this.togglePanelledStyle();
        });
        
        // Timeline item clicks for details
        this.sidebar.addEventListener('click', (e) => {
            if (e.target.closest('.timeline-item')) {
                const timelineItem = e.target.closest('.timeline-item');
                const callId = timelineItem.dataset.callId;
                if (callId) this.showCallDetails(callId);
            }
        });
    }
    
    setupWebSocketListeners() {
        // Listen for real-time LLM updates via Socket.IO
        if (typeof io !== 'undefined') {
            try {
                const socket = io();
                socket.on('llmCallUpdate', (llmCall) => {
                    console.log('📡 Received LLM call update:', llmCall);
                    this.addLiveCall(llmCall);
                });
                console.log('✅ Socket.IO listeners setup successfully');
            } catch (error) {
                console.warn('⚠️ Socket.IO connection failed, using polling mode:', error.message);
            }
        } else {
            console.log('⚠️ Socket.IO not available, using polling mode');
        }
    }
    
    loadExistingCalls() {
        // Load any existing LLM calls from global storage
        if (window.global?.realtimeLLMCalls) {
            console.log('📂 Loading existing LLM calls:', window.global.realtimeLLMCalls.length);
            window.global.realtimeLLMCalls.forEach(call => this.addLiveCall(call));
        }
    }
    
    addLiveCall(llmCall) {
        // Avoid duplicates
        if (this.llmCalls.some(call => call.id === llmCall.id)) return;
        
        this.llmCalls.unshift(llmCall);
        console.log(`🧠 Added LLM call: ${llmCall.type} (${llmCall.duration}ms)`);
        
        // Update UI
        this.updateStats();
        this.addTimelineItem(llmCall);
        this.trimOldCalls();
    }
    
    addTimelineItem(llmCall) {
        const timelineItems = document.getElementById('timeline-items');
        const placeholder = timelineItems.querySelector('.timeline-placeholder');
        if (placeholder) placeholder.remove();
        
        const timelineItem = document.createElement('div');
        timelineItem.className = 'timeline-item';
        timelineItem.dataset.callId = llmCall.id;
        timelineItem.innerHTML = `
            <div class="call-header">
                <span class="call-sign type">${this.formatCallType(llmCall.type)}</span>
                <span class="call-sign status ${llmCall.status || 'completed'}">${llmCall.status || 'completed'}</span>
                <span class="call-sign duration">${llmCall.duration || 0}ms</span>
            </div>
            <div class="call-summary">
                <div class="metric">📤 ${llmCall.prompt?.tokenEstimate || 0} tokens</div>
                <div class="metric">📥 ${llmCall.response?.tokenEstimate || 0} tokens</div>
                <div class="metric">🎯 ${llmCall.parsed?.elementCount || 0} elements</div>
            </div>
            <div class="call-bar ${llmCall.status || 'completed'}"></div>
        `;
        
        timelineItems.insertBefore(timelineItem, timelineItems.firstChild);
        
        // Keep only 10 visible timeline items
        const items = timelineItems.querySelectorAll('.timeline-item');
        if (items.length > 10) {
            items[items.length - 1].remove();
        }
    }
    
    showCallDetails(callId) {
        const call = this.llmCalls.find(c => c.id === callId);
        if (!call) return;
        
        // Replace timeline with detailed view
        const llmContent = this.sidebar.querySelector('.llm-content');
        llmContent.innerHTML = `
            <div class="call-details-view">
                <button class="back-button" onclick="llmInspector.togglePanelledStyle()">← Back to Timeline</button>
                <h6>📋 ${this.formatCallType(call.type)} Call Details</h6>
                
                <div class="detail-section">
                    <h7>📤 Prompt (${call.prompt?.tokenEstimate || 0} tokens)</h7>
                    <code class="prompt-content">${this.truncateText(call.prompt?.content || '', 500)}</code>
                    <div class="prompt-meta">Length: ${call.prompt?.length || 0} characters</div>
                </div>
                
                <div class="detail-section">
                    <h7>📥 Response (${call.response?.tokenEstimate || 0} tokens)</h7>
                    <code class="response-content">${this.truncateText(call.response?.content || '', 500)}</code>
                    <div class="response-meta">Length: ${call.response?.length || 0} characters ${call.response?.truncated ? '(Truncated)' : ''}</div>
                </div>
                
                <div class="detail-section">
                    <h7>⚙️ Parsed Result</h7>
                    <div class="parsed-summary">
                        Success: ${call.parsed?.success ? '✅' : '❌'}<br>
                        Elements Found: ${call.parsed?.elementCount || 0}<br>
                        ${call.parsed?.confidence ? `Confidence: ${(call.parsed.confidence * 100).toFixed(1)}%` : ''}
                        ${call.parsed?.totalFields ? `<br>Total Fields: ${call.parsed.totalFields}` : ''}
                    </div>
                </div>
                
                <div class="detail-section">
                    <h7>📊 Call Metadata</h7>
                    <div class="metadata-summary">
                        Call ID: ${call.id}<br>
                        Duration: ${call.duration || 0}ms<br>
                        Status: ${call.status || 'completed'}<br>
                        Timestamp: ${new Date(call.timestamp).toLocaleString()}
                    </div>
                </div>
                
                <button class="copy-json-button" onclick="llmInspector.copyCallJSON('${callId}')">📋 Copy Call JSON</button>
            </div>
        `;
        
        this.isPanelledVisible = true;
        this.sidebar.className = 'llm-inspector llm-panelled';
    }
    
    togglePanelledStyle() {
        if (this.isPanelledVisible) {
            // Return to timeline view
            this.resetToTimelineView();
        }
        this.isPanelledVisible = !this.isPanelledVisible;
        this.sidebar.className = this.isPanelledVisible ? 'llm-inspector llm-panelled' : 'llm-inspector';
    }
    
    resetToTimelineView() {
        const llmContent = this.sidebar.querySelector('.llm-content');
        llmContent.innerHTML = `
            <div class="llm-stats">
                <div class="stat-item">
                    <span class="stat-label">Total Calls:</span>
                    <span class="stat-value" id="total-calls">${this.llmCalls.length}</span>
                </div>
                <div class="stat-item">
                    <span class="stat-label">Success Rate:</span>
                    <span class="stat-value" id="success-rate">${this.calculateSuccessRate()}%</span>
                </div>
                <div class="stat-item">
                    <span class="stat-label">Avg Duration:</span>
                    <span class="stat-value" id="avg-duration">${this.calculateAvgDuration()}ms</span>
                </div>
            </div>
            <div class="llm-timeline">
                <h6>🔄 LLM Call Timeline</h6>
                <div class="timeline-items" id="timeline-items">
                    ${this.renderTimelineItems()}
                </div>
            </div>
        `;
        
        this.setupEventListeners();
    }
    
    renderTimelineItems() {
        if (this.llmCalls.length === 0) {
            return '<div class="timeline-placeholder">Waiting for LLM calls...</div>';
        }
        
        return this.llmCalls.slice(0, 10).map(call => `
            <div class="timeline-item" data-call-id="${call.id}">
                <div class="call-header">
                    <span class="call-sign type">${this.formatCallType(call.type)}</span>
                    <span class="call-sign status ${call.status || 'completed'}">${call.status || 'completed'}</span>
                    <span class="call-sign duration">${call.duration || 0}ms</span>
                </div>
                <div class="call-summary">
                    <div class="metric">📤 ${call.prompt?.tokenEstimate || 0} tokens</div>
                    <div class="metric">📥 ${call.response?.tokenEstimate || 0} tokens</div>
                    <div class="metric">🎯 ${call.parsed?.elementCount || 0} elements</div>
                </div>
                <div class="call-bar ${call.status || 'completed'}"></div>
            </div>
        `).join('');
    }
    
    updateStats() {
        const totalCalls = this.llmCalls.length;
        const successRate = this.calculateSuccessRate();
        const avgDuration = this.calculateAvgDuration();
        
        const totalCallsEl = document.getElementById('total-calls');
        const successRateEl = document.getElementById('success-rate');
        const avgDurationEl = document.getElementById('avg-duration');
        
        if (totalCallsEl) totalCallsEl.textContent = totalCalls;
        if (successRateEl) successRateEl.textContent = `${successRate}%`;
        if (avgDurationEl) avgDurationEl.textContent = `${avgDuration}ms`;
    }
    
    calculateSuccessRate() {
        if (this.llmCalls.length === 0) return 100;
        const successfulCalls = this.llmCalls.filter(call => call.status === 'completed' || !call.status).length;
        return Math.round((successfulCalls / this.llmCalls.length) * 100);
    }
    
    calculateAvgDuration() {
        if (this.llmCalls.length === 0) return 0;
        const totalDuration = this.llmCalls.reduce((sum, call) => sum + (call.duration || 0), 0);
        return Math.round(totalDuration / this.llmCalls.length);
    }
    
    startPollingForUpdates() {
        // Poll for updates every 3 seconds as fallback
        setInterval(() => {
            if (window.global?.realtimeLLMCalls) {
                const currentCallCount = this.llmCalls.length;
                const serverCallCount = window.global.realtimeLLMCalls.length;
                
                if (serverCallCount > currentCallCount) {
                    const newCalls = window.global.realtimeLLMCalls.slice(currentCallCount);
                    newCalls.forEach(call => this.addLiveCall(call));
                }
            }
        }, 3000);
    }
    
    trimOldCalls() {
        if (this.llmCalls.length > 50) {
            this.llmCalls = this.llmCalls.slice(0, 50);
        }
    }
    
    copyCallJSON(callId) {
        const call = this.llmCalls.find(c => c.id === callId);
        if (call) {
            const jsonString = JSON.stringify(call, null, 2);
            navigator.clipboard.writeText(jsonString).then(() => {
                console.log('📋 LLM call JSON copied to clipboard');
                // Could show a toast notification here
            }).catch(err => {
                console.error('Failed to copy to clipboard:', err);
                // Fallback: show in alert
                alert('JSON copied to console. Check console.log');
                console.log(jsonString);
            });
        }
    }
    
    formatCallType(type) {
        return type.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
    }
    
    truncateText(text, maxLength) {
        // Handle different data types
        let textString = '';
        
        if (typeof text === 'string') {
            textString = text;
        } else if (typeof text === 'object' && text !== null) {
            // If it's an object, try to extract meaningful content
            if (text.content) {
                textString = typeof text.content === 'string' ? text.content : JSON.stringify(text.content);
            } else if (text.text) {
                textString = typeof text.text === 'string' ? text.text : JSON.stringify(text.text);
            } else {
                textString = JSON.stringify(text);
            }
        } else if (text !== null && text !== undefined) {
            textString = String(text);
        }
        
        if (textString.length <= maxLength) return textString;
        return textString.substring(0, maxLength) + '...';
    }
}

// ========================================
// INITIALIZATION
// ========================================

// Initialize LLM Inspector
let llmInspector;

document.addEventListener('DOMContentLoaded', () => {
    // Initialize Learning Phase UI
    window.learningUI = new LearningPhaseUI();
    
    // Initialize Test Generation UI
    window.testGenerationUI = new TestGenerationUI();
    
    // Initialize LLM Inspector
    llmInspector = new LLMBandwidthInspector();
    
    // Initialize Log Window (optional)
    // const logWindow = new LogWindow();
    
    console.log('🚀 LLM Bandwidth Inspector ready!');
    console.log('📚 Learning Phase UI ready!');
    console.log('🧪 Test Generation UI ready!');
});

// Make it globally accessible
window.llmInspector = llmInspector;