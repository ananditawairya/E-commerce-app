const mongoose = require('mongoose');
const { v4: uuidv4 } = require('uuid');
const Product = require('./src/models/Product');
require('dotenv').config();

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/product_db';
const SELLER_ID = 'demo-seller-123';

const products = [
    // Electronics
    {
        name: 'ProBeam 5G Smartphone',
        description: 'Ultra-fast 5G smartphone with 6.7-inch AMOLED display, 108MP camera, and all-day battery life.',
        category: 'Electronics',
        basePrice: 799.99,
        images: ['https://images.unsplash.com/photo-1511707171634-5f897ff02aa9?q=80&w=800'],
        variants: [{ name: '128GB - Phantom Black', stock: 50, priceModifier: 0 }]
    },
    {
        name: 'ZenBook Pro X14',
        description: 'High-performance laptop for creators. Features 14-inch 4K OLED screen, i9 processor, and 32GB RAM.',
        category: 'Electronics',
        basePrice: 1599.99,
        images: ['https://images.unsplash.com/photo-1496181133206-80ce9b88a853?q=80&w=800'],
        variants: [{ name: 'Standard', stock: 15, priceModifier: 0 }]
    },
    {
        name: 'SonicWave Wireless Earbuds',
        description: 'Active noise-canceling earbuds with crystal-clear sound and 40-hour total battery life with case.',
        category: 'Electronics',
        basePrice: 129.99,
        images: ['https://images.unsplash.com/photo-1590658268037-6bf12165a8df?q=80&w=800'],
        variants: [{ name: 'Standard', stock: 100, priceModifier: 0 }]
    },
    {
        name: 'Ocular VR Headset',
        description: 'Immersive virtual reality experience with high-resolution displays and integrated spatial audio.',
        category: 'Electronics',
        basePrice: 499.99,
        images: ['https://images.unsplash.com/photo-1622979135225-d2ba269cf1ac?q=80&w=800'],
        variants: [{ name: 'Standard', stock: 20, priceModifier: 0 }]
    },
    {
        name: 'Titan Gaming Monitor',
        description: '32-inch curved gaming monitor with 240Hz refresh rate and 1ms response time.',
        category: 'Electronics',
        basePrice: 449.99,
        images: ['https://images.unsplash.com/photo-1527443224154-c4a3942d3acf?q=80&w=800'],
        variants: [{ name: 'Standard', stock: 12, priceModifier: 0 }]
    },

    // Fashion
    {
        name: 'Urban Explorer Parka',
        description: 'Water-resistant insulated parka designed for extreme cold. Multiple utility pockets and faux-fur hood.',
        category: 'Fashion',
        basePrice: 189.99,
        images: ['https://images.unsplash.com/photo-1539533377285-b82b95251649?q=80&w=800'],
        variants: [
            { name: 'Small', stock: 10, priceModifier: 0 },
            { name: 'Medium', stock: 15, priceModifier: 0 },
            { name: 'Large', stock: 8, priceModifier: 5.00 }
        ]
    },
    {
        name: 'Classic Indigo Denim',
        description: 'Authentic slim-fit denim jeans made from premium raw cotton. Durable and classic.',
        category: 'Fashion',
        basePrice: 59.99,
        images: ['https://images.unsplash.com/photo-1542272604-787c3835535d?q=80&w=800'],
        variants: [{ name: 'Standard', stock: 60, priceModifier: 0 }]
    },
    {
        name: 'Velocity Running Shoes',
        description: 'Lightweight performance running shoes with responsive cushioning for maximum energy return.',
        category: 'Fashion',
        basePrice: 95.00,
        images: ['https://images.unsplash.com/photo-1542291026-7eec264c27ff?q=80&w=800'],
        variants: [{ name: 'Standard', stock: 45, priceModifier: 0 }]
    },
    {
        name: 'Heirloom Cashmere Sweater',
        description: 'Incredibly soft 100% cashmere sweater. A versatile addition to any wardrobe.',
        category: 'Fashion',
        basePrice: 120.00,
        images: ['https://images.unsplash.com/photo-1620799140408-edc6dcb6d633?q=80&w=800'],
        variants: [{ name: 'Standard', stock: 25, priceModifier: 0 }]
    },
    {
        name: 'Elysian Leather Handbag',
        description: 'Handcrafted genuine leather handbag with gold-tone hardware and adjustable shoulder strap.',
        category: 'Fashion',
        basePrice: 210.00,
        images: ['https://images.unsplash.com/photo-1584917865442-de89df76afd3?q=80&w=800'],
        variants: [{ name: 'Standard', stock: 10, priceModifier: 0 }]
    },

    // Home & Kitchen
    {
        name: 'SmartBrew Espresso Machine',
        description: 'Precision espresso machine with programmable settings and integrated milk frother.',
        category: 'Home & Kitchen',
        basePrice: 349.99,
        images: ['https://images.unsplash.com/photo-1517668222347-f5952f8d706a?q=80&w=800'],
        variants: [{ name: 'Standard', stock: 20, priceModifier: 0 }]
    },
    {
        name: 'PureAir HEPA Purifier',
        description: 'Highly efficient air purifier that removes 99.97% of airborne particles, allergens, and odors.',
        category: 'Home & Kitchen',
        basePrice: 149.00,
        images: ['https://images.unsplash.com/photo-1585771724684-252702b64428?q=80&w=800'],
        variants: [{ name: 'Standard', stock: 35, priceModifier: 0 }]
    },
    {
        name: 'ChefMaster 10-Piece Cookware',
        description: 'Professional-grade stainless steel cookware set with even heat distribution and cool-touch handles.',
        category: 'Home & Kitchen',
        basePrice: 299.00,
        images: ['https://images.unsplash.com/photo-1584990344468-ca4ccfb1a2b2?q=80&w=800'],
        variants: [{ name: 'Standard', stock: 15, priceModifier: 0 }]
    },
    {
        name: 'Lumina Smart LED Bulbs (4-Pack)',
        description: 'Wi-Fi enabled color-changing LED bulbs compatible with major smart home assistants.',
        category: 'Home & Kitchen',
        basePrice: 45.00,
        images: ['https://images.unsplash.com/photo-1550985543-f47f38aee62e?q=80&w=800'],
        variants: [{ name: 'Standard', stock: 120, priceModifier: 0 }]
    },
    {
        name: 'DreamCloud Memory Foam Pillow',
        description: 'Ergonomic memory foam pillow designed for all sleeping positions. Cool-touch cover included.',
        category: 'Home & Kitchen',
        basePrice: 35.00,
        images: ['https://images.unsplash.com/photo-1632121118944-7757917f2269?q=80&w=800'],
        variants: [{ name: 'Standard', stock: 80, priceModifier: 0 }]
    },

    // Grocery
    {
        name: 'Artisan Dark Roast Coffee',
        description: 'Ethically sourced, small-batch roasted whole bean coffee with notes of dark chocolate and cherry.',
        category: 'Grocery',
        basePrice: 18.50,
        images: ['https://images.unsplash.com/photo-1559056199-641a0ac8b55e?q=80&w=800'],
        variants: [{ name: '500g Bag', stock: 150, priceModifier: 0 }]
    },
    {
        name: 'Organic Extra Virgin Olive Oil',
        description: 'Cold-pressed organic olive oil from single-origin olives. Harvested at peak ripeness.',
        category: 'Grocery',
        basePrice: 22.00,
        images: ['https://images.unsplash.com/photo-1474979266404-7eaacbad8f0f?q=80&w=800'],
        variants: [{ name: '750ml Bottle', stock: 45, priceModifier: 0 }]
    },
    {
        name: 'Himalayan Pink Salt (Fine)',
        description: '100% natural, unprocessed pink salt mined from the ancient Himalayan mountains.',
        category: 'Grocery',
        basePrice: 9.99,
        images: ['https://images.unsplash.com/photo-1610450949065-2f22ca59bae7?q=80&w=800'],
        variants: [{ name: '1kg Pouch', stock: 200, priceModifier: 0 }]
    },
    {
        name: 'Manuka Honey (UMF 15+)',
        description: 'Premium New Zealand Manuka honey with high antibacterial properties and a rich, complex flavor.',
        category: 'Grocery',
        basePrice: 45.00,
        images: ['https://images.unsplash.com/photo-1587049352846-4a222e784d38?q=80&w=800'],
        variants: [{ name: '250g Jar', stock: 30, priceModifier: 0 }]
    },
    {
        name: 'Quinoa & Kale Superfood Mix',
        description: 'Nutritious blend of organic quinoa and dehydrated kale. Perfect as a base for salads or side dishes.',
        category: 'Grocery',
        basePrice: 12.00,
        images: ['https://images.unsplash.com/photo-1512621776951-a57141f2eefd?q=80&w=800'],
        variants: [{ name: 'Standard', stock: 75, priceModifier: 0 }]
    },

    // Beauty & Personal Care
    {
        name: 'GlowBoost Vitamin C Serum',
        description: 'Potent 20% Vitamin C serum for brighter, more even-toned skin. Contains ferulic acid and Vitamin E.',
        category: 'Beauty',
        basePrice: 38.00,
        images: ['https://images.unsplash.com/photo-1620916566398-39f1143ab7be?q=80&w=800'],
        variants: [{ name: 'Standard', stock: 40, priceModifier: 0 }]
    },
    {
        name: 'SilkRest Sleep Mask',
        description: '100% mulberry silk sleep mask for ultimate comfort and skin protection during sleep.',
        category: 'Beauty',
        basePrice: 25.00,
        images: ['https://images.unsplash.com/photo-1582234053894-3914a1c6a784?q=80&w=800'],
        variants: [{ name: 'Standard', stock: 65, priceModifier: 0 }]
    },
    {
        name: 'SheaButter Intensive Lotion',
        description: 'Deeply moisturizing body lotion with raw shea butter and organic coconut oil.',
        category: 'Beauty',
        basePrice: 15.00,
        images: ['https://images.unsplash.com/photo-1601049541289-9b1b7abc74a4?q=80&w=800'],
        variants: [{ name: 'Standard', stock: 90, priceModifier: 0 }]
    },
    {
        name: 'Charcoal Detox Face Mask',
        description: 'Activated charcoal mask that pulls out impurities and minimizes the appearance of pores.',
        category: 'Beauty',
        basePrice: 22.00,
        images: ['https://images.unsplash.com/photo-1596755094514-f87e34085b2c?q=80&w=800'],
        variants: [{ name: 'Standard', stock: 55, priceModifier: 0 }]
    },
    {
        name: 'Herbal Essence Beard Oil',
        description: 'Nourishing beard oil with cedarwood and sandalwood scents. Promotes healthy growth and shine.',
        category: 'Beauty',
        basePrice: 19.00,
        images: ['https://images.unsplash.com/photo-1621607512214-68297480165e?q=80&w=800'],
        variants: [{ name: 'Standard', stock: 35, priceModifier: 0 }]
    },

    // Sports & Fitness
    {
        name: 'IronCore Kettlebell (16kg)',
        description: 'Cast iron kettlebell with wide grip handle for effective full-body strength and cardio workouts.',
        category: 'Sports',
        basePrice: 65.00,
        images: ['https://images.unsplash.com/photo-1586401100295-7a8096f85886?q=80&w=800'],
        variants: [{ name: 'Standard', stock: 15, priceModifier: 0 }]
    },
    {
        name: 'FlexFlow Yoga Mat',
        description: 'Extra-thick 6mm yoga mat with non-slip surface and alignment lines for perfect poses.',
        category: 'Sports',
        basePrice: 40.00,
        images: ['https://images.unsplash.com/photo-1544126592-807daa2b565b?q=80&w=800'],
        variants: [{ name: 'Standard', stock: 45, priceModifier: 0 }]
    },
    {
        name: 'HydraPeak Insulated Bottle',
        description: 'Double-walled stainless steel water bottle that keeps drinks cold for 24 hours or hot for 12.',
        category: 'Sports',
        basePrice: 28.00,
        images: ['https://images.unsplash.com/photo-1602143307185-8a4c9c45542c?q=80&w=800'],
        variants: [{ name: 'Standard', stock: 110, priceModifier: 0 }]
    },
    {
        name: 'Apex Speed Rope',
        description: 'Fast and adjustable jump rope for high-intensity interval training and boxing.',
        category: 'Sports',
        basePrice: 15.00,
        images: ['https://images.unsplash.com/photo-1510076857177-7470076d4098?q=80&w=800'],
        variants: [{ name: 'Standard', stock: 80, priceModifier: 0 }]
    },
    {
        name: 'Supportive Compression Sleeves',
        description: 'Medical-grade compression sleeves to reduce muscle fatigue and improve circulation.',
        category: 'Sports',
        basePrice: 20.00,
        images: ['https://images.unsplash.com/photo-1541829070764-84a7d30dee3f?q=80&w=800'],
        variants: [{ name: 'Standard', stock: 50, priceModifier: 0 }]
    },

    // Books
    {
        name: 'Beyond the Stars: Chronos',
        description: 'A gripping science fiction novel about a time-traveling explorer discovering the secrets of the galaxy.',
        category: 'Books',
        basePrice: 14.99,
        images: ['https://images.unsplash.com/photo-1543004629-142a44463553?q=80&w=800'],
        variants: [{ name: 'Paperback', stock: 35, priceModifier: 0 }]
    },
    {
        name: 'The Modern Minimalist Home',
        description: 'A comprehensive guide to decluttering your life and creating a serene, minimalist living space.',
        category: 'Books',
        basePrice: 19.99,
        images: ['https://images.unsplash.com/photo-1512820790803-83ca734da794?q=80&w=800'],
        variants: [{ name: 'Hardcover', stock: 20, priceModifier: 0 }]
    },
    {
        name: 'Gourmet Plant-Based Kitchen',
        description: 'Over 100 delicious and easy-to-follow vegan recipes for everyday meals and special occasions.',
        category: 'Books',
        basePrice: 24.95,
        images: ['https://images.unsplash.com/photo-1589998059171-988d887df646?q=80&w=800'],
        variants: [{ name: 'Standard', stock: 40, priceModifier: 0 }]
    },
    {
        name: 'The Productivity Code',
        description: 'Science-backed strategies to beat procrastination, manage your time, and achieve your goals.',
        category: 'Books',
        basePrice: 16.50,
        images: ['https://images.unsplash.com/photo-1544716278-ca5e3f4abd8c?q=80&w=800'],
        variants: [{ name: 'Standard', stock: 55, priceModifier: 0 }]
    },
    {
        name: 'Mindful Mornings Planner',
        description: 'A guided journal and planner to help you start your day with intention and gratitude.',
        category: 'Books',
        basePrice: 22.00,
        images: ['https://images.unsplash.com/photo-1531346878377-a5be20888e57?q=80&w=800'],
        variants: [{ name: 'Standard', stock: 30, priceModifier: 0 }]
    },

    // Toys
    {
        name: 'MagnoBlocks Construction Set',
        description: '100-piece magnetic building block set that encourages creative play and spatial awareness.',
        category: 'Toys',
        basePrice: 45.00,
        images: ['https://images.unsplash.com/photo-1587654780291-39c9404d746b?q=80&w=800'],
        variants: [{ name: 'Standard', stock: 25, priceModifier: 0 }]
    },
    {
        name: 'RoboQuest Learning Kit',
        description: 'Introduction to robotics and coding for kids. Includes parts for 5 different programmable robots.',
        category: 'Toys',
        basePrice: 89.00,
        images: ['https://images.unsplash.com/photo-1535378917042-10a22c95931a?q=80&w=800'],
        variants: [{ name: 'Standard', stock: 12, priceModifier: 0 }]
    },
    {
        name: 'Solar System Puzzle (1000 Pcs)',
        description: 'Beautifully illustrated 1000-piece puzzle featuring all planets in our solar system.',
        category: 'Toys',
        basePrice: 20.00,
        images: ['https://images.unsplash.com/photo-1585435421671-0c1676763909?q=80&w=800'],
        variants: [{ name: 'Standard', stock: 50, priceModifier: 0 }]
    },
    {
        name: 'TurboDash RC Car',
        description: 'High-speed remote control car with off-road tires and 30-minute rechargeable battery life.',
        category: 'Toys',
        basePrice: 35.00,
        images: ['https://images.unsplash.com/photo-1594787318286-3d835c1d207f?q=80&w=800'],
        variants: [{ name: 'Standard', stock: 18, priceModifier: 0 }]
    },
    {
        name: 'EcoCraft Painting Set',
        description: 'Non-toxic, washable paint set with recycled paper sketchpad and natural fiber brushes.',
        category: 'Toys',
        basePrice: 28.00,
        images: ['https://images.unsplash.com/photo-1513364776144-60967b0f800f?q=80&w=800'],
        variants: [{ name: 'Standard', stock: 40, priceModifier: 0 }]
    },

    // Automotive
    {
        name: 'DashGuardian 4K Camera',
        description: 'Ultra-HD dash camera with night vision, GPS tracking, and automatic incident detection.',
        category: 'Automotive',
        basePrice: 120.00,
        images: ['https://images.unsplash.com/photo-1549490349-8643362247b5?q=80&w=800'],
        variants: [{ name: 'Standard', stock: 15, priceModifier: 0 }]
    },
    {
        name: 'Portable Power Inflator',
        description: 'Compact and powerful tire inflator with digital pressure gauge and integrated LED light.',
        category: 'Automotive',
        basePrice: 49.00,
        images: ['https://images.unsplash.com/photo-1492144534655-ae79c964c9d7?q=80&w=800'],
        variants: [{ name: 'Standard', stock: 30, priceModifier: 0 }]
    },
    {
        name: 'Ceramic Glass Wax Kit',
        description: 'Professional-grade ceramic coating kit for long-lasting paint protection and high-gloss shine.',
        category: 'Automotive',
        basePrice: 35.00,
        images: ['https://images.unsplash.com/photo-1607860108855-64acf2078ed9?q=80&w=800'],
        variants: [{ name: 'Standard', stock: 45, priceModifier: 0 }]
    },
    {
        name: 'ErgoComfort Seat Cushion',
        description: 'Orthopedic memory foam seat cushion for long-distance driving comfort and postural support.',
        category: 'Automotive',
        basePrice: 25.00,
        images: ['https://images.unsplash.com/photo-1502877338535-766e1452684a?q=80&w=800'],
        variants: [{ name: 'Standard', stock: 60, priceModifier: 0 }]
    },
    {
        name: 'Bluetooth OBDII Scanner',
        description: 'Wireless car diagnostic tool that connects to your smartphone to identify engine problems.',
        category: 'Automotive',
        basePrice: 29.00,
        images: ['https://images.unsplash.com/photo-1511919884226-fd3cad34687c?q=80&w=800'],
        variants: [{ name: 'Standard', stock: 22, priceModifier: 0 }]
    }
];

