// ai-service/src/services/chatbotService.js
// AI Shopping Assistant - Chatbot Service using Google Gemini

const { GoogleGenerativeAI } = require('@google/generative-ai');
const axios = require('axios');
const { v4: uuidv4 } = require('uuid');
const { createCircuitBreaker } = require('../utils/circuitBreaker');
const { retryWithBackoff } = require('../utils/retryHelper');

// Initialize Gemini client
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// In-memory conversation store (use Redis in production)
const conversations = new Map();

// Gateway URL for fetching products
const GATEWAY_URL = process.env.GATEWAY_URL || 'http://localhost:4000';
const PRODUCT_SERVICE_URL = process.env.PRODUCT_SERVICE_URL || 'http://localhost:4002/graphql';
const PRODUCT_API_URL = process.env.PRODUCT_API_URL || 'http://localhost:4002/api//products'
const INTERNAL_JWT_SECRET = process.env.INTERNAL_JWT_SECRET || 'internal-secret';

const productServiceBreaker = createCircuitBreaker(
    async (url, config) => {
        return await axios.get(url, config);
    },
    {
        name: 'product-service',
        timeout: 10000,
        errorThresholdPercentage: 50,
        resetTimeout: 30000,
    }
);

const geminiServiceBreaker = createCircuitBreaker(
    async (chatSession, message) => {
        return await chatSession.sendMessage(message);
    },
    {
        name: 'gemini-api',
        timeout: 15000, // Gemini can be slower
        errorThresholdPercentage: 60,
        resetTimeout: 60000, // Longer reset for external API
    }
);

// CHANGE: Fallback for product service circuit breaker
productServiceBreaker.fallback(() => {
    console.warn('⚠️ Product service circuit open - returning empty catalog');
    return { data: [] };
});

// CHANGE: Fallback for Gemini circuit breaker
geminiServiceBreaker.fallback(() => {
    throw new Error('AI service is temporarily unavailable. Please try again in a moment.');
});
/**
 * Fetch product catalog from the product service via gateway
 */
const getProductCatalog = async () => {
    try {
        // CHANGE: Use retry logic with circuit breaker
        const response = await retryWithBackoff(
            async () => {
                return await productServiceBreaker.fire(
                    PRODUCT_API_URL,
                    {
                        params: { limit: 50 },
                        headers: {
                            'Content-Type': 'application/json',
                        },
                        timeout: 10000,
                    }
                );
            },
            {
                maxRetries: 3,
                initialDelay: 1000,
                retryableErrors: ['ECONNREFUSED', 'ETIMEDOUT', 'ECONNABORTED', 503, 429],
                onRetry: (attempt, error, delay) => {
                    console.warn(`Retrying product catalog fetch (attempt ${attempt}): ${error.message}`);
                },
            }
        );

        const products = response.data || [];
        console.log(`✅ Fetched ${products.length} products for chatbot context`);
        return products;
    } catch (error) {
        console.error('❌ Failed to fetch products after retries:', error.message);

        // CHANGE: Return empty array instead of throwing to allow chatbot to continue
        return [];
    }
};
/**
 * Build system prompt with product catalog context
 */
const buildSystemPrompt = (products) => {
    // CHANGE: Handle empty product catalog gracefully
    if (!products || products.length === 0) {
        return `You are a helpful AI shopping assistant for an e-commerce store. 

Unfortunately, I'm currently unable to access the product catalog. Please let the customer know that the product information is temporarily unavailable, but you're happy to help them with general shopping questions or they can try again in a moment.

Be apologetic and helpful, suggesting they:
1. Try again in a few moments
2. Browse the website directly
3. Contact customer support if urgent

Keep responses brief and empathetic.`;
    }

    const productList = products.map(p => {
        const variants = p.variants?.map(v => {
            const effectivePrice = p.basePrice + (v.priceModifier || 0);
            return `${v.name}: $${effectivePrice.toFixed(2)}`;
        }).join(', ') || '';
        return `- ${p.name} (ID: ${p.id}) - ${p.category} - $${p.basePrice}${variants ? ` | Variants: ${variants}` : ''}\n  ${p.description?.substring(0, 100) || 'No description'}`;
    }).join('\n');

    return `You are a helpful AI shopping assistant for an e-commerce store. Your goal is to help customers find the perfect products based on their needs.

AVAILABLE PRODUCTS:
${productList}

INSTRUCTIONS:
1. Listen carefully to what the customer is looking for
2. Recommend specific products from the catalog above by their exact names
3. Explain WHY each product is a good fit for their needs
4. If no products match, suggest the closest alternatives
5. Be friendly, helpful, and concise
6. Always include product IDs when recommending products so they can be linked

When recommending products, format them as:
**[Product Name]** (ID: xxx) - $price - Brief reason why it's a good fit

Keep responses conversational and under 200 words unless the customer asks for details.

CRITICAL: Use the EXACT IDs provided in the AVAILABLE PRODUCTS list above. DO NOT invent or hallucinate IDs. If you recommend a product, you MUST use its real ID from the catalog.`;
};

