const arabicMarks = /[\u0610-\u061a\u064b-\u065f\u0670\u06d6-\u06ed]/g;

export function normalizeCustomerName(value) {
  return String(value || '')
    .normalize('NFKC')
    .replace(arabicMarks, '')
    .replace(/[إأآٱ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

const phoneKey = value => {
  const digits = String(value || '').replace(/\D/g, '');
  return digits.length >= 7 ? digits.slice(-9) : null;
};
const emailKey = value => {
  const email = String(value || '').trim().toLowerCase();
  return email.includes('@') ? email : null;
};
const customerName = order => {
  const customer = Array.isArray(order.customers) ? order.customers[0] : order.customers;
  return customer?.name || order.customer_name || '';
};

function identifiers(order, physicalHashes) {
  return new Set([
    phoneKey(order.customer_phone),
    emailKey(order.customer_email),
    emailKey(order.reminder_email),
    ...(physicalHashes.get(order.id) || []),
  ].filter(Boolean));
}

const intersects = (left, right) => [...left].some(value => right.has(value));

export function buildCustomerReputations(orders = [], compensations = [], deviceEvents = []) {
  const physicalHashes = new Map();
  for (const event of deviceEvents) {
    if (!event?.order_id || !event?.physical_core_hash) continue;
    if (!physicalHashes.has(event.order_id)) physicalHashes.set(event.order_id, new Set());
    physicalHashes.get(event.order_id).add(event.physical_core_hash);
  }
  const prepared = orders.map(order => ({
    order,
    name: normalizeCustomerName(customerName(order)),
    ids: identifiers(order, physicalHashes),
  }));
  const compensationByOrder = new Map();
  for (const request of compensations) {
    if (!compensationByOrder.has(request.order_id)) compensationByOrder.set(request.order_id, []);
    compensationByOrder.get(request.order_id).push(request);
  }
  const result = {};
  for (const current of prepared) {
    const sameName = current.name ? prepared.filter(candidate => candidate.name === current.name) : [current];
    const confirmed = sameName.filter(candidate => candidate.order.id === current.order.id || intersects(current.ids, candidate.ids));
    const confirmedIds = new Set(confirmed.map(candidate => candidate.order.id));
    const requests = confirmed.flatMap(candidate => compensationByOrder.get(candidate.order.id) || []);
    const totalOrders = confirmed.length;
    const cumulativeStrikes = confirmed.reduce((sum, candidate) => sum + Number(candidate.order.security_strikes || 0), 0);
    const rejectedCompensations = requests.filter(request => request.status === 'rejected').length;
    const nameOnlyMatches = sameName.filter(candidate => !confirmedIds.has(candidate.order.id)).length;
    let badge = 'none';
    if (totalOrders > 1 && (cumulativeStrikes >= 3 || rejectedCompensations > 0)) badge = 'high_risk_repeat';
    else if (totalOrders > 1 && cumulativeStrikes >= 1) badge = 'repeat_flag';
    else if (totalOrders > 1 && cumulativeStrikes === 0) badge = 'trusted';
    else if (nameOnlyMatches > 0) badge = 'name_match';
    result[current.order.id] = {
      badge,
      total_orders: totalOrders,
      cumulative_strikes: cumulativeStrikes,
      cumulative_compensations: requests.length,
      rejected_compensations: rejectedCompensations,
      name_only_matches: nameOnlyMatches,
      confirmed_identity: totalOrders > 1,
      requires_manual_compensation: cumulativeStrikes > 0 || rejectedCompensations > 0,
    };
  }
  return result;
}

export function reputationForOrder(orderId, orders, compensations, deviceEvents) {
  return buildCustomerReputations(orders, compensations, deviceEvents)[orderId] || {
    badge: 'none', total_orders: 1, cumulative_strikes: 0,
    cumulative_compensations: 0, rejected_compensations: 0,
    name_only_matches: 0, confirmed_identity: false,
    requires_manual_compensation: false,
  };
}
