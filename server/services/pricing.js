/**
 * @file server/services/pricing.js
 * @description Pure calculation rules for court booking discounts and order line totals.
 */

/**
 * Calculates court pricing based on base hourly rate and member plan discount percentage.
 * @param {number} basePricePerHour - Standard hourly court fee
 * @param {number} courtDiscountPct - Member plan discount percentage (0 to 100)
 * @returns {object} { basePrice, discountPct, priceCharged }
 */
function calculateCourtPrice(basePricePerHour, courtDiscountPct = 0) {
  const base = Number(basePricePerHour) || 0;
  const discount = Math.min(100, Math.max(0, Number(courtDiscountPct) || 0));
  const multiplier = (100 - discount) / 100;
  const charged = Math.round(base * multiplier * 100) / 100;
  return {
    basePrice: base,
    discountPct: discount,
    priceCharged: charged
  };
}

/**
 * Computes order pricing from unit prices and member plan department discount.
 * @param {Array<{ price: number, quantity: number }>} items - Array of items
 * @param {number} departmentDiscountPct - Discount % applicable for this department
 * @returns {object} { subtotal, discountPct, discountAmount, total, items }
 */
function calculateOrderTotals(items = [], departmentDiscountPct = 0) {
  let subtotal = 0;
  const calculatedItems = items.map(item => {
    const qty = Math.max(1, parseInt(item.quantity, 10) || 1);
    const unitPrice = Number(item.price) || 0;
    const lineTotal = Math.round(unitPrice * qty * 100) / 100;
    subtotal += lineTotal;
    return {
      productId: item.productId || item.id,
      name: item.name || '',
      quantity: qty,
      unitPrice,
      lineTotal,
      notes: item.notes || null,
      trackStock: item.trackStock !== undefined ? item.trackStock : 1
    };
  });

  const discountPct = Math.min(100, Math.max(0, Number(departmentDiscountPct) || 0));
  const discountAmount = Math.round((subtotal * (discountPct / 100)) * 100) / 100;
  const total = Math.max(0, Math.round((subtotal - discountAmount) * 100) / 100);

  return {
    subtotal: Math.round(subtotal * 100) / 100,
    discountPct,
    discountAmount,
    total,
    items: calculatedItems
  };
}

module.exports = {
  calculateCourtPrice,
  calculateOrderTotals
};