/**
 * Extract product IDs mentioned in the AI response
 */
const extractProductIds = (response, products) => {
    const ids = [];
    const idPattern = /ID:\s*([a-f0-9-]+)/gi;
    let match;

    while ((match = idPattern.exec(response)) !== null) {
        const id = match[1];
        if (products.some(p => p.id === id)) {
            ids.push(id);
        }
    }

    // Fallback: Check if product names or significant parts of names are mentioned
    if (ids.length === 0) {
        products.forEach(product => {
            const cleanName = product.name.toLowerCase();
            const cleanResponse = response.toLowerCase();

            // Match full name or first 2 words of the name if it's long
            const nameParts = cleanName.split(' ');
            const shortName = nameParts.slice(0, 2).join(' ');

            if (cleanResponse.includes(cleanName) || (shortName.length > 3 && cleanResponse.includes(shortName))) {
                ids.push(product.id);
            }
        });
    }

    return [...new Set(ids)];
};

/**
 * Main chat function using Google Gemini
 */
const chat = async (userId, message, conversationId = null) => {
    try {
        // Get or create conversation
        const convId = conversationId || uuidv4();
        let conversation = conversations.get(convId) || {
            id: convId,
            userId,
            messages: [],
            products: null,
            createdAt: new Date(),
        };

        // Fetch products if not cached (refresh every 5 minutes)
        const now = new Date();
        if (!conversation.products || (now - conversation.createdAt) > 5 * 60 * 1000) {
            conversation.products = await getProductCatalog();
            conversation.createdAt = now;
        }

        // Add user message to history
        conversation.messages.push({
            role: 'user',
            parts: [{ text: message }],
        });

        // Build the system prompt
        const systemPrompt = buildSystemPrompt(conversation.products);
        console.log(`Sending prompt with ${conversation.products.length} products`);

        // Initialize Gemini model
        const model = genAI.getGenerativeModel({
            model: 'gemini-flash-latest',
            systemInstruction: systemPrompt,
        });

        // Build chat history for Gemini (exclude the current message)
        const history = conversation.messages.slice(0, -1).map(msg => ({
            role: msg.role,
            parts: msg.parts,
        }));

        // Start a chat session
        const chatSession = model.startChat({
            history: history.slice(-10), // Keep last 10 messages for context
        });

        // CHANGE: Send message with retry and circuit breaker
        let aiResponse;
        try {
            const result = await retryWithBackoff(
                async () => {
                    return await geminiServiceBreaker.fire(chatSession, message);
                },
                {
                    maxRetries: 2, // Fewer retries for external API
                    initialDelay: 2000,
                    maxDelay: 8000,
                    retryableErrors: ['ETIMEDOUT', 'ECONNABORTED', 503, 429],
                    onRetry: (attempt, error, delay) => {
                        console.warn(`Retrying Gemini API (attempt ${attempt}): ${error.message}`);
                    },
                }
            );
            aiResponse = result.response.text();
        } catch (error) {
            // CHANGE: Handle Gemini API failures gracefully
            console.error('❌ Gemini API failed after retries:', error.message);

            if (error.message?.includes('API key')) {
                throw new Error('AI service configuration error. Please contact support.');
            }

            throw new Error('AI assistant is temporarily unavailable. Please try again in a moment.');
        }

        // Add AI response to history
        conversation.messages.push({
            role: 'model',
            parts: [{ text: aiResponse }],
        });

        // Save conversation
        conversations.set(convId, conversation);

        // Extract recommended product IDs
        const recommendedIds = extractProductIds(aiResponse, conversation.products);
        const recommendedProducts = conversation.products.filter(p => recommendedIds.includes(p.id));

        // Clean up old conversations (keep last 100)
        if (conversations.size > 100) {
            const oldest = [...conversations.entries()]
                .sort((a, b) => a[1].createdAt - b[1].createdAt)[0];
            conversations.delete(oldest[0]);
        }

        return {
            message: aiResponse,
            products: recommendedProducts,
            conversationId: convId,
        };

    } catch (error) {
        console.error('❌ Chatbot error:', error);
        throw error;
    }
};

/**
 * Get conversation history
 */
const getConversation = (conversationId) => {
    return conversations.get(conversationId) || null;
};

/**
 * Clear conversation
 */
const clearConversation = (conversationId) => {
    conversations.delete(conversationId);
    return true;
};

module.exports = {
    chat,
    getConversation,
    clearConversation,
    getProductCatalog,
};
