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
            const toolResultsHtml = message.toolResults.map(result => 
                `<div class="tool-result">
                    <strong>${result.success ? '✅' : '❌'} Tool Result</strong><br>
                    <pre>${JSON.stringify(result.result, null, 2)}</pre>
                </div>`
            ).join('');
            contentDiv.innerHTML += toolResultsHtml;
        }
        
        messageDiv.appendChild(contentDiv);
        this.chatMessages.appendChild(messageDiv);
        this.scrollToBottom();
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

// Initialize the chatbot UI when the page loads
document.addEventListener('DOMContentLoaded', () => {
    new ChatbotUI();
});
