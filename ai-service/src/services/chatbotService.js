// ai-service/src/services/chatbotService.js
// AI Shopping Assistant - Chatbot Service using Google Gemini

const { GoogleGenerativeAI } = require('@google/generative-ai');
const axios = require('axios');
const { v4: uuidv4 } = require('uuid');

// Initialize Gemini client
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// In-memory conversation store (use Redis in production)
const conversations = new Map();

// Gateway URL for fetching products
const GATEWAY_URL = process.env.GATEWAY_URL || 'http://localhost:4000';
const PRODUCT_SERVICE_URL = process.env.PRODUCT_SERVICE_URL || 'http://localhost:4002/graphql';
const INTERNAL_JWT_SECRET = process.env.INTERNAL_JWT_SECRET || 'internal-secret';

/**
 * Fetch product catalog from the product service via gateway
 */
const getProductCatalog = async () => {
    try {
        const query = `
            query GetProducts {
                products(limit: 50) {
                    id
                    name
                    description
                    category
                    basePrice
                    images
                    variants {
                        id
                        name
                        priceModifier
                        stock
                    }
                }
            }
        `;

        const response = await axios.post(
            PRODUCT_SERVICE_URL,
            { query },
            {
                headers: {
                    'Content-Type': 'application/json',
                    'x-internal-gateway-token': require('jsonwebtoken').sign(
                        { service: 'ai-service' },
                        INTERNAL_JWT_SECRET
                    ),
                },
                timeout: 10000,
            }
        );

        if (response.data.errors) {
            console.error('GraphQL errors:', JSON.stringify(response.data.errors));
            return [];
        }

        const products = response.data.data?.products || [];
        console.log(`Fetched ${products.length} products for chatbot context`);
        return products;
    } catch (error) {
        console.error('Failed to fetch products:', error.message);
        return [];
    }
};

/**
 * Build system prompt with product catalog context
 */
const buildSystemPrompt = (products) => {
    const productList = products.map(p => {
        const variants = p.variants?.map(v => `${v.name}: $${v.effectivePrice}`).join(', ') || '';
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
        if (conversation.products.length > 0) {
            console.log(`First product: ${conversation.products[0].name}`);
        }

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

        // Send the message and get response
        const result = await chatSession.sendMessage(message);
        const aiResponse = result.response.text();

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
        console.error('Chatbot error:', error);

        if (error.message?.includes('API key')) {
            throw new Error('Gemini API key is not configured. Please add GEMINI_API_KEY to your .env file.');
        }

        throw new Error(`Chat failed: ${error.message}`);
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
