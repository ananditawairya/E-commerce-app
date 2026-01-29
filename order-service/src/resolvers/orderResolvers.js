// backend/order-service/src/resolvers/orderResolvers.js

const Cart = require('../models/Cart'); 
const Order = require('../models/Order'); 
const { requireBuyer, requireSeller, authenticate } = require('../middleware/auth');
const axios = require('axios');

const getProductDetails = async (productId) => {
  try {
    const response = await axios.post(
      `${process.env.PRODUCT_SERVICE_URL}/graphql`,
      {
        query: `
          query GetProduct($id: ID!) {
            product(id: $id) {
              id
              name
              sellerId
            }
          }
        `,
        variables: { id: productId },
      }
    );
    return response.data.data.product;
  } catch (error) {
    throw new Error('Failed to fetch product details');
  }
};

const resolvers = {
  Cart: {
    totalAmount: (cart) => {
      return cart.items.reduce((total, item) => total + (item.price * item.quantity), 0);
    },
  },

  Query: {
    myCart: async (_, __, context) => {
      try {
        const user = await requireBuyer(context);
        let cart = await Cart.findOne({ userId: user.userId });
        
        if (!cart) {
          cart = new Cart({ userId: user.userId, items: [] });
          await cart.save();
        }
        
        return cart;
      } catch (error) {
        throw new Error(error.message);
      }
    },

    myOrders: async (_, __, context) => {
      try {
        const user = await requireBuyer(context);
        const orders = await Order.find({ buyerId: user.userId })
          .sort({ createdAt: -1 });
        return orders;
      } catch (error) {
        throw new Error(error.message);
      }
    },

    sellerOrders: async (_, __, context) => {
      try {
        const user = await requireSeller(context);
        const orders = await Order.find({ 'items.sellerId': user.userId })
          .sort({ createdAt: -1 });
        return orders;
      } catch (error) {
        throw new Error(error.message);
      }
    },

    order: async (_, { id }, context) => {
      try {
        const user = await authenticate(context);
        const order = await Order.findById(id);
        
        if (!order) {
          throw new Error('Order not found');
        }

        // Check authorization
        const isBuyer = user.role === 'buyer' && order.buyerId === user.userId;
        const isSeller = user.role === 'seller' && 
          order.items.some(item => item.sellerId === user.userId);

        if (!isBuyer && !isSeller) {
          throw new Error('Unauthorized');
        }

        return order;
      } catch (error) {
        throw new Error(error.message);
      }
    },
  },

  Mutation: {
    addToCart: async (_, { productId, variantId, quantity, price }, context) => {
      try {
        const user = await requireBuyer(context);
        let cart = await Cart.findOne({ userId: user.userId });

        if (!cart) {
          cart = new Cart({ userId: user.userId, items: [] });
        }

        const existingItemIndex = cart.items.findIndex(
          item => item.productId === productId && 
                  (item.variantId || null) === (variantId || null)
        );

        if (existingItemIndex > -1) {
          cart.items[existingItemIndex].quantity += quantity;
        } else {
          cart.items.push({ productId, variantId, quantity, price });
        }

        await cart.save();
        return cart;
      } catch (error) {
        throw new Error(error.message);
      }
    },

    updateCartItem: async (_, { productId, variantId, quantity }, context) => {
      try {
        const user = await requireBuyer(context);
        const cart = await Cart.findOne({ userId: user.userId });

        if (!cart) {
          throw new Error('Cart not found');
        }

        const itemIndex = cart.items.findIndex(
          item => item.productId === productId && 
                  (item.variantId || null) === (variantId || null)
        );

        if (itemIndex === -1) {
          throw new Error('Item not found in cart');
        }

        if (quantity <= 0) {
          cart.items.splice(itemIndex, 1);
        } else {
          cart.items[itemIndex].quantity = quantity;
        }

        await cart.save();
        return cart;
      } catch (error) {
        throw new Error(error.message);
      }
    },

    removeFromCart: async (_, { productId, variantId }, context) => {
      try {
        const user = await requireBuyer(context);
        const cart = await Cart.findOne({ userId: user.userId });

        if (!cart) {
          throw new Error('Cart not found');
        }

        cart.items = cart.items.filter(
          item => !(item.productId === productId && 
                   (item.variantId || null) === (variantId || null))
        );

        await cart.save();
        return cart;
      } catch (error) {
        throw new Error(error.message);
      }
    },

    clearCart: async (_, __, context) => {
      try {
        const user = await requireBuyer(context);
        await Cart.findOneAndUpdate(
          { userId: user.userId },
          { items: [] }
        );
        return true;
      } catch (error) {
        return false;
      }
    },

    checkout: async (_, { shippingAddress }, context) => {
      try {
        const user = await requireBuyer(context);
        const cart = await Cart.findOne({ userId: user.userId });

        if (!cart || cart.items.length === 0) {
          throw new Error('Cart is empty');
        }

        // Fetch product details for each item
        const orderItems = await Promise.all(
          cart.items.map(async (item) => {
            const product = await getProductDetails(item.productId);
            return {
              productId: item.productId,
              productName: product.name,
              variantId: item.variantId,
              variantName: item.variantId ? 'Variant' : null,
              quantity: item.quantity,
              price: item.price,
              sellerId: product.sellerId,
            };
          })
        );

        const totalAmount = orderItems.reduce(
          (total, item) => total + (item.price * item.quantity),
          0
        );

        const order = new Order({
          orderId: `ORD-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
          buyerId: user.userId,
          items: orderItems,
          totalAmount,
          shippingAddress,
          status: 'pending',
          paymentMethod: 'mock',
        });

        await order.save();

        // Clear cart
        cart.items = [];
        await cart.save();

        return order;
      } catch (error) {
        throw new Error(error.message);
      }
    },

    updateOrderStatus: async (_, { orderId, status }, context) => {
      try {
        const user = await requireSeller(context);
        const order = await Order.findById(orderId);

        if (!order) {
          throw new Error('Order not found');
        }

        // Check if seller has items in this order
        const hasItems = order.items.some(item => item.sellerId === user.userId);
        if (!hasItems) {
          throw new Error('Unauthorized');
        }

        order.status = status;
        await order.save();

        return order;
      } catch (error) {
        throw new Error(error.message);
      }
    },
  },
};

module.exports = resolvers;