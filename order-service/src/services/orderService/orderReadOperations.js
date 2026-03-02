/**
 * Fetches orders for buyer in newest-first order.
 * @param {{Order: object}} deps Service dependencies.
 * @param {string} buyerId Buyer user id.
 * @return {Promise<object[]>} Order list.
 */
async function getOrdersByBuyer(deps, buyerId) {
  const { Order } = deps;
  const orders = await Order.find({ buyerId })
    .sort({ createdAt: -1 });
  return orders;
}

/**
 * Fetches orders visible to one seller.
 * @param {{Order: object}} deps Service dependencies.
 * @param {string} sellerId Seller user id.
 * @return {Promise<object[]>} Order list.
 */
async function getOrdersBySeller(deps, sellerId) {
  const { Order } = deps;
  const orders = await Order.find({ 'items.sellerId': sellerId })
    .sort({ createdAt: -1 });
  return orders;
}

/**
 * Returns seller analytics aggregated over day range.
 * @param {{Order: object}} deps Service dependencies.
 * @param {string} sellerId Seller user id.
 * @param {number=} days Requested day range.
 * @return {Promise<{
 *   totalRevenue: number,
 *   totalOrders: number,
 *   averageOrderValue: number,
 *   ordersByStatus: Array<{status: string, count: number}>,
 *   trend: Array<{date: string, revenue: number, orders: number}>,
 * }>} Analytics payload.
 */
async function getSellerAnalytics(deps, sellerId, days = 30) {
  const { Order } = deps;
  const safeDays = Math.max(1, Math.min(Number(days) || 30, 365));
  const now = new Date();
  const startUtc = new Date(Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate() - (safeDays - 1),
    0,
    0,
    0,
    0
  ));

  const match = {
    'items.sellerId': sellerId,
    createdAt: { $gte: startUtc, $lte: now },
  };

  const sellerRevenueProjection = [
    { $match: match },
    {
      $addFields: {
        sellerRevenue: {
          $sum: {
            $map: {
              input: {
                $filter: {
                  input: '$items',
                  as: 'item',
                  cond: { $eq: ['$$item.sellerId', sellerId] },
                },
              },
              as: 'item',
              in: {
                $multiply: [
                  { $ifNull: ['$$item.price', 0] },
                  { $ifNull: ['$$item.quantity', 0] },
                ],
              },
            },
          },
        },
      },
    },
  ];

  const totalsAgg = await Order.aggregate([
    ...sellerRevenueProjection,
    {
      $group: {
        _id: null,
        totalRevenue: { $sum: '$sellerRevenue' },
        totalOrders: { $sum: 1 },
      },
    },
  ]);

  const statusAgg = await Order.aggregate([
    { $match: match },
    { $group: { _id: '$status', count: { $sum: 1 } } },
  ]);

  const trendAgg = await Order.aggregate([
    ...sellerRevenueProjection,
    {
      $group: {
        _id: {
          $dateToString: {
            format: '%Y-%m-%d',
            date: '$createdAt',
            timezone: 'UTC',
          },
        },
        revenue: { $sum: '$sellerRevenue' },
        orders: { $sum: 1 },
      },
    },
    { $sort: { _id: 1 } },
  ]);

  const totals = totalsAgg[0] || { totalRevenue: 0, totalOrders: 0 };
  const averageOrderValue = totals.totalOrders > 0
    ? totals.totalRevenue / totals.totalOrders
    : 0;

  const statusMap = statusAgg.map((statusEntry) => ({
    status: statusEntry._id,
    count: statusEntry.count,
  }));

  const trendMap = new Map(trendAgg.map((entry) => [entry._id, entry]));
  const trend = [];
  for (let index = 0; index < safeDays; index += 1) {
    const trendDate = new Date(startUtc);
    trendDate.setUTCDate(startUtc.getUTCDate() + index);
    const key = `${trendDate.getUTCFullYear()}-${String(trendDate.getUTCMonth() + 1).padStart(2, '0')}-${String(trendDate.getUTCDate()).padStart(2, '0')}`;
    const point = trendMap.get(key);
    trend.push({
      date: key,
      revenue: point ? point.revenue : 0,
      orders: point ? point.orders : 0,
    });
  }

  if (process.env.NODE_ENV !== 'production') {
    const nonZeroTrendPoints = trend.filter(
      (point) => Number(point.orders) > 0 || Number(point.revenue) > 0
    ).length;
    console.log('ANALYTICS_V2', {
      sellerId,
      days: safeDays,
      rangeStartUtc: startUtc.toISOString(),
      rangeEndUtc: now.toISOString(),
      totalOrders: totals.totalOrders,
      totalRevenue: totals.totalRevenue,
      nonZeroTrendPoints,
      lastTrendDate: trend[trend.length - 1]?.date || null,
    });
  }

  return {
    totalRevenue: totals.totalRevenue,
    totalOrders: totals.totalOrders,
    averageOrderValue,
    ordersByStatus: statusMap,
    trend,
  };
}

/**
 * Fetches one order by id.
 * @param {{Order: object}} deps Service dependencies.
 * @param {string} orderId Order id.
 * @return {Promise<object>} Order document.
 */
async function getOrderById(deps, orderId) {
  const { Order } = deps;
  const order = await Order.findById(orderId);
  if (!order) {
    const error = new Error('Order not found');
    error.code = 'ORDER_NOT_FOUND';
    throw error;
  }
  return order;
}

module.exports = {
  getOrderById,
  getOrdersByBuyer,
  getOrdersBySeller,
  getSellerAnalytics,
};