// Add 50 more generic products to reach 100+
const genericCategories = ['Stationery', 'Health', 'Pet Supplies', 'Office', 'Electronics', 'Grocery', 'Fashion'];
const genericAdjectives = ['Premium', 'Lightweight', 'Durable', 'Eco-friendly', 'Smart', 'Classic', 'Modern', 'Compact'];
const genericNouns = {
    'Stationery': ['Journal', 'Pen Set', 'Organizer', 'Notebook', 'Stapler'],
    'Health': ['Supplement', 'Thermometer', 'Pain Relief Gel', 'First Aid Kit'],
    'Pet Supplies': ['Dog Leash', 'Cat Scratching Post', 'Pet Bed', 'Aquarium Filter'],
    'Office': ['Desk Lamp', 'Ergonomic Chair', 'File Cabinet', 'Wireless Mouse'],
};

for (let i = 0; i < 55; i++) {
    const category = genericCategories[i % genericCategories.length];
    const adj = genericAdjectives[i % genericAdjectives.length];
    const nouns = genericNouns[category] || ['Item', 'Accessory', 'Gadget'];
    const name = `${adj} ${nouns[i % nouns.length]} ${i + 1}`;

    products.push({
        name,
        description: `A high-quality ${name.toLowerCase()} that is both functional and stylish. Perfect for everyday use in the ${category.toLowerCase()} category.`,
        category,
        basePrice: Math.floor(Math.random() * 150) + 10.99,
        images: [`https://images.unsplash.com/photo-${1500000000000 + i}?auto=format&fit=crop&q=60&w=800`],
        variants: [{ name: 'Standard', stock: Math.floor(Math.random() * 100) + 5, priceModifier: 0 }]
    });
}

async function seed() {
    try {
        console.log('Connecting to database...');
        await mongoose.connect(MONGODB_URI);
        console.log('Connected to MongoDB');

        // Optional: Clear existing products
        await Product.deleteMany({});
        console.log('Cleared existing products');

        console.log(`Seeding ${products.length} products...`);

        const preparedProducts = products.map(p => {
            const productId = uuidv4();
            const sellerId = SELLER_ID;

            const variants = p.variants.map(v => {
                const variantId = uuidv4();
                const sId = sellerId.substring(0, 4).toUpperCase();
                const pId = productId.substring(0, 8).toUpperCase();
                const vId = variantId.substring(0, 8).toUpperCase();
                const timestamp = Date.now().toString().slice(-4);

                return {
                    ...v,
                    _id: variantId,
                    sku: `${sId}-${pId}-${vId}-${timestamp}`
                };
            });

            return {
                ...p,
                sellerId,
                _id: productId,
                variants
            };
        });

        await Product.insertMany(preparedProducts);
        console.log('✅ Successfully seeded catalog!');
        process.exit(0);
    } catch (error) {
        console.error('Error seeding data:', error);
        process.exit(1);
    }
}

seed();
