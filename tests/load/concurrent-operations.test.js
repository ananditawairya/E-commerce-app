// tests/load/concurrent-operations.test.js
const axios = require('axios');
const { expect } = require('chai');

describe('Load Testing - Concurrent Operations', () => {
  const GATEWAY_URL = 'http://localhost:4000';
  const PRODUCT_API = 'http://localhost:4002/api/products';

  it('should handle high concurrent load without data corruption', async () => {
    const concurrentUsers = 50;
    const operationsPerUser = 10;
    
    // Create multiple test products
    const products = await Promise.all(
      Array(5).fill().map(async (_, index) => {
        const response = await axios.post(PRODUCT_API, {
          sellerId: `load-test-seller-${index}`,
          input: {
            name: `Load Test Product ${index}`,
            description: 'Product for load testing',
            category: 'LoadTest',
            basePrice: 15.00,
            images: ['data:image/jpeg;base64,loadtest'],
            variants: [{
              name: `Load Variant ${index}`,
              stock: 100,
              priceModifier: 0
            }]
          }
        });
        return response.data;
      })
    );

    // Simulate concurrent users performing operations
    const userOperations = Array(concurrentUsers).fill().map(async (_, userIndex) => {
      const operations = [];
      
      for (let i = 0; i < operationsPerUser; i++) {
        const randomProduct = products[Math.floor(Math.random() * products.length)];
        const operation = axios.post(`${PRODUCT_API}/${randomProduct.id}/deduct-stock`, {
          variantId: randomProduct.variants[0].id,
          quantity: 1,
          orderId: `load-test-${userIndex}-${i}-${Date.now()}`
        }).catch(error => ({
          error: error.response?.data?.message || error.message
        }));
        
        operations.push(operation);
      }
      
      return Promise.all(operations);
    });

    const startTime = Date.now();
    const results = await Promise.all(userOperations);
    const endTime = Date.now();

    // Analyze results
    const flatResults = results.flat();
    const successful = flatResults.filter(r => !r.error);
    const failed = flatResults.filter(r => r.error);

    console.log(`Load Test Results:`);
    console.log(`- Duration: ${endTime - startTime}ms`);
    console.log(`- Total Operations: ${flatResults.length}`);
    console.log(`- Successful: ${successful.length}`);
    console.log(`- Failed: ${failed.length}`);
    console.log(`- Success Rate: ${(successful.length / flatResults.length * 100).toFixed(2)}%`);

    // Verify final stock consistency
    for (const product of products) {
      const stockResponse = await axios.get(`${PRODUCT_API}/${product.id}/stock?variantId=${product.variants[0].id}`);
      const finalStock = stockResponse.data.stock;
      const expectedDeductions = successful.filter(r => 
        r.config?.url?.includes(product.id)
      ).length;
      
      expect(finalStock).to.equal(100 - expectedDeductions);
      console.log(`Product ${product.id}: Final stock ${finalStock}, Expected: ${100 - expectedDeductions}`);
    }

    console.log('✅ Load test completed with data consistency maintained');
  });
});